//! Protocol abstraction. A protocol is a set of pure handlers over per-node
//! state; all side effects are expressed as `Action`s collected in `Ctx` and
//! applied by the simulator after the handler returns.

pub mod alpenglow;
pub mod blokstor;
pub mod dissemination;
pub mod ping;
pub mod tower;

use crate::rng::Rng;
use crate::scenario::Params;
use crate::stake::{LeaderSchedule, NodeId, ValidatorSet};
use crate::time::SimTime;
use crate::trace::{TraceEvent, Traced};
use crate::tx::TxId;
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fmt::Debug;

/// Metadata the network layer needs from a message.
pub trait MsgInfo {
    /// Short label used by the UI to color particles, e.g. "shred", "vote:notarize".
    fn kind(&self) -> &'static str;
    fn bytes(&self) -> u32;
    fn slot(&self) -> Option<u64> {
        None
    }
}

/// Read-only environment available when constructing nodes.
pub struct Env<'a> {
    pub validators: &'a ValidatorSet,
    pub schedule: &'a LeaderSchedule,
    pub params: &'a Params,
    pub num_slots: u64,
}

pub trait Protocol: Sized + 'static {
    const NAME: &'static str;
    /// Whether the engine's fixed slot clock is meaningful for this protocol.
    /// TowerBFT (PoH) yes; Alpenglow paces itself from ParentReady + Δblock.
    const ENGINE_SLOTS: bool = true;
    type Msg: Clone + Debug + MsgInfo + Serialize + DeserializeOwned;
    type Timer: Clone + Debug + Serialize + DeserializeOwned;
    type Node: Debug + Serialize + DeserializeOwned;

    fn init(id: NodeId, env: &Env) -> Self::Node;
    fn on_start(_node: &mut Self::Node, _ctx: &mut Ctx<Self>) {}
    /// Global slot boundary (engine clock). Protocols may use it as a coarse
    /// local clock; Votor timeouts and PoH remain protocol-owned.
    fn on_slot(_node: &mut Self::Node, _slot: u64, _ctx: &mut Ctx<Self>) {}
    fn on_message(node: &mut Self::Node, from: NodeId, msg: Self::Msg, ctx: &mut Ctx<Self>);
    fn on_timer(node: &mut Self::Node, timer: Self::Timer, ctx: &mut Ctx<Self>);
    fn on_client_tx(node: &mut Self::Node, tx: TxId, ctx: &mut Ctx<Self>);
    /// Structured view of node state for the inspector panels.
    fn inspect(_node: &Self::Node) -> serde_json::Value {
        serde_json::Value::Null
    }
}

pub enum Action<P: Protocol> {
    Send { to: NodeId, msg: P::Msg },
    Broadcast { msg: P::Msg, include_self: bool },
    Timer { at: SimTime, timer: P::Timer },
}

pub struct Ctx<'a, P: Protocol> {
    pub now: SimTime,
    pub me: NodeId,
    pub validators: &'a ValidatorSet,
    pub schedule: &'a LeaderSchedule,
    pub params: &'a Params,
    pub rng: &'a mut Rng,
    pub(crate) trace: &'a mut Vec<Traced>,
    pub(crate) actions: Vec<Action<P>>,
}

impl<'a, P: Protocol> Ctx<'a, P> {
    pub fn n(&self) -> usize {
        self.validators.len()
    }

    pub fn send(&mut self, to: NodeId, msg: P::Msg) {
        self.actions.push(Action::Send { to, msg });
    }

    /// Send to every other node.
    pub fn broadcast(&mut self, msg: P::Msg) {
        self.actions.push(Action::Broadcast { msg, include_self: false });
    }

    /// Send to every node including a loop-back delivery to self.
    pub fn broadcast_all(&mut self, msg: P::Msg) {
        self.actions.push(Action::Broadcast { msg, include_self: true });
    }

    pub fn set_timer(&mut self, delay: SimTime, timer: P::Timer) {
        self.actions.push(Action::Timer { at: self.now + delay, timer });
    }

    pub fn set_timer_at(&mut self, at: SimTime, timer: P::Timer) {
        self.actions.push(Action::Timer { at: at.max(self.now), timer });
    }

    pub fn emit(&mut self, ev: TraceEvent) {
        self.trace.push(Traced { t: self.now, ev });
    }

    pub fn log(&mut self, msg: impl Into<String>) {
        let me = self.me;
        self.emit(TraceEvent::Log { node: Some(me), msg: msg.into() });
    }

    pub fn leader(&self, slot: u64) -> NodeId {
        self.schedule.leader(slot)
    }

    pub fn is_leader(&self, slot: u64) -> bool {
        self.schedule.leader(slot) == self.me
    }

    pub fn slot_duration(&self) -> SimTime {
        self.params.slot_ms * 1000
    }

    /// Engine slot for the current time (coarse global clock).
    pub fn current_slot(&self) -> u64 {
        self.now / self.slot_duration()
    }
}
