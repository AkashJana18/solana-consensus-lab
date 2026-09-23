//! Trivial protocol used to test the engine: node 0 pings everyone at start,
//! everyone pongs back.

use super::{Ctx, Env, MsgInfo, Protocol};
use crate::stake::NodeId;
use crate::tx::TxId;
use serde::{Deserialize, Serialize};

pub struct Ping;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Msg {
    Ping,
    Pong,
}

impl MsgInfo for Msg {
    fn kind(&self) -> &'static str {
        match self {
            Msg::Ping => "ping",
            Msg::Pong => "pong",
        }
    }
    fn bytes(&self) -> u32 {
        64
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    pub pongs: u32,
}

impl Protocol for Ping {
    const NAME: &'static str = "ping";
    type Msg = Msg;
    type Timer = ();
    type Node = Node;

    fn init(id: NodeId, _env: &Env) -> Node {
        Node { id, pongs: 0 }
    }

    fn on_start(node: &mut Node, ctx: &mut Ctx<Self>) {
        if node.id == 0 {
            ctx.broadcast(Msg::Ping);
        }
    }

    fn on_message(node: &mut Node, from: NodeId, msg: Msg, ctx: &mut Ctx<Self>) {
        match msg {
            Msg::Ping => ctx.send(from, Msg::Pong),
            Msg::Pong => node.pongs += 1,
        }
    }

    fn on_timer(_node: &mut Node, _timer: (), _ctx: &mut Ctx<Self>) {}

    fn on_client_tx(_node: &mut Node, _tx: TxId, _ctx: &mut Ctx<Self>) {}
}
