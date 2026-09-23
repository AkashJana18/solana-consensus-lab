//! Alpenglow: Votor (voting) + Rotor (dissemination), per SIMD-0326 and the
//! Alpenglow white paper v1.1. Votes travel directly between validators (no
//! vote transactions), certificates are aggregated by anyone who sees a
//! quorum, and the leader paces itself from ParentReady + Δblock rather than
//! a global clock.

pub mod pool;
pub mod votor;

use super::blokstor::{BlockMeta, Blokstor, Shred};
use self::pool::{Cert, Pool, PoolEv, PoolOut, Vote};
use self::votor::{Votor, VotorAction};
use super::dissemination::{block_hash, mix, rotor_relays, turbine_children, weighted_order, SHRED_BYTES};
use super::{Ctx, Env, MsgInfo, Protocol};
use crate::scenario::Propagation;
use crate::stake::NodeId;
use crate::time::ms_f;
use crate::trace::{BlockHash, CertKind, Commitment, PoolEventKind, TraceEvent, VoteKind};
use crate::tx::{TxId, TxStage};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const GENESIS: BlockHash = 0;
pub const HERO_TX: TxId = 0;
const VOTE_BYTES: u32 = 150;
const CERT_BYTES: u32 = 1000;

pub struct Alpenglow;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Msg {
    Shred(Shred),
    Vote(Vote),
    Cert(Cert),
    RepairRequest { slot: u64, hash: BlockHash },
    RepairResponse(BlockMeta),
    TxForward(TxId),
}

