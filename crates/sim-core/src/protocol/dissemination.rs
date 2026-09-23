//! Shared block-propagation helpers: deterministic stake-weighted orderings,
//! Turbine tree children, Rotor relay selection, simulated block hashes.

use crate::rng::Rng;
use crate::stake::{NodeId, ValidatorSet};
use crate::trace::BlockHash;

pub const SHRED_BYTES: u32 = 1228;

pub fn mix(a: u64, b: u64, c: u64) -> u64 {
    let mut z = a
        .wrapping_mul(0x9E37_79B9_7F4A_7C15)
        .wrapping_add(b.rotate_left(17))
        .wrapping_add(c.rotate_left(41))
        .wrapping_add(0x632B_E59B_D9B4_E019);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Simulated block id. Never 0 (0 is genesis). Kept below 2^53 so it
/// survives a round trip through JavaScript numbers in the web UI.
pub fn block_hash(slot: u64, leader: NodeId, parent: BlockHash, nonce: u64) -> BlockHash {
    (mix(slot, (leader as u64) << 32 | nonce, parent) & ((1u64 << 53) - 1)) | 1
}

/// Stake-weighted permutation of all nodes except `exclude`, seeded
/// deterministically so every node computes the same tree/relays.
pub fn weighted_order(vs: &ValidatorSet, exclude: Option<NodeId>, seed: u64) -> Vec<NodeId> {
    let mut rng = Rng::seed(seed);
    let weights: Vec<u64> = vs
        .stakes
        .iter()
        .enumerate()
        .map(|(i, s)| if Some(i as NodeId) == exclude { 0 } else { *s })
        .collect();
    rng.weighted_order(&weights)
        .into_iter()
        .map(|i| i as NodeId)
        .filter(|i| Some(*i) != exclude)
        .collect()
}

/// Children of `me` in a complete k-ary tree laid over `order` (root = order[0]).
pub fn turbine_children(order: &[NodeId], me: NodeId, fanout: usize) -> Vec<NodeId> {
    let Some(p) = order.iter().position(|n| *n == me) else { return Vec::new() };
    let start = p * fanout + 1;
    if start >= order.len() {
        return Vec::new();
    }
    order[start..(start + fanout).min(order.len())].to_vec()
}

/// Rotor relays for one slice: the first `count` nodes of the weighted order
/// (distinct while enough nodes exist, then wrapping).
pub fn rotor_relays(vs: &ValidatorSet, leader: NodeId, seed: u64, count: usize) -> Vec<NodeId> {
    let order = weighted_order(vs, Some(leader), seed);
    if order.is_empty() {
        return vec![leader; count];
    }
    (0..count).map(|i| order[i % order.len()]).collect()
}
