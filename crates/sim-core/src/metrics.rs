//! Metrics derived purely from the trace.

use crate::time::to_ms;
use crate::trace::{TraceEvent, Traced};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct MsgStat {
    pub count: u64,
    pub bytes: u64,
    pub dropped: u64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Metrics {
    /// First time (ms) the hero tx reached each stage.
    pub tx_stage_ms: BTreeMap<String, f64>,
    pub msgs: BTreeMap<String, MsgStat>,
    pub total_msgs: u64,
    pub total_bytes: u64,
    pub votes: BTreeMap<String, u64>,
    /// Distinct certificates (slot, kind, hash) observed by anyone.
    pub certificates: BTreeMap<String, u64>,
    pub slots_started: u64,
    pub blocks_produced: u64,
    /// Vote transactions packed into blocks (TowerBFT) and their byte cost.
    pub vote_txs_in_blocks: u64,
    pub vote_tx_bytes_in_blocks: u64,
    #[serde(skip)]
    seen_certs: BTreeSet<(u64, String, Option<u64>)>,
}

impl Metrics {
    pub fn from_trace(trace: &[Traced]) -> Metrics {
        let mut m = Metrics::default();
        for t in trace {
            m.push(t);
        }
        m
    }

    /// Incrementally fold one event in.
    pub fn push(&mut self, traced: &Traced) {
        let m = self;
        let Traced { t, ev } = traced;
        {
            match ev {
                TraceEvent::TxStage { stage, .. } => {
                    let key = serde_json::to_value(stage).unwrap().as_str().unwrap().to_string();
                    m.tx_stage_ms.entry(key).or_insert(to_ms(*t));
                }
                TraceEvent::MsgSent { kind, bytes, dropped, .. } => {
                    let e = m.msgs.entry(kind.clone()).or_default();
                    e.count += 1;
                    e.bytes += *bytes as u64;
                    if dropped.is_some() {
                        e.dropped += 1;
                    }
                    m.total_msgs += 1;
                    m.total_bytes += *bytes as u64;
                }
                TraceEvent::Vote { kind, .. } => {
                    let key = serde_json::to_value(kind).unwrap().as_str().unwrap().to_string();
                    *m.votes.entry(key).or_default() += 1;
                }
                TraceEvent::Certificate { slot, kind, hash, .. } => {
                    let key = serde_json::to_value(kind).unwrap().as_str().unwrap().to_string();
                    if m.seen_certs.insert((*slot, key.clone(), *hash)) {
                        *m.certificates.entry(key).or_default() += 1;
                    }
                }
                TraceEvent::SlotStart { .. } => m.slots_started += 1,
                TraceEvent::BlockProduced { vote_txs, .. } => {
                    m.blocks_produced += 1;
                    m.vote_txs_in_blocks += *vote_txs as u64;
                    m.vote_tx_bytes_in_blocks += *vote_txs as u64 * 300;
                }
                _ => {}
            }
        }
    }
}
