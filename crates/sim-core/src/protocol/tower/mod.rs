//! TowerBFT: today's Solana consensus. Proof of History gives the leader a
//! clock (slots are fixed 400 ms), blocks stream as Turbine shreds through a
//! stake-weighted tree, and validators vote by sending **vote transactions**
//! to the leader (also shared peer-to-peer). Votes stack in a tower whose
//! lockouts double with every confirmation; a vote 32 deep becomes the root
//! (~12.8 s). Fork choice is heaviest-subtree over latest votes; optimistic
//! confirmation is ≥ 2/3 of stake voting on a block or its descendants.

pub mod forks;
pub mod vote_state;

use self::forks::{ForkTree, GENESIS};
use self::vote_state::TowerState;
use super::blokstor::{BlockMeta, Blokstor, Shred};
use super::dissemination::{block_hash, mix, turbine_children, weighted_order, SHRED_BYTES};
use super::{Ctx, Env, MsgInfo, Protocol};
use crate::stake::NodeId;
use crate::time::ms_f;
use crate::trace::{BlockHash, Commitment, TraceEvent, VoteKind};
use crate::tx::{TxId, TxStage};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const HERO_TX: TxId = 0;
pub const VOTE_TX_BYTES: u32 = 300;

pub struct Tower;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct VoteTx {
    pub voter: NodeId,
    pub slot: u64,
    pub hash: BlockHash,
    pub root: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Msg {
    Shred(Shred),
    /// Vote transaction sent to a leader's TPU for inclusion in a block.
    VoteTx(VoteTx),
    /// The same vote shared peer-to-peer so nodes can count it immediately.
    VoteGossip(VoteTx),
    RepairRequest { hash: BlockHash },
    RepairResponse(BlockMeta),
    TxForward(TxId),
}

impl MsgInfo for Msg {
    fn kind(&self) -> &'static str {
        match self {
            Msg::Shred(_) => "shred",
            Msg::VoteTx(_) => "vote:tower",
            Msg::VoteGossip(_) => "vote:gossip",
            Msg::RepairRequest { .. } => "repair:request",
            Msg::RepairResponse(_) => "repair:response",
            Msg::TxForward(_) => "tx",
        }
    }
    fn bytes(&self) -> u32 {
        match self {
            Msg::Shred(_) => SHRED_BYTES,
            Msg::VoteTx(_) | Msg::VoteGossip(_) => VOTE_TX_BYTES,
            Msg::RepairRequest { .. } => 64,
            Msg::RepairResponse(b) => b.num_slices * 4 * SHRED_BYTES,
            Msg::TxForward(_) => 300,
        }
    }
    fn slot(&self) -> Option<u64> {
        match self {
            Msg::Shred(s) => Some(s.slot),
            Msg::VoteTx(v) | Msg::VoteGossip(v) => Some(v.slot),
            Msg::RepairResponse(b) => Some(b.slot),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Timer {
    /// Leader: emit the next FEC set of the block for `slot`.
    ProduceFec { slot: u64, fec: u32 },
    /// Leader: grace period for the previous block expired; build on what we have.
    GraceExpired { slot: u64 },
    Replayed(BlockHash),
    /// RPC node: re-forward a transaction that has not landed yet (Gulf Stream retry).
    TxRetry(TxId),
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct LeaderState {
    /// slot -> (hash, parent)
    producing: BTreeMap<u64, (BlockHash, BlockHash)>,
    block_txs: BTreeMap<BlockHash, Vec<TxId>>,
    block_vote_txs: BTreeMap<BlockHash, u32>,
    pending_txs: Vec<TxId>,
    pending_vote_txs: u32,
    seen_txs: BTreeSet<TxId>,
    included: BTreeSet<TxId>,
    /// Slot we are leader for but have not started, waiting for the previous block.
    waiting_for_parent: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    total_stake: u64,
    current_slot: u64,
    pub blokstor: Blokstor,
    pub forks: ForkTree,
    pub tower: TowerState,
    pub leader: LeaderState,
    replayed: BTreeSet<BlockHash>,
    replay_scheduled: BTreeSet<BlockHash>,
    orphans: BTreeSet<BlockHash>,
    last_vote: Option<(u64, BlockHash)>,
    head: BlockHash,
    confirmed: BTreeSet<BlockHash>,
    rooted: BTreeSet<BlockHash>,
    repair_requested: BTreeSet<BlockHash>,
    hero_block: Option<BlockHash>,
    last_reason: String,
    tx_retries: u32,
}

impl Protocol for Tower {
    const NAME: &'static str = "tower";
    type Msg = Msg;
    type Timer = Timer;
    type Node = Node;

    fn init(id: NodeId, env: &Env) -> Node {
        Node {
            id,
            total_stake: env.validators.total,
            current_slot: 0,
            blokstor: Blokstor::default(),
            forks: ForkTree::default(),
            tower: TowerState::new(env.params.tower.max_lockout_history),
            leader: LeaderState::default(),
            replayed: BTreeSet::new(),
            replay_scheduled: BTreeSet::new(),
            orphans: BTreeSet::new(),
            last_vote: None,
            head: GENESIS,
            confirmed: BTreeSet::new(),
            rooted: BTreeSet::new(),
            repair_requested: BTreeSet::new(),
            hero_block: None,
            last_reason: String::new(),
            tx_retries: 0,
        }
    }

    fn on_slot(node: &mut Node, slot: u64, ctx: &mut Ctx<Self>) {
        node.current_slot = slot;
        if ctx.is_leader(slot) {
            let have_prev = slot == 0 || node.forks.slot_of(node.head) == Some(slot - 1);
            if have_prev {
                node.start_block(slot, ctx);
            } else {
                // Agave grace ticks: give the previous leader's block a moment to arrive.
                node.leader.waiting_for_parent = Some(slot);
                ctx.set_timer(ms_f(ctx.params.tower.grace_ms), Timer::GraceExpired { slot });
            }
        }
    }

    fn on_message(node: &mut Node, from: NodeId, msg: Msg, ctx: &mut Ctx<Self>) {
        match msg {
            Msg::Shred(sh) => node.on_shred(sh, ctx),
            Msg::VoteTx(v) => {
                // Leader TPU: queue for inclusion, and count it like any observer.
                node.leader.pending_vote_txs += 1;
                node.on_vote_observed(&v, ctx);
            }
            Msg::VoteGossip(v) => node.on_vote_observed(&v, ctx),
            Msg::RepairRequest { hash } => {
                if let Some(meta) = node.blokstor.get(hash).cloned() {
                    ctx.send(from, Msg::RepairResponse(meta));
                }
            }
            Msg::RepairResponse(meta) => {
                if node.blokstor.add_block(meta.clone()) {
                    node.on_block_complete(meta, ctx);
                }
            }
            Msg::TxForward(tx) => node.accept_tx(tx),
        }
    }

    fn on_timer(node: &mut Node, timer: Timer, ctx: &mut Ctx<Self>) {
        match timer {
            Timer::ProduceFec { slot, fec } => node.produce_fec(slot, fec, ctx),
            Timer::GraceExpired { slot } => {
                if node.leader.waiting_for_parent == Some(slot) {
                    node.leader.waiting_for_parent = None;
                    node.note(ctx, format!("slot {slot}: grace period over, building on slot {:?}", node.forks.slot_of(node.head)));
                    node.start_block(slot, ctx);
                }
            }
            Timer::Replayed(hash) => node.on_replayed(hash, ctx),
            Timer::TxRetry(tx) => {
                if node.hero_block.is_none() && node.tx_retries < 40 {
                    node.tx_retries += 1;
                    node.forward_tx(tx, true, ctx);
                }
            }
        }
    }

    fn on_client_tx(node: &mut Node, tx: TxId, ctx: &mut Ctx<Self>) {
        node.tx_stage(ctx, TxStage::Submitted, None, Some(format!("client → RPC node {}", node.id)));
        node.forward_tx(tx, false, ctx);
    }

    fn inspect(node: &Node) -> serde_json::Value {
        let head_slot = node.forks.slot_of(node.head);
        let min_slot = node.tower.root.unwrap_or(0).saturating_sub(2);
        let forks: Vec<serde_json::Value> = node
            .forks
            .blocks
            .values()
            .filter(|b| b.slot >= min_slot)
            .map(|b| {
                serde_json::json!({
                    "hash": b.hash, "slot": b.slot, "parent": b.parent, "leader": b.leader,
                    "weight_pct": (node.forks.weight(b.hash) as f64 / node.total_stake as f64 * 1000.0).round() / 10.0,
                    "replayed": node.replayed.contains(&b.hash),
                    "confirmed": node.confirmed.contains(&b.hash),
                    "rooted": node.rooted.contains(&b.hash),
                })
            })
            .collect();
        serde_json::json!({
            "protocol": "tower",
            "node": node.id,
            "root": node.tower.root,
            "lockouts": node.tower.lockouts,
            "head": { "slot": head_slot, "hash": node.head },
            "last_vote": node.last_vote,
            "forks": forks,
            "hero_block": node.hero_block,
            "last_reason": node.last_reason,
            "leader": { "pending_txs": node.leader.pending_txs, "pending_vote_txs": node.leader.pending_vote_txs },
        })
    }
}

impl Node {
    fn tx_stage(&self, ctx: &mut Ctx<Tower>, stage: TxStage, slot: Option<u64>, detail: Option<String>) {
        ctx.emit(TraceEvent::TxStage { tx: HERO_TX, stage, node: Some(self.id), slot, detail });
    }

    fn accept_tx(&mut self, tx: TxId) {
        if self.leader.seen_txs.insert(tx) && !self.leader.included.contains(&tx) {
            self.leader.pending_txs.push(tx);
        }
    }

    /// Gulf Stream: forward to the current leader and the next few; retry
    /// every slot until the tx shows up in a block we hold.
    fn forward_tx(&mut self, tx: TxId, retry: bool, ctx: &mut Ctx<Tower>) {
        let cur = ctx.current_slot();
        let mut leaders = vec![ctx.leader(cur)];
        for i in 1..=ctx.params.tower.forward_leaders as u64 {
            let l = ctx.leader(cur + i);
            if !leaders.contains(&l) {
                leaders.push(l);
            }
        }
        if !retry {
            self.tx_stage(ctx, TxStage::ForwardedToLeader, Some(cur), Some(format!("Gulf Stream → leaders {leaders:?}")));
        } else {
            ctx.emit(TraceEvent::Log { node: Some(self.id), msg: format!("tx {tx} not seen in a block yet; retry {} → leaders {leaders:?}", self.tx_retries) });
        }
        for l in leaders {
            if l == self.id {
                self.accept_tx(tx);
            } else {
                ctx.send(l, Msg::TxForward(tx));
            }
        }
        ctx.set_timer(ctx.slot_duration(), Timer::TxRetry(tx));
    }

    // ------------------------------------------------------------ leader

    fn start_block(&mut self, slot: u64, ctx: &mut Ctx<Tower>) {
        // Build on the heaviest fork we have replayed (PoH keeps ticking even
        // if the previous leader produced nothing).
        let parent = self.head;
        let hash = block_hash(slot, self.id, parent, 0);
        self.leader.producing.insert(slot, (hash, parent));
        self.leader.block_txs.insert(hash, Vec::new());
        self.leader.block_vote_txs.insert(hash, 0);
        // Vote transactions queued since our last block go into the first FEC
        // set; the event reports that count (later-arriving votes ride in
        // later FEC sets and are visible in the leader's log line).
        let vote_txs = self.leader.pending_vote_txs;
        let txs: Vec<TxId> = self.leader.pending_txs.iter().copied().filter(|t| !self.leader.included.contains(t)).collect();
        ctx.emit(TraceEvent::BlockProduced { slot, hash, parent, leader: self.id, txs, vote_txs });
        self.produce_fec(slot, 0, ctx);
    }

    fn produce_fec(&mut self, slot: u64, fec: u32, ctx: &mut Ctx<Tower>) {
        let tp = ctx.params.tower.clone();
        let me = self.id;
        let Some((hash, parent)) = self.leader.producing.get(&slot).copied() else { return };
        let num = tp.fec_sets_per_block;

        let pending = std::mem::take(&mut self.leader.pending_txs);
        let txs: Vec<TxId> = pending.into_iter().filter(|t| !self.leader.included.contains(t)).collect();
        for t in &txs {
            self.leader.included.insert(*t);
        }
        if txs.contains(&HERO_TX) {
            self.hero_block = Some(hash);
            self.tx_stage(ctx, TxStage::IncludedInBlock, Some(slot), Some(format!("FEC set {fec} of block in slot {slot} (PoH-timed)")));
            self.tx_stage(ctx, TxStage::Propagating, Some(slot), Some(format!("Turbine tree, fanout {}", tp.fanout)));
        }
        self.leader.block_txs.entry(hash).or_default().extend(txs.iter().copied());
        let vote_txs = std::mem::take(&mut self.leader.pending_vote_txs);
        *self.leader.block_vote_txs.entry(hash).or_default() += vote_txs;

        let total = tp.fec_data_shreds + tp.fec_coding_shreds;
        for idx in 0..total {
            let order = weighted_order(ctx.validators, Some(me), mix(slot, fec as u64 * 1000 + idx as u64, hash));
            let root = order[0];
            let sh = Shred { slot, hash, parent, leader: me, slice: fec, index: idx, num_slices: num, txs: txs.clone(), relay: root, vote_txs };
            ctx.send(root, Msg::Shred(sh));
        }

        if fec + 1 < num {
            // Spread the remaining FEC sets over what is left of the PoH slot.
            let slot_end = (slot + 1) * ctx.slot_duration();
            let remaining = slot_end.saturating_sub(ctx.now).max(1);
            ctx.set_timer(remaining / (num - fec) as u64, Timer::ProduceFec { slot, fec: fec + 1 });
        } else {
            let all_txs = self.leader.block_txs.remove(&hash).unwrap_or_default();
            let vote_txs = self.leader.block_vote_txs.remove(&hash).unwrap_or(0);
            let meta = BlockMeta { slot, hash, parent, leader: me, txs: all_txs, num_slices: num, vote_txs };
            self.leader.producing.remove(&slot);
            if vote_txs > 0 {
                ctx.emit(TraceEvent::Log { node: Some(me), msg: format!("block {slot}: {vote_txs} vote txs ({} KB) packed alongside user txs", vote_txs * VOTE_TX_BYTES / 1000) });
            }
            self.blokstor.add_block(meta.clone());
            self.on_block_complete(meta, ctx);
        }
    }

    // ------------------------------------------------------------ blocks

    fn on_shred(&mut self, sh: Shred, ctx: &mut Ctx<Tower>) {
        let tp = ctx.params.tower.clone();
        let (is_new, complete) = self.blokstor.add_shred(&sh, tp.fec_data_shreds + tp.fec_coding_shreds, tp.fec_data_shreds);
        if is_new {
            let order = weighted_order(ctx.validators, Some(sh.leader), mix(sh.slot, sh.slice as u64 * 1000 + sh.index as u64, sh.hash));
            for c in turbine_children(&order, self.id, tp.fanout) {
                ctx.send(c, Msg::Shred(sh.clone()));
            }
        }
        if let Some(meta) = complete {
            self.on_block_complete(meta, ctx);
        }
    }

    fn on_block_complete(&mut self, meta: BlockMeta, ctx: &mut Ctx<Tower>) {
        if self.forks.has(meta.hash) {
            return;
        }
        ctx.emit(TraceEvent::BlockReceived { node: self.id, slot: meta.slot, hash: meta.hash });
        if meta.txs.contains(&HERO_TX) {
            self.hero_block = Some(meta.hash);
            self.leader.included.insert(HERO_TX);
        }
        self.forks.insert(meta.clone());
        // Votes for this block may have arrived before the block did; their
        // stake now flows to the ancestors.
        self.forks.recompute_weights(ctx.validators);
        self.try_replay(meta.hash, ctx);
    }

    fn try_replay(&mut self, hash: BlockHash, ctx: &mut Ctx<Tower>) {
        let Some(meta) = self.forks.blocks.get(&hash).cloned() else { return };
        if self.replayed.contains(&hash) || self.replay_scheduled.contains(&hash) {
            return;
        }
        if meta.parent == GENESIS || self.replayed.contains(&meta.parent) {
            self.replay_scheduled.insert(hash);
            ctx.set_timer(ms_f(ctx.params.exec_delay_ms), Timer::Replayed(hash));
        } else {
            self.orphans.insert(hash);
            // The parent is older than this block, so it is not "still streaming".
            self.maybe_repair(meta.parent, meta.leader, Some(meta.slot.saturating_sub(1)), ctx);
        }
    }

    fn on_replayed(&mut self, hash: BlockHash, ctx: &mut Ctx<Tower>) {
        let Some(meta) = self.forks.blocks.get(&hash).cloned() else { return };
        if !self.replayed.insert(hash) {
            return;
        }
        ctx.emit(TraceEvent::BlockReplayed { node: self.id, slot: meta.slot, hash });
        ctx.emit(TraceEvent::Commitment { node: self.id, slot: meta.slot, hash, level: Commitment::Processed });
        if meta.txs.contains(&HERO_TX) {
            self.tx_stage(ctx, TxStage::Replayed, Some(meta.slot), None);
        }
        // Children that were waiting on this parent.
        let waiting: Vec<BlockHash> = self.orphans.iter().copied().filter(|h| self.forks.blocks.get(h).map(|b| b.parent == hash).unwrap_or(false)).collect();
        for h in waiting {
            self.orphans.remove(&h);
            self.try_replay(h, ctx);
        }
        self.update_head(ctx);
        // A waiting leader can start as soon as the previous slot's block is in.
        if let Some(s) = self.leader.waiting_for_parent {
            if meta.slot + 1 == s && self.forks.slot_of(self.head) == Some(meta.slot) {
                self.leader.waiting_for_parent = None;
                self.start_block(s, ctx);
            }
        }
        self.maybe_vote(ctx);
    }

    /// Ask for a whole block we are missing. While its shreds are still
    /// streaming (block from the current slot) we wait; once the block is a
    /// slot old and still incomplete, Turbine lost too many shreds (e.g. an
    /// offline relay subtree) and we repair.
    fn maybe_repair(&mut self, hash: BlockHash, from: NodeId, slot_hint: Option<u64>, ctx: &mut Ctx<Tower>) {
        if hash == GENESIS || self.forks.has(hash) {
            return;
        }
        if self.blokstor.partial_progress(hash).is_some() && slot_hint.is_none_or(|s| s >= self.current_slot) {
            return;
        }
        if !self.repair_requested.insert(hash) {
            return;
        }
        if from != self.id {
            ctx.send(from, Msg::RepairRequest { hash });
        }
        let peer = ctx.rng.below(ctx.n() as u64) as NodeId;
        if peer != self.id && peer != from {
            ctx.send(peer, Msg::RepairRequest { hash });
        }
    }

    // ------------------------------------------------------------ voting

    fn update_head(&mut self, ctx: &mut Ctx<Tower>) {
        let start = self
            .tower
            .root
            .and_then(|r| self.last_vote.and_then(|(_, lh)| self.block_at_slot_on_fork(lh, r)))
            .unwrap_or(GENESIS);
        let head = self.forks.head(start, &self.replayed);
        if head != self.head {
            self.head = head;
            if let Some(slot) = self.forks.slot_of(head) {
                ctx.emit(TraceEvent::ForkChoice { node: self.id, head_slot: slot, head_hash: head });
            }
        }
    }

    fn block_at_slot_on_fork(&self, head: BlockHash, slot: u64) -> Option<BlockHash> {
        let mut cur = head;
        while let Some(b) = self.forks.blocks.get(&cur) {
            if b.slot == slot {
                return Some(cur);
            }
            if b.slot < slot {
                return None;
            }
            cur = b.parent;
        }
        None
    }

    fn maybe_vote(&mut self, ctx: &mut Ctx<Tower>) {
        let tp = ctx.params.tower.clone();
        let candidate = self.head;
        let Some(slot) = self.forks.slot_of(candidate) else { return };
        if let Some((ls, _)) = self.last_vote {
            if slot <= ls {
                return;
            }
        }
        let ancestors = self.forks.ancestor_slots(candidate);

        // Switching forks needs a switching proof: enough stake locked out of our fork.
        if let Some((_, lh)) = self.last_vote {
            if !self.forks.is_ancestor_or_self(lh, candidate) {
                let conflicting = self.forks.conflicting_stake(lh, ctx.validators);
                if !ctx.validators.reaches(conflicting, tp.switch_threshold) {
                    self.note(ctx, format!("slot {slot}: cannot switch forks, only {:.0}% stake on other forks (< {:.0}%)", ctx.validators.pct(conflicting) * 100.0, tp.switch_threshold * 100.0));
                    return;
                }
            }
        }
        if self.tower.is_locked_out(slot, &ancestors) {
            self.note(ctx, format!("slot {slot}: locked out (a tower vote on another fork has not expired)"));
            return;
        }
        // Threshold check: the vote `threshold_depth` deep must have ≥ 2/3 stake.
        if let Some(tv) = self.tower.threshold_vote(slot, tp.threshold_depth) {
            if let Some(h) = self.block_at_slot_on_fork(candidate, tv.slot) {
                let w = self.forks.weight(h);
                if !ctx.validators.reaches(w, tp.threshold_size) {
                    self.note(ctx, format!("slot {slot}: threshold check failed — slot {} at depth {} has {:.0}% (< {:.0}%)", tv.slot, tp.threshold_depth, ctx.validators.pct(w) * 100.0, tp.threshold_size * 100.0));
                    return;
                }
            }
        }

        let rooted = self.tower.record_vote(slot);
        self.last_vote = Some((slot, candidate));
        ctx.emit(TraceEvent::Vote { node: self.id, slot, kind: VoteKind::Tower, hash: Some(candidate) });
        ctx.emit(TraceEvent::TowerUpdate { node: self.id, lockouts: self.tower.lockouts.clone(), root: self.tower.root });
        if self.hero_block == Some(candidate) {
            self.tx_stage(ctx, TxStage::Voted, Some(slot), None);
        }
        let vote = VoteTx { voter: self.id, slot, hash: candidate, root: self.tower.root };
        // Vote transaction → current and upcoming leaders' TPU.
        let mut leaders = vec![ctx.leader(self.current_slot)];
        for i in 1..=tp.forward_leaders as u64 {
            let l = ctx.leader(self.current_slot + i);
            if !leaders.contains(&l) {
                leaders.push(l);
            }
        }
        for l in leaders {
            if l == self.id {
                self.leader.pending_vote_txs += 1;
            } else {
                ctx.send(l, Msg::VoteTx(vote.clone()));
            }
        }
        if tp.gossip_votes {
            ctx.broadcast(Msg::VoteGossip(vote.clone()));
        }
        self.on_vote_observed(&vote, ctx);
        if let Some(r) = rooted {
            self.on_rooted(r, ctx);
        }
    }

    fn note(&mut self, ctx: &mut Ctx<Tower>, msg: String) {
        if self.last_reason != msg {
            self.last_reason = msg.clone();
            ctx.emit(TraceEvent::Log { node: Some(self.id), msg });
        }
    }

    fn on_vote_observed(&mut self, v: &VoteTx, ctx: &mut Ctx<Tower>) {
        if !self.forks.record_vote(v.voter, v.slot, v.hash) {
            return;
        }
        if !self.forks.has(v.hash) {
            self.maybe_repair(v.hash, v.voter, Some(v.slot), ctx);
        }
        self.forks.recompute_weights(ctx.validators);
        // Optimistic confirmation.
        let thr = ctx.params.tower.optimistic_threshold;
        let newly: Vec<BlockMeta> = self
            .forks
            .blocks
            .values()
            .filter(|b| !self.confirmed.contains(&b.hash) && ctx.validators.reaches(self.forks.weight(b.hash), thr))
            .cloned()
            .collect();
        for b in newly {
            self.confirmed.insert(b.hash);
            ctx.emit(TraceEvent::Commitment { node: self.id, slot: b.slot, hash: b.hash, level: Commitment::Confirmed });
            if self.hero_block == Some(b.hash) {
                self.tx_stage(ctx, TxStage::Confirmed, Some(b.slot), Some("optimistic confirmation: ≥2/3 stake voted on block or descendants".into()));
            }
        }
        self.update_head(ctx);
    }

    fn on_rooted(&mut self, root_slot: u64, ctx: &mut Ctx<Tower>) {
        let Some((_, lh)) = self.last_vote else { return };
        let Some(root_hash) = self.block_at_slot_on_fork(lh, root_slot) else { return };
        let mut chain = vec![root_hash];
        chain.extend(self.forks.ancestors(root_hash));
        for h in chain {
            if !self.rooted.insert(h) {
                break;
            }
            let Some(b) = self.forks.blocks.get(&h).cloned() else { break };
            ctx.emit(TraceEvent::Commitment { node: self.id, slot: b.slot, hash: h, level: Commitment::Finalized });
            if self.hero_block == Some(h) {
                self.tx_stage(ctx, TxStage::Finalized, Some(b.slot), Some(format!("rooted: {} confirmations deep in the tower", self.tower.max_history + 1)));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metrics::Metrics;
    use crate::{Scenario, Simulator};

    fn run(json: &str) -> (Simulator<Tower>, Vec<crate::Traced>) {
        let sc = Scenario::from_json(json).unwrap();
        let mut sim = Simulator::<Tower>::new(sc).unwrap();
        sim.run_to_end();
        let tr = sim.drain_trace();
        (sim, tr)
    }

    fn assert_consistent_roots(tr: &[crate::Traced]) {
        let mut by_slot: BTreeMap<u64, BTreeSet<BlockHash>> = BTreeMap::new();
        for t in tr {
            if let TraceEvent::Commitment { slot, hash, level: Commitment::Finalized, .. } = &t.ev {
                by_slot.entry(*slot).or_default().insert(*hash);
            }
        }
        for (s, hs) in by_slot {
            assert_eq!(hs.len(), 1, "conflicting roots in slot {s}: {hs:?}");
        }
    }

    #[test]
    fn happy_path_confirms_fast_and_roots_after_32_votes() {
        let (sim, tr) = run(r#"{"name":"happy","duration_ms":16000,"validators":{"count":25}}"#);
        let m = Metrics::from_trace(&tr);
        assert!(m.tx_stage_ms.contains_key("confirmed"), "{:?}", m.tx_stage_ms);
        let inc = m.tx_stage_ms["included_in_block"];
        assert!(m.tx_stage_ms["confirmed"] - inc < 1500.0, "OC took too long: {:?}", m.tx_stage_ms);
        assert!(m.tx_stage_ms.contains_key("finalized"), "never rooted: {:?}", m.tx_stage_ms);
        let fin = m.tx_stage_ms["finalized"] - inc;
        assert!(fin > 11_000.0 && fin < 15_000.0, "rooting should take ~12.8 s, took {fin}");
        assert!(m.vote_txs_in_blocks > 0, "vote txs must appear in blocks");
        assert_consistent_roots(&tr);
        assert!(sim.nodes.iter().all(|n| n.tower.root.is_some()));
    }

    #[test]
    fn leader_down_leaves_empty_slots_but_chain_continues() {
        let (_, tr) = run(r#"{"name":"leader-down","duration_ms":20000,"validators":{"count":25},
            "faults":[{"kind":"offline","target":{"leader_of_slot":4},"from_ms":1000,"to_ms":5000}]}"#);
        let m = Metrics::from_trace(&tr);
        assert!(m.blocks_produced < m.slots_started, "expected skipped slots");
        assert!(m.tx_stage_ms.contains_key("finalized"), "{:?}", m.tx_stage_ms);
        assert_consistent_roots(&tr);
    }

    #[test]
    fn short_partition_forks_then_converges() {
        let (sim, tr) = run(r#"{"name":"partition","duration_ms":20000,"validators":{"count":25},
            "hero_tx":{"submit_at_ms":6000},
            "faults":[{"kind":"partition","groups":{"stake_split":[0.5,0.5]},"from_ms":1500,"to_ms":2700}]}"#);
        assert_consistent_roots(&tr);
        let m = Metrics::from_trace(&tr);
        assert!(m.tx_stage_ms.contains_key("confirmed"), "cluster should recover after heal: {:?}", m.tx_stage_ms);
        // Everyone ends on the same head fork.
        let heads: BTreeSet<u64> = sim.nodes.iter().filter_map(|n| n.forks.slot_of(n.head)).collect();
        assert!(heads.len() <= 2, "heads diverged: {heads:?}");
    }
}
