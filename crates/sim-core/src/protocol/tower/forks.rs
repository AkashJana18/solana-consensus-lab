//! Fork tree with latest-vote weights, heaviest-subtree fork choice and
//! optimistic confirmation (≥ 2/3 stake voting on a block or its descendants).

use crate::protocol::blokstor::BlockMeta;
use crate::stake::{NodeId, ValidatorSet};
use crate::trace::BlockHash;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const GENESIS: BlockHash = 0;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForkTree {
    pub blocks: BTreeMap<BlockHash, BlockMeta>,
    pub children: BTreeMap<BlockHash, Vec<BlockHash>>,
    /// Latest (slot, hash) vote observed per validator.
    pub latest_votes: BTreeMap<NodeId, (u64, BlockHash)>,
    /// Stake of validators whose latest vote is at or below each block.
    pub weights: BTreeMap<BlockHash, u64>,
}

impl ForkTree {
    pub fn insert(&mut self, meta: BlockMeta) {
        if let std::collections::btree_map::Entry::Vacant(e) = self.blocks.entry(meta.hash) {
            self.children.entry(meta.parent).or_default().push(meta.hash);
            e.insert(meta);
        }
    }

    pub fn has(&self, h: BlockHash) -> bool {
        h == GENESIS || self.blocks.contains_key(&h)
    }

    pub fn slot_of(&self, h: BlockHash) -> Option<u64> {
        if h == GENESIS {
            return None;
        }
        self.blocks.get(&h).map(|b| b.slot)
    }

    /// Ancestor slots of `h` (including h's own slot), walking to genesis.
    pub fn ancestor_slots(&self, h: BlockHash) -> BTreeSet<u64> {
        let mut out = BTreeSet::new();
        let mut cur = h;
        while let Some(b) = self.blocks.get(&cur) {
            out.insert(b.slot);
            cur = b.parent;
        }
        out
    }

    /// Ancestor hashes of `h`, nearest first (excluding h).
    pub fn ancestors(&self, h: BlockHash) -> Vec<BlockHash> {
        let mut out = Vec::new();
        let mut cur = self.blocks.get(&h).map(|b| b.parent);
        while let Some(p) = cur {
            if p == GENESIS {
                break;
            }
            out.push(p);
            cur = self.blocks.get(&p).map(|b| b.parent);
        }
        out
    }

    pub fn is_ancestor_or_self(&self, a: BlockHash, of: BlockHash) -> bool {
        if a == GENESIS || a == of {
            return true;
        }
        let mut cur = of;
        while let Some(b) = self.blocks.get(&cur) {
            if b.parent == a {
                return true;
            }
            cur = b.parent;
        }
        false
    }

    /// Record a latest vote (monotonic per validator). Returns true if it changed.
    pub fn record_vote(&mut self, voter: NodeId, slot: u64, hash: BlockHash) -> bool {
        match self.latest_votes.get(&voter) {
            Some((s, _)) if *s >= slot => false,
            _ => {
                self.latest_votes.insert(voter, (slot, hash));
                true
            }
        }
    }

    pub fn recompute_weights(&mut self, vs: &ValidatorSet) {
        self.weights.clear();
        for (voter, (_, hash)) in &self.latest_votes {
            let stake = vs.stake(*voter);
            let mut cur = *hash;
            while cur != GENESIS {
                *self.weights.entry(cur).or_default() += stake;
                match self.blocks.get(&cur) {
                    Some(b) => cur = b.parent,
                    None => break,
                }
            }
        }
    }

    pub fn weight(&self, h: BlockHash) -> u64 {
        self.weights.get(&h).copied().unwrap_or(0)
    }

    /// Heaviest-subtree fork choice restricted to `eligible` (replayed) blocks:
    /// from `start`, repeatedly descend into the heaviest child (ties → lower slot).
    pub fn head(&self, start: BlockHash, eligible: &BTreeSet<BlockHash>) -> BlockHash {
        let mut cur = start;
        loop {
            let next = self
                .children
                .get(&cur)
                .into_iter()
                .flatten()
                .filter(|c| eligible.contains(c))
                .max_by(|a, b| {
                    self.weight(**a)
                        .cmp(&self.weight(**b))
                        .then_with(|| self.slot_of(**b).cmp(&self.slot_of(**a)))
                })
                .copied();
            match next {
                Some(n) => cur = n,
                None => return cur,
            }
        }
    }

    /// Stake whose latest vote is on a fork that conflicts with `hash`
    /// (neither an ancestor nor a descendant of it).
    pub fn conflicting_stake(&self, hash: BlockHash, vs: &ValidatorSet) -> u64 {
        self.latest_votes
            .iter()
            .filter(|(_, (_, h))| !self.is_ancestor_or_self(*h, hash) && !self.is_ancestor_or_self(hash, *h))
            .map(|(v, _)| vs.stake(*v))
            .sum()
    }
}
