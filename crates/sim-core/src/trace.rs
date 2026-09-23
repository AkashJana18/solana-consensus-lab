//! Trace events: the single source of truth consumed by the web UI, the CLI
//! and the metrics module. Everything the visualization shows is derived from
//! this stream, so the UI can never disagree with the simulation.

use crate::stake::NodeId;
use crate::time::SimTime;
use crate::tx::{TxId, TxStage};
use serde::{Deserialize, Serialize};

/// Simulated block identifier (stands in for a real hash).
pub type BlockHash = u64;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Traced {
    pub t: SimTime,
    #[serde(flatten)]
    pub ev: TraceEvent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DropReason {
    Partition,
    Random,
    ReceiverOffline,
    SenderOffline,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoteKind {
    // Alpenglow / Votor
    Notarize,
    NotarFallback,
    Skip,
    SkipFallback,
    Finalize,
    // TowerBFT (a vote transaction carrying the tower)
    Tower,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CertKind {
    Notarization,
    NotarFallback,
    Skip,
    FastFinalization,
    Finalization,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PoolEventKind {
    BlockNotarized,
    ParentReady,
    SafeToNotar,
    SafeToSkip,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VotorFlag {
    Voted,
    VotedNotar,
    BadWindow,
    ItsOver,
    BlockNotarized,
    ParentReady,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Commitment {
    Processed,
    Confirmed,
    Finalized,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Lockout {
    pub slot: u64,
    pub confirmation_count: u32,
}

impl Lockout {
    pub fn lockout(&self) -> u64 {
        1u64 << self.confirmation_count.min(63)
    }
    /// Last slot this vote is locked out through.
    pub fn last_locked_out_slot(&self) -> u64 {
        self.slot + self.lockout()
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TraceEvent {
    // ---- engine ----
    SlotStart {
        slot: u64,
        leader: NodeId,
    },
    MsgSent {
        id: u64,
        from: NodeId,
        to: NodeId,
        kind: String,
        bytes: u32,
        /// When the message arrives (or would have, if dropped).
        arrive_at: SimTime,
        #[serde(skip_serializing_if = "Option::is_none")]
        dropped: Option<DropReason>,
        #[serde(skip_serializing_if = "Option::is_none")]
        slot: Option<u64>,
    },
    MsgDropped {
        id: u64,
        reason: DropReason,
    },
    NodeOffline {
        node: NodeId,
    },
    NodeOnline {
        node: NodeId,
    },
    PartitionStart {
        groups: Vec<Vec<NodeId>>,
    },
    PartitionEnd,
    // ---- protocol-generic ----
    BlockProduced {
        slot: u64,
        hash: BlockHash,
        parent: BlockHash,
        leader: NodeId,
        txs: Vec<TxId>,
        /// Vote transactions packed into the block (TowerBFT; 0 under Alpenglow).
        #[serde(default)]
        vote_txs: u32,
    },
    /// Node has reconstructed the full block from shreds.
    BlockReceived {
        node: NodeId,
        slot: u64,
        hash: BlockHash,
    },
    /// Node has executed (replayed) the block.
    BlockReplayed {
        node: NodeId,
        slot: u64,
        hash: BlockHash,
    },
    Vote {
        node: NodeId,
        slot: u64,
        kind: VoteKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        hash: Option<BlockHash>,
    },
    /// A node observed enough votes to form (or receive) a certificate.
    Certificate {
        node: NodeId,
        slot: u64,
        kind: CertKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        hash: Option<BlockHash>,
        stake_pct: f64,
    },
    PoolEvent {
        node: NodeId,
        slot: u64,
        kind: PoolEventKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        hash: Option<BlockHash>,
    },
    VotorFlag {
        node: NodeId,
        slot: u64,
        flag: VotorFlag,
        #[serde(skip_serializing_if = "Option::is_none")]
        hash: Option<BlockHash>,
    },
    Timeout {
        node: NodeId,
        slot: u64,
    },
    TowerUpdate {
        node: NodeId,
        lockouts: Vec<Lockout>,
        #[serde(skip_serializing_if = "Option::is_none")]
        root: Option<u64>,
    },
    ForkChoice {
        node: NodeId,
        head_slot: u64,
        head_hash: BlockHash,
    },
    /// A node's local view of a block reaching a commitment level.
    Commitment {
        node: NodeId,
        slot: u64,
        hash: BlockHash,
        level: Commitment,
    },
    TxStage {
        tx: TxId,
        stage: TxStage,
        #[serde(skip_serializing_if = "Option::is_none")]
        node: Option<NodeId>,
        #[serde(skip_serializing_if = "Option::is_none")]
        slot: Option<u64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
    Log {
        #[serde(skip_serializing_if = "Option::is_none")]
        node: Option<NodeId>,
        msg: String,
    },
}
