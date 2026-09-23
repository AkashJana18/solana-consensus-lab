//! Block store shared by both protocols: collects shreds per (slot, block)
//! and reports when a block is fully reconstructed (Alpenglow slices or
//! Turbine FEC sets). Repair delivers whole blocks directly.

use crate::stake::NodeId;
use crate::trace::BlockHash;
use crate::tx::TxId;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockMeta {
    pub slot: u64,
    pub hash: BlockHash,
    pub parent: BlockHash,
    pub leader: NodeId,
    pub txs: Vec<TxId>,
    pub num_slices: u32,
    /// Vote transactions carried by the block (TowerBFT only; 0 under Alpenglow).
    #[serde(default)]
    pub vote_txs: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Shred {
    pub slot: u64,
    pub hash: BlockHash,
    pub parent: BlockHash,
    pub leader: NodeId,
    pub slice: u32,
    pub index: u32,
    pub num_slices: u32,
    /// Transactions carried by this slice (repeated on every shred of the slice).
    pub txs: Vec<TxId>,
    /// Rotor relay responsible for re-broadcasting this shred.
    pub relay: NodeId,
    /// Vote transactions in this slice / FEC set (TowerBFT).
    #[serde(default)]
    pub vote_txs: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct SliceState {
    received: Vec<bool>,
    count: u32,
    complete: bool,
    txs: Vec<TxId>,
    vote_txs: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Partial {
    meta: BlockMeta,
    slices: Vec<SliceState>,
    complete_slices: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Blokstor {
    partial: BTreeMap<BlockHash, Partial>,
    complete: BTreeMap<BlockHash, BlockMeta>,
    by_slot: BTreeMap<u64, Vec<BlockHash>>,
}

impl Blokstor {
    /// Returns (first time we see this shred, block metadata the moment the
    /// block becomes complete). A shred is "new" even if the block is already
    /// complete: relays must keep forwarding so nodes further down the tree
    /// also reach the reconstruction threshold.
    pub fn add_shred(&mut self, sh: &Shred, shreds_per_slice: u32, data_needed: u32) -> (bool, Option<BlockMeta>) {
        let already_complete = self.complete.contains_key(&sh.hash);
        let p = self.partial.entry(sh.hash).or_insert_with(|| Partial {
            meta: BlockMeta {
                slot: sh.slot,
                hash: sh.hash,
                parent: sh.parent,
                leader: sh.leader,
                txs: Vec::new(),
                num_slices: sh.num_slices,
                vote_txs: 0,
            },
            slices: (0..sh.num_slices)
                .map(|_| SliceState {
                    received: vec![false; shreds_per_slice as usize],
                    count: 0,
                    complete: false,
                    txs: Vec::new(),
                    vote_txs: 0,
                })
                .collect(),
            complete_slices: 0,
        });
        let Some(slice) = p.slices.get_mut(sh.slice as usize) else { return (false, None) };
        let idx = sh.index as usize;
        if idx >= slice.received.len() || slice.received[idx] {
            return (false, None);
        }
        slice.received[idx] = true;
        slice.count += 1;
        if already_complete {
            return (true, None);
        }
        if slice.txs.is_empty() && !sh.txs.is_empty() {
            slice.txs = sh.txs.clone();
        }
        slice.vote_txs = slice.vote_txs.max(sh.vote_txs);
        if !slice.complete && slice.count >= data_needed {
            slice.complete = true;
            p.complete_slices += 1;
        }
        if p.complete_slices == p.meta.num_slices {
            let mut meta = p.meta.clone();
            meta.txs = p.slices.iter().flat_map(|s| s.txs.iter().copied()).collect();
            meta.vote_txs = p.slices.iter().map(|s| s.vote_txs).sum();
            self.insert_complete(meta.clone());
            return (true, Some(meta));
        }
        (true, None)
    }

    /// Whole block (leader's own block or a repair response). True if new.
    pub fn add_block(&mut self, meta: BlockMeta) -> bool {
        if self.complete.contains_key(&meta.hash) {
            return false;
        }
        self.insert_complete(meta);
        true
    }

    fn insert_complete(&mut self, meta: BlockMeta) {
        self.by_slot.entry(meta.slot).or_default().push(meta.hash);
        self.complete.insert(meta.hash, meta);
    }

    pub fn has(&self, hash: BlockHash) -> bool {
        self.complete.contains_key(&hash)
    }

    pub fn get(&self, hash: BlockHash) -> Option<&BlockMeta> {
        self.complete.get(&hash)
    }

    pub fn blocks_in_slot(&self, slot: u64) -> &[BlockHash] {
        self.by_slot.get(&slot).map(|v| v.as_slice()).unwrap_or(&[])
    }

    /// (complete slices, total slices) for a block still being reconstructed.
    pub fn partial_progress(&self, hash: BlockHash) -> Option<(u32, u32)> {
        if self.complete.contains_key(&hash) {
            return None;
        }
        self.partial.get(&hash).map(|p| (p.complete_slices, p.meta.num_slices))
    }
}