impl MsgInfo for Msg {
    fn kind(&self) -> &'static str {
        match self {
            Msg::Shred(_) => "shred",
            Msg::Vote(v) => match v.kind {
                VoteKind::Notarize => "vote:notarize",
                VoteKind::NotarFallback => "vote:notar_fallback",
                VoteKind::Skip => "vote:skip",
                VoteKind::SkipFallback => "vote:skip_fallback",
                VoteKind::Finalize => "vote:finalize",
                VoteKind::Tower => "vote:tower",
            },
            Msg::Cert(c) => match c.kind {
                CertKind::Notarization => "cert:notarization",
                CertKind::NotarFallback => "cert:notar_fallback",
                CertKind::Skip => "cert:skip",
                CertKind::FastFinalization => "cert:fast_finalization",
                CertKind::Finalization => "cert:finalization",
            },
            Msg::RepairRequest { .. } => "repair:request",
            Msg::RepairResponse(_) => "repair:response",
            Msg::TxForward(_) => "tx",
        }
    }
    fn bytes(&self) -> u32 {
        match self {
            Msg::Shred(_) => SHRED_BYTES,
            Msg::Vote(_) => VOTE_BYTES,
            Msg::Cert(_) => CERT_BYTES,
            Msg::RepairRequest { .. } => 64,
            Msg::RepairResponse(b) => b.num_slices * 4 * SHRED_BYTES,
            Msg::TxForward(_) => 300,
        }
    }
    fn slot(&self) -> Option<u64> {
        match self {
            Msg::Shred(s) => Some(s.slot),
            Msg::Vote(v) => Some(v.slot),
            Msg::Cert(c) => Some(c.slot),
            Msg::RepairRequest { slot, .. } => Some(*slot),
            Msg::RepairResponse(b) => Some(b.slot),
            Msg::TxForward(_) => None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Timer {
    /// Votor timeout for a slot.
    Timeout(u64),
    /// Leader: emit the next slice of a block.
    ProduceSlice { slot: u64, slice: u32 },
    /// Block execution finished.
    Replayed(BlockHash),
    /// RPC node: re-forward a transaction that has not landed yet (Gulf Stream retry).
    TxRetry(TxId),
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct LeaderState {
    started: BTreeSet<u64>,
    parent_for: BTreeMap<u64, BlockHash>,
    /// slot -> (hash, parent)
    produced: BTreeMap<u64, (BlockHash, BlockHash)>,
    block_txs: BTreeMap<BlockHash, Vec<TxId>>,
    pending_txs: Vec<TxId>,
    seen_txs: BTreeSet<TxId>,
    included: BTreeSet<TxId>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    total_stake: u64,
    pub votor: Votor,
    pub pool: Pool,
    pub blokstor: Blokstor,
    pub leader: LeaderState,
    pub finalized: BTreeSet<BlockHash>,
    pub highest_finalized_slot: Option<u64>,
    final_certs: BTreeSet<u64>,
    notarized_by_slot: BTreeMap<u64, BlockHash>,
    received: BTreeSet<BlockHash>,
    replayed: BTreeSet<BlockHash>,
    repair_requested: BTreeSet<BlockHash>,
    hero_block: Option<BlockHash>,
    tx_retries: u32,
}

impl Protocol for Alpenglow {
    const NAME: &'static str = "alpenglow";
    const ENGINE_SLOTS: bool = false;
    type Msg = Msg;
    type Timer = Timer;
    type Node = Node;

    fn init(id: NodeId, env: &Env) -> Node {
        let w = env.params.leader_window;
        Node {
            id,
            total_stake: env.validators.total,
            votor: Votor::new(w),
            pool: Pool::new(w),
            blokstor: Blokstor::default(),
            leader: LeaderState::default(),
            finalized: BTreeSet::new(),
            highest_finalized_slot: None,
            final_certs: BTreeSet::new(),
            notarized_by_slot: BTreeMap::new(),
            received: BTreeSet::new(),
            replayed: BTreeSet::new(),
            repair_requested: BTreeSet::new(),
            hero_block: None,
            tx_retries: 0,
        }
    }

    fn on_start(node: &mut Node, ctx: &mut Ctx<Self>) {
        // Genesis is ready for everyone: ParentReady(0, GENESIS).
        let me = node.id;
        ctx.emit(TraceEvent::PoolEvent { node: me, slot: 0, kind: PoolEventKind::ParentReady, hash: Some(GENESIS) });
        let mut acts = Vec::new();
        node.votor.on_parent_ready(0, GENESIS, &mut acts);
        node.apply_votor(acts, ctx);
        if ctx.is_leader(0) {
            node.start_window(0, GENESIS, ctx);
        }
    }

    fn on_message(node: &mut Node, from: NodeId, msg: Msg, ctx: &mut Ctx<Self>) {
        match msg {
            Msg::Shred(sh) => node.on_shred(from, sh, ctx),
            Msg::Vote(v) => {
                let own = node.votor.view(v.slot);
                let out = node.pool.add_vote(&v, ctx.validators, &ctx.params.alpenglow, own);
                node.apply_pool(out, ctx);
            }
            Msg::Cert(c) => {
                let own = node.votor.view(c.slot);
                let out = node.pool.add_cert(&c, ctx.validators, &ctx.params.alpenglow, own);
                node.apply_pool(out, ctx);
            }
            Msg::RepairRequest { hash, .. } => {
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
            Timer::Timeout(slot) => {
                ctx.emit(TraceEvent::Timeout { node: node.id, slot });
                let mut acts = Vec::new();
                node.votor.on_timeout(slot, &mut acts);
                node.apply_votor(acts, ctx);
            }
            Timer::ProduceSlice { slot, slice } => node.produce_slice(slot, slice, ctx),
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
        let hi = node
            .pool
            .highest_slot()
            .max(node.votor.slots.keys().next_back().copied().unwrap_or(0));
        let lo = hi.saturating_sub(7);
        serde_json::json!({
            "protocol": "alpenglow",
            "node": node.id,
            "highest_finalized_slot": node.highest_finalized_slot,
            "finalized_blocks": node.finalized.len(),
            "hero_block": node.hero_block,
            "votor": node.votor.inspect(lo, hi),
            "pool": (lo..=hi).map(|s| node.pool.tallies(s, node.total_stake)).collect::<Vec<_>>(),
            "leader": {
                "pending_txs": node.leader.pending_txs,
                "produced_slots": node.leader.produced.keys().collect::<Vec<_>>(),
            },
        })
    }
}

impl Node {
    fn tx_stage(&self, ctx: &mut Ctx<Alpenglow>, stage: TxStage, slot: Option<u64>, detail: Option<String>) {
        ctx.emit(TraceEvent::TxStage { tx: HERO_TX, stage, node: Some(self.id), slot, detail });
    }

    fn accept_tx(&mut self, tx: TxId) {
        if self.leader.seen_txs.insert(tx) && !self.leader.included.contains(&tx) {
            self.leader.pending_txs.push(tx);
        }
    }

    /// Gulf Stream: send the tx to the leader of the slot we believe is
    /// current and to the next window's leader; retry each slot until it lands.
    fn forward_tx(&mut self, tx: TxId, retry: bool, ctx: &mut Ctx<Alpenglow>) {
        let cur = self.pool.highest_slot().max(ctx.current_slot());
        let next_window = ctx.schedule.window_start(cur) + ctx.params.leader_window;
        let mut leaders = vec![ctx.leader(cur)];
        let nl = ctx.leader(next_window);
        if !leaders.contains(&nl) {
            leaders.push(nl);
        }
        let detail = if retry { format!("retry {} → leaders {leaders:?}", self.tx_retries) } else { format!("Gulf Stream → leaders {leaders:?}") };
        if !retry {
            self.tx_stage(ctx, TxStage::ForwardedToLeader, Some(cur), Some(detail));
        } else {
            ctx.emit(TraceEvent::Log { node: Some(self.id), msg: format!("tx {tx} not seen in a block yet; {detail}") });
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

    // ------------------------------------------------------------ voting

    fn cast(&mut self, kind: VoteKind, slot: u64, hash: Option<BlockHash>, ctx: &mut Ctx<Alpenglow>) {
        ctx.emit(TraceEvent::Vote { node: self.id, slot, kind, hash });
        if kind == VoteKind::Notarize && hash.is_some() && hash == self.hero_block {
            self.tx_stage(ctx, TxStage::Voted, Some(slot), None);
        }
        ctx.broadcast_all(Msg::Vote(Vote { voter: self.id, slot, kind, hash }));
    }

    fn apply_votor(&mut self, acts: Vec<VotorAction>, ctx: &mut Ctx<Alpenglow>) {
        let mut touched = BTreeSet::new();
        for a in acts {
            match a {
                VotorAction::Vote(kind, slot, hash) => {
                    self.cast(kind, slot, hash, ctx);
                    touched.insert(slot);
                }
                VotorAction::SetTimeouts { first_slot } => {
                    let timeout = ms_f(ctx.params.alpenglow.timeout_ms);
                    let block = ctx.slot_duration();
                    for i in 0..ctx.params.leader_window {
                        ctx.set_timer(timeout + i * block, Timer::Timeout(first_slot + i));
                    }
                }
                VotorAction::Flag(slot, flag, hash) => {
                    ctx.emit(TraceEvent::VotorFlag { node: self.id, slot, flag, hash });
                }
            }
        }
        // Our own first-round vote changes what SafeToNotar/SafeToSkip may fire.
        for slot in touched {
            let own = self.votor.view(slot);
            let out = self.pool.evaluate(slot, ctx.validators, &ctx.params.alpenglow, own);
            self.apply_pool(out, ctx);
        }
    }

    fn apply_pool(&mut self, out: PoolOut, ctx: &mut Ctx<Alpenglow>) {
        let me = self.id;
        for c in &out.new_certs {
            ctx.emit(TraceEvent::Certificate {
                node: me,
                slot: c.slot,
                kind: c.kind,
                hash: c.hash,
                stake_pct: ctx.validators.pct(c.stake),
            });
            ctx.broadcast(Msg::Cert(c.clone()));
        }
        let mut acts = Vec::new();
        for ev in out.events {
            match ev {
                PoolEv::BlockNotarized(s, h) => {
                    ctx.emit(TraceEvent::PoolEvent { node: me, slot: s, kind: PoolEventKind::BlockNotarized, hash: Some(h) });
                    self.notarized_by_slot.insert(s, h);
                    ctx.emit(TraceEvent::Commitment { node: me, slot: s, hash: h, level: Commitment::Confirmed });
                    if self.hero_block == Some(h) {
                        self.tx_stage(ctx, TxStage::Confirmed, Some(s), Some("notarization certificate (≥60%)".into()));
                    }
                    self.votor.on_block_notarized(s, h, &mut acts);
                    self.maybe_repair(s, h, ctx);
                    self.check_slow_final(s, ctx);
                }
                PoolEv::NotarFallbackCert(s, h) => self.maybe_repair(s, h, ctx),
                PoolEv::Skipped(_) => {}
                PoolEv::FastFinalized(s, h) => {
                    self.maybe_repair(s, h, ctx);
                    self.finalize_block(s, h, "fast-finalization certificate (≥80%)", ctx);
                }
                PoolEv::Finalized(s) => {
                    self.final_certs.insert(s);
                    self.check_slow_final(s, ctx);
                }
                PoolEv::SafeToNotar(s, h) => {
                    ctx.emit(TraceEvent::PoolEvent { node: me, slot: s, kind: PoolEventKind::SafeToNotar, hash: Some(h) });
                    self.votor.on_safe_to_notar(s, h, &mut acts);
                }
                PoolEv::SafeToSkip(s) => {
                    ctx.emit(TraceEvent::PoolEvent { node: me, slot: s, kind: PoolEventKind::SafeToSkip, hash: None });
                    self.votor.on_safe_to_skip(s, &mut acts);
                }
                PoolEv::ParentReady(s, h) => {
                    ctx.emit(TraceEvent::PoolEvent { node: me, slot: s, kind: PoolEventKind::ParentReady, hash: Some(h) });
                    self.votor.on_parent_ready(s, h, &mut acts);
                    if ctx.is_leader(s) {
                        self.start_window(s, h, ctx);
                    }
                }
            }
        }
        if !acts.is_empty() {
            self.apply_votor(acts, ctx);
        }
    }

    fn check_slow_final(&mut self, slot: u64, ctx: &mut Ctx<Alpenglow>) {
        if self.final_certs.contains(&slot) {
            if let Some(h) = self.notarized_by_slot.get(&slot).copied() {
                self.finalize_block(slot, h, "finalization certificate (≥60% finalize votes)", ctx);
            }
        }
    }

    fn finalize_block(&mut self, slot: u64, hash: BlockHash, why: &str, ctx: &mut Ctx<Alpenglow>) {
        if self.finalized.insert(hash) {
            self.highest_finalized_slot = Some(self.highest_finalized_slot.map_or(slot, |s| s.max(slot)));
            ctx.emit(TraceEvent::Commitment { node: self.id, slot, hash, level: Commitment::Finalized });
            if self.hero_block == Some(hash) {
                self.tx_stage(ctx, TxStage::Finalized, Some(slot), Some(why.to_string()));
            }
        }
        self.finalize_ancestors(hash, ctx);
    }

    /// Finality is inherited by ancestors (which we can only walk if we hold them).
    fn finalize_ancestors(&mut self, hash: BlockHash, ctx: &mut Ctx<Alpenglow>) {
        let mut cur = self.blokstor.get(hash).map(|m| m.parent);
        while let Some(p) = cur {
            if p == GENESIS {
                break;
            }
            let Some(meta) = self.blokstor.get(p).cloned() else { break };
            if !self.finalized.insert(p) {
                break;
            }
            ctx.emit(TraceEvent::Commitment { node: self.id, slot: meta.slot, hash: p, level: Commitment::Finalized });
            if self.hero_block == Some(p) {
                self.tx_stage(ctx, TxStage::Finalized, Some(meta.slot), Some("descendant finalized".into()));
            }
            cur = Some(meta.parent);
        }
    }

    fn maybe_repair(&mut self, slot: u64, hash: BlockHash, ctx: &mut Ctx<Alpenglow>) {
        // A certificate proves a supermajority holds this block: fetch it if we don't.
        if self.blokstor.has(hash) || !self.repair_requested.insert(hash) {
            return;
        }
        let leader = ctx.leader(slot);
        if leader != self.id {
            ctx.send(leader, Msg::RepairRequest { slot, hash });
        }
        let n = ctx.n() as u64;
        let peer = ctx.rng.below(n) as NodeId;
        if peer != self.id && peer != leader {
            ctx.send(peer, Msg::RepairRequest { slot, hash });
        }
    }

    // ------------------------------------------------------------ blocks

    fn on_shred(&mut self, from: NodeId, sh: Shred, ctx: &mut Ctx<Alpenglow>) {
        let ap = ctx.params.alpenglow.clone();
        let me = self.id;
        let (is_new, complete) = self.blokstor.add_shred(&sh, ap.shreds_per_slice, ap.data_shreds);
        if is_new {
            match ap.propagation {
                Propagation::Rotor => {
                    // Single hop: the designated relay re-broadcasts to everyone else.
                    if from == sh.leader && sh.relay == me {
                        for to in 0..ctx.n() as NodeId {
                            if to != me && to != sh.leader {
                                ctx.send(to, Msg::Shred(sh.clone()));
                            }
                        }
                    }
                }
                Propagation::Turbine => {
                    let order = weighted_order(ctx.validators, Some(sh.leader), mix(sh.slot, sh.slice as u64, sh.index as u64));
                    for c in turbine_children(&order, me, ap.turbine_fanout) {
                        ctx.send(c, Msg::Shred(sh.clone()));
                    }
                }
            }
        }
        if let Some(meta) = complete {
            self.on_block_complete(meta, ctx);
        }
    }

    fn on_block_complete(&mut self, meta: BlockMeta, ctx: &mut Ctx<Alpenglow>) {
        if !self.received.insert(meta.hash) {
            return;
        }
        ctx.emit(TraceEvent::BlockReceived { node: self.id, slot: meta.slot, hash: meta.hash });
        if meta.txs.contains(&HERO_TX) {
            self.hero_block = Some(meta.hash);
            self.leader.included.insert(HERO_TX);
        }
        ctx.set_timer(ms_f(ctx.params.exec_delay_ms), Timer::Replayed(meta.hash));
    }

    fn on_replayed(&mut self, hash: BlockHash, ctx: &mut Ctx<Alpenglow>) {
        let Some(meta) = self.blokstor.get(hash).cloned() else { return };
        if !self.replayed.insert(hash) {
            return;
        }
        ctx.emit(TraceEvent::BlockReplayed { node: self.id, slot: meta.slot, hash });
        ctx.emit(TraceEvent::Commitment { node: self.id, slot: meta.slot, hash, level: Commitment::Processed });
        if meta.txs.contains(&HERO_TX) {
            self.tx_stage(ctx, TxStage::Replayed, Some(meta.slot), None);
        }
        let mut acts = Vec::new();
        self.votor.on_block(&meta, &mut acts);
        self.apply_votor(acts, ctx);
        if self.finalized.contains(&hash) {
            self.finalize_ancestors(hash, ctx);
        }
    }

    // ------------------------------------------------------------ leader

    fn start_window(&mut self, first_slot: u64, parent: BlockHash, ctx: &mut Ctx<Alpenglow>) {
        if !ctx.schedule.is_window_start(first_slot) || !self.leader.started.insert(first_slot) {
            return;
        }
        self.leader.parent_for.insert(first_slot, parent);
        let block = ctx.slot_duration();
        for i in 0..ctx.params.leader_window {
            ctx.set_timer(i * block, Timer::ProduceSlice { slot: first_slot + i, slice: 0 });
        }
    }

    fn produce_slice(&mut self, slot: u64, slice: u32, ctx: &mut Ctx<Alpenglow>) {
        let ap = ctx.params.alpenglow.clone();
        let me = self.id;
        let ws = ctx.schedule.window_start(slot);
        let (hash, parent) = if slice == 0 {
            let parent = if slot == ws {
                match self.leader.parent_for.get(&ws) {
                    Some(p) => *p,
                    None => return,
                }
            } else {
                match self.leader.produced.get(&(slot - 1)) {
                    Some((h, _)) => *h,
                    None => return,
                }
            };
            let hash = block_hash(slot, me, parent, 0);
            self.leader.produced.insert(slot, (hash, parent));
            self.leader.block_txs.insert(hash, Vec::new());
            ctx.emit(TraceEvent::SlotStart { slot, leader: me });
            let txs: Vec<TxId> = self.leader.pending_txs.iter().copied().filter(|t| !self.leader.included.contains(t)).collect();
            ctx.emit(TraceEvent::BlockProduced { slot, hash, parent, leader: me, txs, vote_txs: 0 });
            (hash, parent)
        } else {
            match self.leader.produced.get(&slot) {
                Some(hp) => *hp,
                None => return,
            }
        };

        // Transactions waiting at this leader go into this slice.
        let pending = std::mem::take(&mut self.leader.pending_txs);
        let txs: Vec<TxId> = pending.into_iter().filter(|t| !self.leader.included.contains(t)).collect();
        for t in &txs {
            self.leader.included.insert(*t);
        }
        if txs.contains(&HERO_TX) {
            self.hero_block = Some(hash);
            self.tx_stage(ctx, TxStage::IncludedInBlock, Some(slot), Some(format!("slice {slice} of block in slot {slot}")));
            self.tx_stage(ctx, TxStage::Propagating, Some(slot), Some(match ap.propagation {
                Propagation::Rotor => "Rotor: leader → stake-weighted relays → everyone".to_string(),
                Propagation::Turbine => format!("Turbine tree, fanout {}", ap.turbine_fanout),
            }));
        }
        self.leader.block_txs.entry(hash).or_default().extend(txs.iter().copied());

        let num_slices = ap.slices_per_block;
        let relays = match ap.propagation {
            Propagation::Rotor => rotor_relays(ctx.validators, me, mix(slot, slice as u64, hash), ap.shreds_per_slice as usize),
            Propagation::Turbine => (0..ap.shreds_per_slice)
                .map(|idx| weighted_order(ctx.validators, Some(me), mix(slot, slice as u64, idx as u64))[0])
                .collect(),
        };
        for idx in 0..ap.shreds_per_slice {
            let relay = relays[idx as usize];
            let sh = Shred { slot, hash, parent, leader: me, slice, index: idx, num_slices, txs: txs.clone(), relay, vote_txs: 0 };
            ctx.send(relay, Msg::Shred(sh));
        }

        if slice + 1 < num_slices {
            ctx.set_timer(ctx.slot_duration() / num_slices as u64, Timer::ProduceSlice { slot, slice: slice + 1 });
        } else {
            let all_txs = self.leader.block_txs.get(&hash).cloned().unwrap_or_default();
            let meta = BlockMeta { slot, hash, parent, leader: me, txs: all_txs, num_slices, vote_txs: 0 };
            self.blokstor.add_block(meta.clone());
            self.on_block_complete(meta, ctx);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metrics::Metrics;
    use crate::{Scenario, Simulator};

    fn run(json: &str) -> (Simulator<Alpenglow>, Vec<crate::Traced>) {
        let sc = Scenario::from_json(json).unwrap();
        let mut sim = Simulator::<Alpenglow>::new(sc).unwrap();
        sim.run_to_end();
        let tr = sim.drain_trace();
        (sim, tr)
    }

    /// Safety: for each slot, all nodes that finalized a block finalized the same one.
    fn assert_consistent_finality(tr: &[crate::Traced]) {
        let mut by_slot: BTreeMap<u64, BTreeSet<BlockHash>> = BTreeMap::new();
        for t in tr {
            if let TraceEvent::Commitment { slot, hash, level: Commitment::Finalized, .. } = &t.ev {
                by_slot.entry(*slot).or_default().insert(*hash);
            }
        }
        for (s, hs) in by_slot {
            assert_eq!(hs.len(), 1, "conflicting finalization in slot {s}: {hs:?}");
        }
    }

    #[test]
    fn happy_path_fast_finalizes_hero_tx() {
        let (sim, tr) = run(r#"{"name":"happy","duration_ms":6000,"validators":{"count":25}}"#);
        let m = Metrics::from_trace(&tr);
        assert!(m.tx_stage_ms.contains_key("finalized"), "hero tx never finalized: {:?}", m.tx_stage_ms);
        assert!(m.certificates.get("fast_finalization").copied().unwrap_or(0) > 0, "expected fast path: {:?}", m.certificates);
        let fin = m.tx_stage_ms["finalized"] - m.tx_stage_ms["included_in_block"];
        assert!(fin < 1500.0, "finality took {fin} ms after inclusion");
        assert_consistent_finality(&tr);
        assert!(sim.nodes.iter().all(|n| n.highest_finalized_slot.is_some()));
    }

    #[test]
    fn offline_quarter_uses_slow_path() {
        let (_, tr) = run(r#"{"name":"offline","duration_ms":8000,"validators":{"count":25},
            "faults":[{"kind":"offline","target":{"stake_pct":0.25},"from_ms":0}]}"#);
        let m = Metrics::from_trace(&tr);
        assert!(m.tx_stage_ms.contains_key("finalized"), "hero tx never finalized: {:?}", m.tx_stage_ms);
        assert_eq!(m.certificates.get("fast_finalization").copied().unwrap_or(0), 0, "fast path impossible with 25% offline");
        assert!(m.certificates.get("finalization").copied().unwrap_or(0) > 0);
        assert_consistent_finality(&tr);
    }

    #[test]
    fn leader_down_window_is_skipped_and_chain_continues() {
        let (_, tr) = run(r#"{"name":"leader-down","duration_ms":10000,"validators":{"count":25},
            "faults":[{"kind":"offline","target":{"leader_of_slot":4},"from_ms":1000,"to_ms":5000}]}"#);
        let m = Metrics::from_trace(&tr);
        assert!(m.certificates.get("skip").copied().unwrap_or(0) >= 1, "expected skip certs: {:?}", m.certificates);
        assert!(m.tx_stage_ms.contains_key("finalized"));
        assert_consistent_finality(&tr);
    }

    #[test]
    fn partition_never_conflicts() {
        let (_, tr) = run(r#"{"name":"partition","duration_ms":12000,"validators":{"count":25},
            "faults":[{"kind":"partition","groups":{"stake_split":[0.5,0.5]},"from_ms":1500,"to_ms":5000}]}"#);
        assert_consistent_finality(&tr);
        let m = Metrics::from_trace(&tr);
        assert!(m.tx_stage_ms.contains_key("finalized"), "chain should resume after heal: {:?}", m.tx_stage_ms);
    }
}
