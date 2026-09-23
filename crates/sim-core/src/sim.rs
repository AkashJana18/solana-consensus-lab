//! The discrete-event simulator. Owns nodes, the event queue, network/fault
//! state, the RNG and the trace buffer. Fully serializable for snapshots.

use crate::network::{schedule_faults, FaultEvent, FaultState, Network};
use crate::protocol::{Action, Ctx, Env, MsgInfo, Protocol};
use crate::rng::Rng;
use crate::scenario::{Params, Scenario};
use crate::stake::{LeaderSchedule, NodeId, ValidatorSet};
use crate::time::{ms, SimTime};
use crate::trace::{DropReason, TraceEvent, Traced};
use crate::tx::TxId;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::BinaryHeap;

#[derive(Debug, thiserror::Error)]
pub enum SimError {
    #[error("invalid scenario: {0}")]
    InvalidScenario(String),
    #[error("serialization: {0}")]
    Serde(#[from] serde_json::Error),
}

#[derive(Serialize, Deserialize)]
#[serde(bound(
    serialize = "P::Msg: Serialize, P::Timer: Serialize",
    deserialize = "P::Msg: Deserialize<'de>, P::Timer: Deserialize<'de>"
))]
enum EventKind<P: Protocol> {
    Deliver { id: u64, from: NodeId, to: NodeId, msg: P::Msg },
    Timer { node: NodeId, timer: P::Timer },
    Slot(u64),
    ClientSubmit { node: NodeId, tx: TxId },
    Fault(FaultEvent),
}

#[derive(Serialize, Deserialize)]
#[serde(bound(
    serialize = "P::Msg: Serialize, P::Timer: Serialize",
    deserialize = "P::Msg: Deserialize<'de>, P::Timer: Deserialize<'de>"
))]
struct Event<P: Protocol> {
    at: SimTime,
    seq: u64,
    kind: EventKind<P>,
}

