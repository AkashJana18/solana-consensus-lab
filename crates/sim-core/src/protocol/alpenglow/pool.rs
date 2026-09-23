//! Pool: per-slot vote bookkeeping, certificate formation and the derived
//! events Votor reacts to (BlockNotarized, ParentReady, SafeToNotar, SafeToSkip).
//!
//! Thresholds follow the Alpenglow white paper v1.1 / SIMD-0326:
//!   Notarization 60% notarize · Notar-Fallback 60% notarize+notar-fallback ·
//!   Skip 60% skip+skip-fallback · Fast-Finalization 80% notarize ·
//!   Finalization 60% finalize.

use super::GENESIS;
use crate::scenario::AlpenglowParams;
use crate::stake::{NodeId, ValidatorSet};
use crate::trace::{BlockHash, CertKind, VoteKind};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Vote {
    pub voter: NodeId,
    pub slot: u64,
    pub kind: VoteKind,
    pub hash: Option<BlockHash>,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Cert {
    pub slot: u64,
    pub kind: CertKind,
    pub hash: Option<BlockHash>,
    pub stake: u64,
}

/// What the Pool needs to know about the local Votor for SafeToNotar/SafeToSkip.
#[derive(Clone, Copy, Debug, Default)]
pub struct OwnView {
    pub voted: bool,
    pub voted_notar: Option<BlockHash>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PoolEv {
    BlockNotarized(u64, BlockHash),
    NotarFallbackCert(u64, BlockHash),
    Skipped(u64),
    FastFinalized(u64, BlockHash),
    Finalized(u64),
    SafeToNotar(u64, BlockHash),
    SafeToSkip(u64),
    ParentReady(u64, BlockHash),
}

#[derive(Clone, Debug, Default)]
pub struct PoolOut {
    pub new_certs: Vec<Cert>,
    pub events: Vec<PoolEv>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlotVotes {
    /// First-round vote per validator: Notarize(hash) or Skip.
    pub initial: BTreeMap<NodeId, Option<BlockHash>>,
    pub notar: BTreeMap<BlockHash, u64>,
    pub skip: u64,
    pub notar_fb: BTreeMap<BlockHash, u64>,
    notar_fb_voters: BTreeMap<NodeId, BTreeSet<BlockHash>>,
    pub skip_fb: u64,
    skip_fb_voters: BTreeSet<NodeId>,
    pub finalize: u64,
    finalize_voters: BTreeSet<NodeId>,
    pub certs: BTreeSet<(CertKind, Option<BlockHash>)>,
    safe_notar_emitted: BTreeSet<BlockHash>,
    safe_skip_emitted: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pool {
    pub slots: BTreeMap<u64, SlotVotes>,
    /// Blocks with a Notarization or Notar-Fallback certificate, by slot.
    notarized: BTreeMap<u64, BTreeSet<BlockHash>>,
    skipped: BTreeSet<u64>,
    parent_ready_emitted: BTreeSet<(u64, BlockHash)>,
    window: u64,
}

impl Pool {
    pub fn new(window: u64) -> Self {
        let mut p = Pool { window, ..Default::default() };
        // Genesis counts as notarized; ParentReady(0, GENESIS) is implicit.
        p.parent_ready_emitted.insert((0, GENESIS));
        p
    }

    pub fn highest_slot(&self) -> u64 {
        self.slots.keys().next_back().copied().unwrap_or(0)
    }

    /// Record a vote. Returns certificates newly formed and derived events.
    pub fn add_vote(&mut self, v: &Vote, vs: &ValidatorSet, p: &AlpenglowParams, own: OwnView) -> PoolOut {
        let stake = vs.stake(v.voter);
        let sv = self.slots.entry(v.slot).or_default();
        let accepted = match v.kind {
            VoteKind::Notarize | VoteKind::Skip => match sv.initial.entry(v.voter) {
                std::collections::btree_map::Entry::Occupied(_) => false,
                std::collections::btree_map::Entry::Vacant(e) => {
                    e.insert(v.hash);
                    match v.hash {
                        Some(h) => *sv.notar.entry(h).or_default() += stake,
                        None => sv.skip += stake,
                    }
                    true
                }
            },
            VoteKind::NotarFallback => match v.hash {
                Some(h) => {
                    let set = sv.notar_fb_voters.entry(v.voter).or_default();
                    if set.insert(h) {
                        *sv.notar_fb.entry(h).or_default() += stake;
                        true
                    } else {
                        false
                    }
                }
                None => false,
            },
            VoteKind::SkipFallback => {
                if sv.skip_fb_voters.insert(v.voter) {
                    sv.skip_fb += stake;
                    true
                } else {
                    false
                }
            }
            VoteKind::Finalize => {
                if sv.finalize_voters.insert(v.voter) {
                    sv.finalize += stake;
                    true
                } else {
                    false
                }
            }
            VoteKind::Tower => false,
        };
        if !accepted {
            return PoolOut::default();
        }
        self.evaluate(v.slot, vs, p, own)
    }

    /// Record a certificate received from the network.
    pub fn add_cert(&mut self, c: &Cert, vs: &ValidatorSet, p: &AlpenglowParams, own: OwnView) -> PoolOut {
        let sv = self.slots.entry(c.slot).or_default();
        if !sv.certs.insert((c.kind, c.hash)) {
            return PoolOut::default();
        }
        let mut out = PoolOut::default();
        self.cert_events(c.slot, c.kind, c.hash, &mut out);
        let mut more = self.evaluate(c.slot, vs, p, own);
        out.events.append(&mut more.events);
        out.new_certs.append(&mut more.new_certs);
        out
    }

    /// Re-check thresholds and safety conditions for `slot`.
    pub fn evaluate(&mut self, slot: u64, vs: &ValidatorSet, p: &AlpenglowParams, own: OwnView) -> PoolOut {
        let mut out = PoolOut::default();
        let mut formed: Vec<Cert> = Vec::new();
        {
            let sv = self.slots.entry(slot).or_default();
            let hashes: Vec<BlockHash> = sv.notar.keys().chain(sv.notar_fb.keys()).copied().collect::<BTreeSet<_>>().into_iter().collect();
            for h in hashes {
                let n = sv.notar.get(&h).copied().unwrap_or(0);
                let nf = n + sv.notar_fb.get(&h).copied().unwrap_or(0);
                if vs.reaches(n, p.fast_threshold) && sv.certs.insert((CertKind::FastFinalization, Some(h))) {
                    formed.push(Cert { slot, kind: CertKind::FastFinalization, hash: Some(h), stake: n });
                }
                if vs.reaches(n, p.slow_threshold) && sv.certs.insert((CertKind::Notarization, Some(h))) {
                    formed.push(Cert { slot, kind: CertKind::Notarization, hash: Some(h), stake: n });
                }
                if vs.reaches(nf, p.slow_threshold)
                    && !sv.certs.contains(&(CertKind::Notarization, Some(h)))
                    && sv.certs.insert((CertKind::NotarFallback, Some(h)))
                {
                    formed.push(Cert { slot, kind: CertKind::NotarFallback, hash: Some(h), stake: nf });
                }
            }
            let sk = sv.skip + sv.skip_fb;
            if vs.reaches(sk, p.slow_threshold) && sv.certs.insert((CertKind::Skip, None)) {
                formed.push(Cert { slot, kind: CertKind::Skip, hash: None, stake: sk });
            }
            if vs.reaches(sv.finalize, p.slow_threshold) && sv.certs.insert((CertKind::Finalization, None)) {
                formed.push(Cert { slot, kind: CertKind::Finalization, hash: None, stake: sv.finalize });
            }

            // SafeToNotar / SafeToSkip (white paper Defs. 16–17): only once the
            // node has already cast its first-round vote in this slot.
            if own.voted {
                let notar_hashes: Vec<(BlockHash, u64)> = sv.notar.iter().map(|(h, s)| (*h, *s)).collect();
                for (h, n) in &notar_hashes {
                    if own.voted_notar == Some(*h) || sv.safe_notar_emitted.contains(h) {
                        continue;
                    }
                    let cond_a = vs.reaches(*n, p.safe_notar_threshold);
                    let cond_b = vs.reaches(*n, p.safe_notar_low) && vs.reaches(*n + sv.skip, p.slow_threshold);
                    if cond_a || cond_b {
                        sv.safe_notar_emitted.insert(*h);
                        out.events.push(PoolEv::SafeToNotar(slot, *h));
                    }
                }
                if !sv.safe_skip_emitted {
                    let others: u64 = notar_hashes
                        .iter()
                        .filter(|(h, _)| own.voted_notar != Some(*h))
                        .map(|(_, s)| *s)
                        .sum();
                    if vs.reaches(sv.skip + sv.skip_fb + others, p.safe_skip_threshold) {
                        sv.safe_skip_emitted = true;
                        out.events.push(PoolEv::SafeToSkip(slot));
                    }
                }
            }
        }
        for c in &formed {
            self.cert_events(slot, c.kind, c.hash, &mut out);
        }
        out.new_certs = formed;
        out
    }

    fn cert_events(&mut self, slot: u64, kind: CertKind, hash: Option<BlockHash>, out: &mut PoolOut) {
        match (kind, hash) {
            (CertKind::Notarization, Some(h)) => {
                out.events.push(PoolEv::BlockNotarized(slot, h));
                self.notarized.entry(slot).or_default().insert(h);
                self.recompute_parent_ready(out);
            }
            (CertKind::NotarFallback, Some(h)) => {
                out.events.push(PoolEv::NotarFallbackCert(slot, h));
                self.notarized.entry(slot).or_default().insert(h);
                self.recompute_parent_ready(out);
            }
            (CertKind::FastFinalization, Some(h)) => {
                out.events.push(PoolEv::FastFinalized(slot, h));
                // A fast-finalized block is also notarized (80% ⊇ 60%).
                self.notarized.entry(slot).or_default().insert(h);
                self.recompute_parent_ready(out);
            }
            (CertKind::Skip, None) => {
                out.events.push(PoolEv::Skipped(slot));
                self.skipped.insert(slot);
                self.recompute_parent_ready(out);
            }
            (CertKind::Finalization, None) => out.events.push(PoolEv::Finalized(slot)),
            _ => {}
        }
    }

    /// ParentReady(s, b): s is the first slot of a leader window, b is
    /// notarized (or notar-fallback, or genesis), and every slot strictly
    /// between slot(b) and s has a Skip certificate.
    fn recompute_parent_ready(&mut self, out: &mut PoolOut) {
        let w = self.window.max(1);
        let mut found = Vec::new();
        // (first slot after the parent, candidate parent hashes)
        let genesis: BTreeSet<BlockHash> = [GENESIS].into_iter().collect();
        let candidates = std::iter::once((0u64, &genesis)).chain(self.notarized.iter().map(|(sb, hs)| (sb + 1, hs)));
        for (next, hashes) in candidates {
            let mut s = next.div_ceil(w) * w;
            loop {
                let gap_ok = (next..s).all(|x| self.skipped.contains(&x));
                if !gap_ok {
                    break;
                }
                for h in hashes {
                    found.push((s, *h));
                }
                // Continue only if the whole next window is skipped too.
                if !(s..s + w).all(|x| self.skipped.contains(&x)) {
                    break;
                }
                s += w;
            }
        }
        for (s, h) in found {
            if self.parent_ready_emitted.insert((s, h)) {
                out.events.push(PoolEv::ParentReady(s, h));
            }
        }
    }

    pub fn has_cert(&self, slot: u64, kind: CertKind, hash: Option<BlockHash>) -> bool {
        self.slots.get(&slot).map(|s| s.certs.contains(&(kind, hash))).unwrap_or(false)
    }

    pub fn is_skipped(&self, slot: u64) -> bool {
        self.skipped.contains(&slot)
    }

    /// Latest (slot, hash) with a notarization-class certificate.
    pub fn latest_notarized(&self) -> Option<(u64, BlockHash)> {
        self.notarized
            .iter()
            .next_back()
            .and_then(|(s, hs)| hs.iter().next().map(|h| (*s, *h)))
    }

    pub fn tallies(&self, slot: u64, total_stake: u64) -> serde_json::Value {
        let Some(sv) = self.slots.get(&slot) else { return serde_json::Value::Null };
        let pct = |x: u64| (x as f64 / total_stake as f64 * 1000.0).round() / 10.0;
        serde_json::json!({
            "slot": slot,
            "notarize": sv.notar.iter().map(|(h, s)| serde_json::json!({"hash": h, "pct": pct(*s)})).collect::<Vec<_>>(),
            "notar_fallback": sv.notar_fb.iter().map(|(h, s)| serde_json::json!({"hash": h, "pct": pct(*s)})).collect::<Vec<_>>(),
            "skip_pct": pct(sv.skip),
            "skip_fallback_pct": pct(sv.skip_fb),
            "finalize_pct": pct(sv.finalize),
            "certs": sv.certs.iter().map(|(k, h)| serde_json::json!({"kind": k, "hash": h})).collect::<Vec<_>>(),
        })
    }
}
