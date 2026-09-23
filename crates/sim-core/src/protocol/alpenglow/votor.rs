//! Votor: the per-slot voting state machine (white paper v1.1, Algorithms 1–2).
//!
//! Flags per slot: Voted, VotedNotar(hash), ItsOver, BlockNotarized(hash),
//! ParentReady(hash set). BadWindow is per leader window.

use crate::protocol::blokstor::BlockMeta;
use crate::trace::{BlockHash, VoteKind, VotorFlag};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotState {
    pub voted: bool,
    pub voted_notar: Option<BlockHash>,
    pub its_over: bool,
    pub block_notarized: Option<BlockHash>,
    pub parents_ready: BTreeSet<BlockHash>,
    pub pending: Vec<BlockMeta>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VotorAction {
    Vote(VoteKind, u64, Option<BlockHash>),
    /// Start the window's timeouts: Timeout(first_slot + i) at now + Δtimeout + i·Δblock.
    SetTimeouts { first_slot: u64 },
    Flag(u64, VotorFlag, Option<BlockHash>),
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Votor {
    pub window: u64,
    pub slots: BTreeMap<u64, SlotState>,
    pub bad_window: BTreeSet<u64>,
    timeouts_set: BTreeSet<u64>,
}

impl Votor {
    pub fn new(window: u64) -> Self {
        Votor {
            window: window.max(1),
            slots: BTreeMap::new(),
            bad_window: BTreeSet::new(),
            timeouts_set: BTreeSet::new(),
        }
    }

    fn st(&mut self, slot: u64) -> &mut SlotState {
        self.slots.entry(slot).or_default()
    }

    pub fn view(&self, slot: u64) -> super::pool::OwnView {
        match self.slots.get(&slot) {
            Some(s) => super::pool::OwnView { voted: s.voted, voted_notar: s.voted_notar },
            None => super::pool::OwnView::default(),
        }
    }

    fn window_start(&self, slot: u64) -> u64 {
        slot - slot % self.window
    }

    fn is_bad(&self, slot: u64) -> bool {
        self.bad_window.contains(&self.window_start(slot))
    }

    fn mark_bad(&mut self, slot: u64, out: &mut Vec<VotorAction>) {
        let ws = self.window_start(slot);
        if self.bad_window.insert(ws) {
            out.push(VotorAction::Flag(ws, VotorFlag::BadWindow, None));
        }
    }

    // ---- events ----

    /// Block complete (and validated). Algorithm 1: `upon Block(b)`.
    pub fn on_block(&mut self, b: &BlockMeta, out: &mut Vec<VotorAction>) {
        self.try_notar(b, out);
    }

    /// Algorithm 1: `upon ParentReady(s, hash(p))`.
    pub fn on_parent_ready(&mut self, slot: u64, parent: BlockHash, out: &mut Vec<VotorAction>) {
        let first = self.window_start(slot) == slot;
        let newly = self.st(slot).parents_ready.insert(parent);
        if newly {
            out.push(VotorAction::Flag(slot, VotorFlag::ParentReady, Some(parent)));
        }
        if first && self.timeouts_set.insert(slot) {
            out.push(VotorAction::SetTimeouts { first_slot: slot });
        }
        let pending = std::mem::take(&mut self.st(slot).pending);
        for b in pending {
            self.try_notar(&b, out);
        }
    }

    /// Algorithm 1: `upon Timeout(s)`.
    pub fn on_timeout(&mut self, slot: u64, out: &mut Vec<VotorAction>) {
        if !self.st(slot).voted {
            self.try_skip_window(slot, out);
        }
    }

    /// Algorithm 1: `upon SafeToNotar(s, hash(b))`.
    pub fn on_safe_to_notar(&mut self, slot: u64, hash: BlockHash, out: &mut Vec<VotorAction>) {
        self.try_skip_window(slot, out);
        if !self.st(slot).its_over {
            self.mark_bad(slot, out);
            out.push(VotorAction::Vote(VoteKind::NotarFallback, slot, Some(hash)));
        }
    }

    /// Algorithm 1: `upon SafeToSkip(s)`.
    pub fn on_safe_to_skip(&mut self, slot: u64, out: &mut Vec<VotorAction>) {
        self.try_skip_window(slot, out);
        if !self.st(slot).its_over {
            self.mark_bad(slot, out);
            out.push(VotorAction::Vote(VoteKind::SkipFallback, slot, None));
        }
    }

    /// Algorithm 1: `upon BlockNotarized(s, hash(b))`.
    pub fn on_block_notarized(&mut self, slot: u64, hash: BlockHash, out: &mut Vec<VotorAction>) {
        let bad = self.is_bad(slot);
        let s = self.st(slot);
        if s.block_notarized.is_none() {
            s.block_notarized = Some(hash);
            out.push(VotorAction::Flag(slot, VotorFlag::BlockNotarized, Some(hash)));
        }
        if s.voted_notar == Some(hash) && !bad && !s.its_over {
            s.its_over = true;
            out.push(VotorAction::Flag(slot, VotorFlag::ItsOver, None));
            out.push(VotorAction::Vote(VoteKind::Finalize, slot, None));
        }
    }

    // ---- helpers (Algorithm 2) ----

    /// TryNotar(b): vote Notarize if we have not voted in slot(b) and b's
    /// parent is acceptable: ParentReady for the first slot of a window, or
    /// our own notar vote in the previous slot otherwise.
    pub fn try_notar(&mut self, b: &BlockMeta, out: &mut Vec<VotorAction>) {
        let slot = b.slot;
        if self.st(slot).voted {
            return;
        }
        let first = self.window_start(slot) == slot;
        let parent_ok = if first {
            self.st(slot).parents_ready.contains(&b.parent)
        } else {
            self.slots.get(&(slot - 1)).map(|p| p.voted_notar == Some(b.parent)).unwrap_or(false)
        };
        if !parent_ok {
            let s = self.st(slot);
            if !s.pending.iter().any(|p| p.hash == b.hash) {
                s.pending.push(b.clone());
            }
            return;
        }
        let s = self.st(slot);
        s.voted = true;
        s.voted_notar = Some(b.hash);
        out.push(VotorAction::Flag(slot, VotorFlag::Voted, None));
        out.push(VotorAction::Flag(slot, VotorFlag::VotedNotar, Some(b.hash)));
        out.push(VotorAction::Vote(VoteKind::Notarize, slot, Some(b.hash)));
        // A block for the next slot may already be waiting on this vote.
        if self.window_start(slot + 1) != slot + 1 {
            let pending = std::mem::take(&mut self.st(slot + 1).pending);
            for nb in pending {
                self.try_notar(&nb, out);
            }
        }
    }

    /// TrySkipWindow(s): skip every not-yet-voted slot from s to the end of its window.
    pub fn try_skip_window(&mut self, slot: u64, out: &mut Vec<VotorAction>) {
        let end = self.window_start(slot) + self.window;
        let mut any = false;
        for s in slot..end {
            let st = self.st(s);
            if !st.voted {
                st.voted = true;
                any = true;
                out.push(VotorAction::Flag(s, VotorFlag::Voted, None));
                out.push(VotorAction::Vote(VoteKind::Skip, s, None));
            }
        }
        if any {
            self.mark_bad(slot, out);
        }
    }

    pub fn inspect(&self, from_slot: u64, to_slot: u64) -> serde_json::Value {
        let rows: Vec<serde_json::Value> = (from_slot..=to_slot)
            .filter_map(|s| self.slots.get(&s).map(|st| (s, st)))
            .map(|(s, st)| {
                serde_json::json!({
                    "slot": s,
                    "voted": st.voted,
                    "voted_notar": st.voted_notar,
                    "its_over": st.its_over,
                    "block_notarized": st.block_notarized,
                    "parents_ready": st.parents_ready.iter().collect::<Vec<_>>(),
                    "bad_window": self.is_bad(s),
                    "pending": st.pending.len(),
                })
            })
            .collect();
        serde_json::Value::Array(rows)
    }
}