impl<P: Protocol> PartialEq for Event<P> {
    fn eq(&self, o: &Self) -> bool {
        self.at == o.at && self.seq == o.seq
    }
}
impl<P: Protocol> Eq for Event<P> {}
impl<P: Protocol> PartialOrd for Event<P> {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}
impl<P: Protocol> Ord for Event<P> {
    // Reversed so BinaryHeap pops the earliest (at, seq).
    fn cmp(&self, o: &Self) -> Ordering {
        o.at.cmp(&self.at).then_with(|| o.seq.cmp(&self.seq))
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Stats {
    pub events: u64,
    pub msgs_sent: u64,
    pub msgs_dropped: u64,
    pub bytes_sent: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(bound(
    serialize = "P::Msg: Serialize, P::Timer: Serialize, P::Node: Serialize",
    deserialize = "P::Msg: Deserialize<'de>, P::Timer: Deserialize<'de>, P::Node: Deserialize<'de>"
))]
pub struct Simulator<P: Protocol> {
    pub now: SimTime,
    pub end: SimTime,
    seq: u64,
    next_msg_id: u64,
    queue: BinaryHeap<Event<P>>,
    pub nodes: Vec<P::Node>,
    pub validators: ValidatorSet,
    pub schedule: LeaderSchedule,
    pub network: Network,
    pub faults: FaultState,
    pub rng: Rng,
    pub params: Params,
    pub scenario: Scenario,
    trace: Vec<Traced>,
    pub stats: Stats,
}

impl<P: Protocol> Simulator<P> {
    pub fn new(scenario: Scenario) -> Result<Self, SimError> {
        validate(&scenario)?;
        let mut rng = Rng::seed(scenario.seed);
        let validators = scenario.validators.build(&mut rng.fork(1));
        let n = validators.len();
        let network = Network::build(
            &scenario.network,
            &scenario.validators.regions,
            n,
            &mut rng.fork(2),
        );
        let num_slots = scenario.num_slots();
        let schedule = LeaderSchedule::generate(
            &validators,
            &mut rng.fork(3),
            num_slots,
            scenario.params.leader_window,
        );
        let faults = FaultState::new(n, scenario.network.base_drop_prob);
        let params = scenario.params.clone();
        let env = Env {
            validators: &validators,
            schedule: &schedule,
            params: &params,
            num_slots,
        };
        let nodes = (0..n as NodeId).map(|id| P::init(id, &env)).collect();

        let mut sim = Simulator {
            now: 0,
            end: ms(scenario.duration_ms),
            seq: 0,
            next_msg_id: 0,
            queue: BinaryHeap::new(),
            nodes,
            validators,
            schedule,
            network,
            faults,
            rng,
            params,
            scenario,
            trace: Vec::new(),
            stats: Stats::default(),
        };

        // Engine clock: one Slot event per slot boundary.
        for s in 0..num_slots {
            sim.push(s * sim.params.slot_ms * 1000, EventKind::Slot(s));
        }
        // Faults.
        let mut frng = sim.rng.fork(4);
        let fevents = schedule_faults(
            &sim.scenario,
            &sim.validators,
            &sim.schedule,
            &sim.network,
            &mut frng,
        );
        for (at, ev) in fevents {
            sim.push(at, EventKind::Fault(ev));
        }
        // Hero transaction.
        let rpc = sim
            .scenario
            .hero_tx
            .rpc_node
            .unwrap_or((n - 1) as NodeId)
            .min((n - 1) as NodeId);
        sim.push(
            ms(sim.scenario.hero_tx.submit_at_ms),
            EventKind::ClientSubmit { node: rpc, tx: 0 },
        );
        // Protocol start hooks.
        for id in 0..n as NodeId {
            sim.dispatch(id, |node, ctx| P::on_start(node, ctx));
        }
        Ok(sim)
    }

    fn push(&mut self, at: SimTime, kind: EventKind<P>) {
        self.seq += 1;
        self.queue.push(Event { at, seq: self.seq, kind });
    }

    pub fn next_event_time(&self) -> Option<SimTime> {
        self.queue.peek().map(|e| e.at)
    }

    pub fn is_done(&self) -> bool {
        match self.queue.peek() {
            Some(e) => e.at > self.end,
            None => true,
        }
    }

    /// Process one event. Returns false when the simulation is finished.
    pub fn step(&mut self) -> bool {
        let Some(ev) = self.queue.peek() else { return false };
        if ev.at > self.end {
            return false;
        }
        let ev = self.queue.pop().unwrap();
        self.now = ev.at;
        self.stats.events += 1;
        match ev.kind {
            EventKind::Deliver { id, from, to, msg } => {
                if self.faults.is_offline(to) {
                    self.stats.msgs_dropped += 1;
                    self.emit(TraceEvent::MsgDropped { id, reason: DropReason::ReceiverOffline });
                } else {
                    self.dispatch(to, |node, ctx| P::on_message(node, from, msg, ctx));
                }
            }
            EventKind::Timer { node, timer } => {
                if !self.faults.is_offline(node) {
                    self.dispatch(node, |n, ctx| P::on_timer(n, timer, ctx));
                }
            }
            EventKind::Slot(slot) => {
                if !P::ENGINE_SLOTS {
                    return true;
                }
                let leader = self.schedule.leader(slot);
                self.emit(TraceEvent::SlotStart { slot, leader });
                for id in 0..self.nodes.len() as NodeId {
                    if !self.faults.is_offline(id) {
                        self.dispatch(id, |n, ctx| P::on_slot(n, slot, ctx));
                    }
                }
            }
            EventKind::ClientSubmit { node, tx } => {
                // A client whose RPC node is down simply talks to another one.
                let target = if self.faults.is_offline(node) {
                    let alt = (0..self.nodes.len() as NodeId).rev().find(|n| !self.faults.is_offline(*n));
                    if let Some(alt) = alt {
                        self.emit(TraceEvent::Log { node: Some(node), msg: format!("RPC node {node} offline; client used node {alt} instead") });
                    }
                    alt
                } else {
                    Some(node)
                };
                if let Some(n) = target {
                    self.dispatch(n, |nd, ctx| P::on_client_tx(nd, tx, ctx));
                }
            }
            EventKind::Fault(f) => {
                self.faults.apply(&f);
                match &f {
                    FaultEvent::Offline(nodes) => {
                        for n in nodes {
                            self.emit(TraceEvent::NodeOffline { node: *n });
                        }
                    }
                    FaultEvent::Online(nodes) => {
                        for n in nodes {
                            self.emit(TraceEvent::NodeOnline { node: *n });
                        }
                    }
                    FaultEvent::PartitionStart { groups, .. } => {
                        self.emit(TraceEvent::PartitionStart { groups: groups.clone() });
                    }
                    FaultEvent::PartitionEnd => self.emit(TraceEvent::PartitionEnd),
                    FaultEvent::DelayStart(r) => {
                        let msg = format!("extra delay {} ms on {} nodes", r.extra_us / 1000, r.nodes.iter().filter(|b| **b).count());
                        self.emit(TraceEvent::Log { node: None, msg });
                    }
                    FaultEvent::DelayEnd(_) => self.emit(TraceEvent::Log { node: None, msg: "extra delay lifted".into() }),
                    FaultEvent::DropSet(p) => {
                        self.emit(TraceEvent::Log { node: None, msg: format!("message loss probability set to {p}") })
                    }
                }
            }
        }
        true
    }

    /// Run until the simulated clock reaches `t` (inclusive of events at `t`).
    pub fn run_until(&mut self, t: SimTime) {
        let t = t.min(self.end);
        while let Some(at) = self.next_event_time() {
            if at > t {
                break;
            }
            if !self.step() {
                break;
            }
        }
        if self.now < t {
            self.now = t;
        }
    }

    pub fn run_to_end(&mut self) {
        while self.step() {}
        self.now = self.end;
    }

    /// Take all trace events produced since the last drain.
    pub fn drain_trace(&mut self) -> Vec<Traced> {
        std::mem::take(&mut self.trace)
    }

    pub fn trace(&self) -> &[Traced] {
        &self.trace
    }

    pub fn inspect(&self, node: NodeId) -> serde_json::Value {
        P::inspect(&self.nodes[node as usize])
    }

    fn emit(&mut self, ev: TraceEvent) {
        self.trace.push(Traced { t: self.now, ev });
    }

    fn dispatch(&mut self, node: NodeId, f: impl FnOnce(&mut P::Node, &mut Ctx<P>)) {
        let actions = {
            let mut ctx = Ctx {
                now: self.now,
                me: node,
                validators: &self.validators,
                schedule: &self.schedule,
                params: &self.params,
                rng: &mut self.rng,
                trace: &mut self.trace,
                actions: Vec::new(),
            };
            f(&mut self.nodes[node as usize], &mut ctx);
            ctx.actions
        };
        for a in actions {
            match a {
                Action::Send { to, msg } => self.send(node, to, msg),
                Action::Broadcast { msg, include_self } => {
                    for to in 0..self.nodes.len() as NodeId {
                        if to != node {
                            self.send(node, to, msg.clone());
                        }
                    }
                    if include_self {
                        // Loop-back: deliver to self on the next tick.
                        let id = self.next_msg_id;
                        self.next_msg_id += 1;
                        self.push(self.now + 1, EventKind::Deliver { id, from: node, to: node, msg });
                    }
                }
                Action::Timer { at, timer } => self.push(at, EventKind::Timer { node, timer }),
            }
        }
    }

    fn send(&mut self, from: NodeId, to: NodeId, msg: P::Msg) {
        let id = self.next_msg_id;
        self.next_msg_id += 1;
        let bytes = msg.bytes();
        let kind = msg.kind().to_string();
        let slot = msg.slot();
        self.stats.msgs_sent += 1;
        self.stats.bytes_sent += bytes as u64;

        let mut dropped = None;
        if self.faults.is_offline(from) {
            dropped = Some(DropReason::SenderOffline);
        } else if self.faults.partitioned(from, to) {
            dropped = Some(DropReason::Partition);
        } else if self.faults.drop_prob > 0.0 && self.rng.chance(self.faults.drop_prob) {
            dropped = Some(DropReason::Random);
        }
        let arrive_at = self.network.transit(from, to, bytes, self.now, &mut self.rng)
            + self.faults.extra_delay(from, to);
        self.emit(TraceEvent::MsgSent { id, from, to, kind, bytes, arrive_at, dropped, slot });
        match dropped {
            Some(reason) => {
                self.stats.msgs_dropped += 1;
                self.emit(TraceEvent::MsgDropped { id, reason });
            }
            None => self.push(arrive_at, EventKind::Deliver { id, from, to, msg }),
        }
    }

    // ---- snapshots ----

    pub fn snapshot(&self) -> Result<Vec<u8>, SimError>
    where
        P::Node: Serialize,
    {
        Ok(serde_json::to_vec(self)?)
    }

    pub fn restore(bytes: &[u8]) -> Result<Self, SimError> {
        Ok(serde_json::from_slice(bytes)?)
    }
}

fn validate(sc: &Scenario) -> Result<(), SimError> {
    if sc.validators.count == 0 {
        return Err(SimError::InvalidScenario("validators.count must be > 0".into()));
    }
    if sc.validators.count > 4096 {
        return Err(SimError::InvalidScenario("validators.count too large (max 4096)".into()));
    }
    if sc.params.slot_ms == 0 || sc.params.leader_window == 0 {
        return Err(SimError::InvalidScenario("slot_ms and leader_window must be > 0".into()));
    }
    let a = &sc.params.alpenglow;
    if a.data_shreds == 0 || a.data_shreds > a.shreds_per_slice {
        return Err(SimError::InvalidScenario("alpenglow.data_shreds must be in 1..=shreds_per_slice".into()));
    }
    let t = &sc.params.tower;
    if t.fec_data_shreds == 0 {
        return Err(SimError::InvalidScenario("tower.fec_data_shreds must be > 0".into()));
    }
    if let Some(m) = &sc.network.latency_ms {
        let r = if !sc.validators.regions.is_empty() {
            sc.validators.regions.len()
        } else if !sc.network.regions.is_empty() {
            sc.network.regions.len()
        } else {
            6
        };
        if m.len() != r || m.iter().any(|row| row.len() != r) {
            return Err(SimError::InvalidScenario(format!("latency_ms must be a {r}x{r} matrix")));
        }
    }
    Ok(())
}
