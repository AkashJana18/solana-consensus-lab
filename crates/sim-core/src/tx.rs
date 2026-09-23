//! The "hero transaction" lifecycle shared by both protocols.

use serde::{Deserialize, Serialize};

pub type TxId = u32;

/// Stages a transaction passes through. Both protocols emit the same stages so
/// the UI can show a synchronized side-by-side timeline.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TxStage {
    /// Client handed the tx to an RPC node.
    Submitted,
    /// RPC node forwarded it to the current/upcoming leader (Gulf Stream).
    ForwardedToLeader,
    /// Leader placed it in a block (entry / slice).
    IncludedInBlock,
    /// Shreds carrying it are being propagated (Turbine / Rotor).
    Propagating,
    /// A supermajority (>2/3 stake) has reconstructed and replayed the block.
    Replayed,
    /// First vote cast for the block that contains it.
    Voted,
    /// Optimistically confirmed (Tower) / Notarized (Alpenglow).
    Confirmed,
    /// Rooted by supermajority (Tower) / Finalization or Fast-Finalization cert (Alpenglow).
    Finalized,
}

impl TxStage {
    pub const ALL: [TxStage; 8] = [
        TxStage::Submitted,
        TxStage::ForwardedToLeader,
        TxStage::IncludedInBlock,
        TxStage::Propagating,
        TxStage::Replayed,
        TxStage::Voted,
        TxStage::Confirmed,
        TxStage::Finalized,
    ];
}
