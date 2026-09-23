//! The tower: a stack of votes with doubling lockouts (Agave `vote_state`).

use crate::trace::Lockout;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TowerState {
    pub lockouts: Vec<Lockout>,
    pub root: Option<u64>,
    pub max_history: usize,
}

impl TowerState {
    pub fn new(max_history: usize) -> Self {
        TowerState { lockouts: Vec::new(), root: None, max_history: max_history.max(1) }
    }

    pub fn last_voted_slot(&self) -> Option<u64> {
        self.lockouts.last().map(|l| l.slot)
    }

    /// Drop votes whose lockout has expired relative to `slot` (Agave `pop_expired_votes`).
    pub fn pop_expired(&mut self, slot: u64) {
        while let Some(last) = self.lockouts.last() {
            if slot > last.last_locked_out_slot() {
                self.lockouts.pop();
            } else {
                break;
            }
        }
    }

    /// Record a vote for `slot`. Returns the newly rooted slot, if any.
    pub fn record_vote(&mut self, slot: u64) -> Option<u64> {
        self.pop_expired(slot);
        self.lockouts.push(Lockout { slot, confirmation_count: 1 });
        // Every vote deeper in the stack than its confirmation count doubles.
        let len = self.lockouts.len();
        for (i, v) in self.lockouts.iter_mut().enumerate() {
            let depth = (len - i) as u32;
            if depth > v.confirmation_count {
                v.confirmation_count += 1;
            }
        }
        if self.lockouts.len() > self.max_history {
            let rooted = self.lockouts.remove(0);
            self.root = Some(rooted.slot);
            return Some(rooted.slot);
        }
        None
    }

    /// Would voting for `slot` (whose ancestor slots are `ancestors`) violate a lockout?
    pub fn is_locked_out(&self, slot: u64, ancestors: &BTreeSet<u64>) -> bool {
        if let Some(last) = self.last_voted_slot() {
            if slot <= last {
                return true;
            }
        }
        if let Some(root) = self.root {
            if !ancestors.contains(&root) {
                return true;
            }
        }
        let mut sim = self.clone();
        sim.pop_expired(slot);
        sim.lockouts.iter().any(|v| v.slot != slot && !ancestors.contains(&v.slot))
    }

    /// The vote that would sit `depth` entries below the top after voting for `slot`.
    pub fn threshold_vote(&self, slot: u64, depth: usize) -> Option<Lockout> {
        let mut sim = self.clone();
        sim.record_vote(slot);
        let len = sim.lockouts.len();
        if len > depth {
            Some(sim.lockouts[len - 1 - depth])
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lockouts_double_and_root_at_max() {
        let mut t = TowerState::new(31);
        for s in 0..31 {
            assert_eq!(t.record_vote(s), None);
        }
        assert_eq!(t.lockouts.len(), 31);
        assert_eq!(t.lockouts[0].confirmation_count, 31);
        assert_eq!(t.lockouts[30].confirmation_count, 1);
        assert_eq!(t.record_vote(31), Some(0));
        assert_eq!(t.root, Some(0));
        assert_eq!(t.lockouts.len(), 31);
    }

    #[test]
    fn expired_votes_pop() {
        let mut t = TowerState::new(31);
        t.record_vote(1); // lockout 2 -> locked through 3
        t.record_vote(2); // slot1 conf=2 (through 5), slot2 conf=1 (through 4)
        t.record_vote(10); // both expired
        assert_eq!(t.lockouts.len(), 1);
        assert_eq!(t.lockouts[0].slot, 10);
    }

    #[test]
    fn locked_out_on_other_fork_until_expiry() {
        let mut t = TowerState::new(31);
        t.record_vote(5);
        let other_fork: BTreeSet<u64> = [1, 2, 3, 4, 6].into_iter().collect();
        assert!(t.is_locked_out(6, &other_fork)); // 5 locked through 7
        assert!(t.is_locked_out(7, &other_fork));
        assert!(!t.is_locked_out(8, &other_fork));
        let same_fork: BTreeSet<u64> = [1, 2, 3, 4, 5].into_iter().collect();
        assert!(!t.is_locked_out(6, &same_fork));
    }
}
