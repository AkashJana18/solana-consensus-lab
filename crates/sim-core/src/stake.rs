//! Validator set, stake weights and leader schedule.

use crate::rng::Rng;
use serde::{Deserialize, Serialize};

pub type NodeId = u16;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ValidatorSet {
    pub stakes: Vec<u64>,
    pub total: u64,
}

impl ValidatorSet {
    pub fn new(stakes: Vec<u64>) -> Self {
        let total = stakes.iter().sum();
        ValidatorSet { stakes, total }
    }

    pub fn len(&self) -> usize {
        self.stakes.len()
    }

    pub fn is_empty(&self) -> bool {
        self.stakes.is_empty()
    }

    pub fn ids(&self) -> impl Iterator<Item = NodeId> {
        0..self.stakes.len() as NodeId
    }

    pub fn stake(&self, id: NodeId) -> u64 {
        self.stakes[id as usize]
    }

    /// Fraction of total stake held by `id`, in [0, 1].
    pub fn frac(&self, id: NodeId) -> f64 {
        self.stakes[id as usize] as f64 / self.total as f64
    }

    /// Fraction of total stake represented by `stake_sum`.
    pub fn pct(&self, stake_sum: u64) -> f64 {
        stake_sum as f64 / self.total as f64
    }

    /// True if `stake_sum` is at least `threshold` (fraction) of total stake.
    pub fn reaches(&self, stake_sum: u64, threshold: f64) -> bool {
        // Integer-safe comparison: stake_sum / total >= threshold.
        (stake_sum as f64) + 1e-9 >= threshold * self.total as f64
    }

    pub fn sum<I: IntoIterator<Item = NodeId>>(&self, ids: I) -> u64 {
        ids.into_iter().map(|i| self.stake(i)).sum()
    }
}

/// Stake-weighted leader schedule. Leaders are assigned per window of
/// `window` consecutive slots (4 on Solana today and under Alpenglow).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct LeaderSchedule {
    pub window: u64,
    pub leaders: Vec<NodeId>,
}

impl LeaderSchedule {
    pub fn generate(vs: &ValidatorSet, rng: &mut Rng, num_slots: u64, window: u64) -> Self {
        let windows = num_slots.div_ceil(window).max(1);
        let leaders = (0..windows)
            .map(|_| rng.weighted(&vs.stakes) as NodeId)
            .collect();
        LeaderSchedule { window, leaders }
    }

    pub fn leader(&self, slot: u64) -> NodeId {
        let w = (slot / self.window) as usize;
        self.leaders[w.min(self.leaders.len() - 1)]
    }

    pub fn window_index(&self, slot: u64) -> u64 {
        slot / self.window
    }

    pub fn window_start(&self, slot: u64) -> u64 {
        slot - slot % self.window
    }

    pub fn is_window_start(&self, slot: u64) -> bool {
        slot.is_multiple_of(self.window)
    }

    /// Slots of the window containing `slot`.
    pub fn window_slots(&self, slot: u64) -> std::ops::Range<u64> {
        let s = self.window_start(slot);
        s..s + self.window
    }

    /// First slot at or after `from` where `node` is not the leader.
    pub fn next_leader_after(&self, from: u64) -> NodeId {
        self.leader(self.window_start(from) + self.window)
    }
}
