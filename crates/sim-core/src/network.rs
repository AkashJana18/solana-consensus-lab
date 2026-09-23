//! Network model: regions, latency matrix, jitter, per-node egress bandwidth,
//! and a dynamic fault layer (offline nodes, partitions, delays, random loss).

use crate::rng::Rng;
use crate::scenario::{
    preset_latency_ms, preset_regions, Fault, NetworkSpec, PartitionSpec, RegionSpec, Scenario,
};
use crate::stake::{LeaderSchedule, NodeId, ValidatorSet};
use crate::time::{ms, ms_f, SimTime};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Network {
    pub region_names: Vec<String>,
    pub node_region: Vec<u8>,
    latency_us: Vec<Vec<SimTime>>,
    jitter_sigma: f64,
    bandwidth_bps: Option<f64>,
    egress_busy_until: Vec<SimTime>,
}

impl Network {
    pub fn build(spec: &NetworkSpec, node_regions: &[RegionSpec], n: usize, rng: &mut Rng) -> Network {
        let regions: Vec<RegionSpec> = if !node_regions.is_empty() {
            node_regions.to_vec()
        } else if !spec.regions.is_empty() {
            spec.regions.clone()
        } else {
            preset_regions()
        };
        let preset_names: Vec<String> = preset_regions().into_iter().map(|r| r.name).collect();
        let names: Vec<String> = regions.iter().map(|r| r.name.clone()).collect();
        let local = ms_f(spec.local_latency_ms);
        let latency_ms: Vec<Vec<f64>> = if let Some(m) = &spec.latency_ms {
            m.clone()
        } else if names == preset_names {
            preset_latency_ms()
        } else {
            // Unknown custom regions without a matrix: flat 60 ms between regions.
            (0..names.len())
                .map(|i| {
                    (0..names.len())
                        .map(|j| if i == j { spec.local_latency_ms } else { 60.0 })
                        .collect()
                })
                .collect()
        };
        let latency_us = latency_ms
            .iter()
            .enumerate()
            .map(|(i, row)| {
                row.iter()
                    .enumerate()
                    .map(|(j, v)| if i == j { local } else { ms_f(*v) })
                    .collect()
            })
            .collect();
        let weights: Vec<u64> = regions.iter().map(|r| (r.weight * 10_000.0) as u64).collect();
        let node_region = (0..n).map(|_| rng.weighted(&weights) as u8).collect();
        Network {
            region_names: names,
            node_region,
            latency_us,
            jitter_sigma: spec.jitter_sigma,
            bandwidth_bps: spec.bandwidth_mbps.map(|m| m * 1_000_000.0),
            egress_busy_until: vec![0; n],
        }
    }

    pub fn region_of(&self, node: NodeId) -> &str {
        &self.region_names[self.node_region[node as usize] as usize]
    }

    pub fn base_latency(&self, a: NodeId, b: NodeId) -> SimTime {
        let ra = self.node_region[a as usize] as usize;
        let rb = self.node_region[b as usize] as usize;
        self.latency_us[ra][rb]
    }

    /// Arrival time of a `bytes`-sized message sent now from `a` to `b`.
    pub fn transit(&mut self, a: NodeId, b: NodeId, bytes: u32, now: SimTime, rng: &mut Rng) -> SimTime {
        let base = self.base_latency(a, b) as f64;
        let jittered = (base * rng.lognormal_unit(self.jitter_sigma)).round() as SimTime;
        let (start, tx_time) = match self.bandwidth_bps {
            Some(bps) => {
                let tx = ((bytes as f64 * 8.0 / bps) * 1_000_000.0).ceil() as SimTime;
                let busy = &mut self.egress_busy_until[a as usize];
                let start = (*busy).max(now);
                *busy = start + tx;
                (start, tx)
            }
            None => (now, 0),
        };
        start + tx_time + jittered
    }
}

// -------------------------------------------------------------------- faults

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DelayRule {
    pub id: u32,
    pub nodes: Vec<bool>,
    pub extra_us: SimTime,
}

/// Dynamic fault state, mutated by scheduled `FaultEvent`s.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FaultState {
    pub offline: Vec<bool>,
    /// Group id per node while a partition is active.
    pub partition: Option<Vec<u8>>,
    pub delays: Vec<DelayRule>,
    pub drop_prob: f64,
}

impl FaultState {
    pub fn new(n: usize, base_drop: f64) -> Self {
        FaultState {
            offline: vec![false; n],
            partition: None,
            delays: Vec::new(),
            drop_prob: base_drop,
        }
    }

    pub fn is_offline(&self, node: NodeId) -> bool {
        self.offline[node as usize]
    }

    pub fn partitioned(&self, a: NodeId, b: NodeId) -> bool {
        match &self.partition {
            Some(g) => g[a as usize] != g[b as usize],
            None => false,
        }
    }

    pub fn extra_delay(&self, a: NodeId, b: NodeId) -> SimTime {
        self.delays
            .iter()
            .filter(|r| r.nodes[a as usize] || r.nodes[b as usize])
            .map(|r| r.extra_us)
            .sum()
    }

    pub fn apply(&mut self, ev: &FaultEvent) {
        match ev {
            FaultEvent::Offline(nodes) => nodes.iter().for_each(|n| self.offline[*n as usize] = true),
            FaultEvent::Online(nodes) => nodes.iter().for_each(|n| self.offline[*n as usize] = false),
            FaultEvent::PartitionStart { group_of, .. } => self.partition = Some(group_of.clone()),
            FaultEvent::PartitionEnd => self.partition = None,
            FaultEvent::DelayStart(rule) => self.delays.push(rule.clone()),
            FaultEvent::DelayEnd(id) => self.delays.retain(|r| r.id != *id),
            FaultEvent::DropSet(p) => self.drop_prob = *p,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum FaultEvent {
    Offline(Vec<NodeId>),
    Online(Vec<NodeId>),
    PartitionStart {
        group_of: Vec<u8>,
        groups: Vec<Vec<NodeId>>,
    },
    PartitionEnd,
    DelayStart(DelayRule),
    DelayEnd(u32),
    DropSet(f64),
}

/// Resolve scenario faults into timestamped events.
pub fn schedule_faults(
    sc: &Scenario,
    vs: &ValidatorSet,
    sched: &LeaderSchedule,
    net: &Network,
    rng: &mut Rng,
) -> Vec<(SimTime, FaultEvent)> {
    let n = vs.len();
    let mut out = Vec::new();
    let mut delay_id = 0u32;
    for f in &sc.faults {
        match f {
            Fault::Offline { target, from_ms, to_ms } => {
                let nodes = target.resolve(vs, sched, rng);
                out.push((ms(*from_ms), FaultEvent::Offline(nodes.clone())));
                if let Some(to) = to_ms {
                    out.push((ms(*to), FaultEvent::Online(nodes)));
                }
            }
            Fault::Partition { groups, from_ms, to_ms } => {
                let groups = resolve_partition(groups, vs, net, rng);
                let mut group_of = vec![0u8; n];
                for (gi, g) in groups.iter().enumerate() {
                    for id in g {
                        group_of[*id as usize] = gi as u8;
                    }
                }
                out.push((ms(*from_ms), FaultEvent::PartitionStart { group_of, groups }));
                out.push((ms(*to_ms), FaultEvent::PartitionEnd));
            }
            Fault::Delay { target, extra_ms, from_ms, to_ms } => {
                let mut nodes = vec![false; n];
                for id in target.resolve(vs, sched, rng) {
                    nodes[id as usize] = true;
                }
                delay_id += 1;
                let rule = DelayRule {
                    id: delay_id,
                    nodes,
                    extra_us: ms_f(*extra_ms),
                };
                out.push((ms(*from_ms), FaultEvent::DelayStart(rule)));
                if let Some(to) = to_ms {
                    out.push((ms(*to), FaultEvent::DelayEnd(delay_id)));
                }
            }
            Fault::Drop { prob, from_ms, to_ms } => {
                out.push((ms(*from_ms), FaultEvent::DropSet(*prob)));
                if let Some(to) = to_ms {
                    out.push((ms(*to), FaultEvent::DropSet(sc.network.base_drop_prob)));
                }
            }
        }
    }
    out
}

fn resolve_partition(
    spec: &PartitionSpec,
    vs: &ValidatorSet,
    net: &Network,
    rng: &mut Rng,
) -> Vec<Vec<NodeId>> {
    match spec {
        PartitionSpec::Explicit { groups } => groups.clone(),
        PartitionSpec::Regions { regions } => {
            let mut groups: Vec<Vec<NodeId>> = vec![Vec::new(); regions.len()];
            for id in vs.ids() {
                let r = net.region_of(id);
                let gi = regions
                    .iter()
                    .position(|g| g.iter().any(|name| name == r))
                    .unwrap_or(0);
                groups[gi].push(id);
            }
            groups
        }
        PartitionSpec::StakeSplit { stake_split } => {
            let mut ids: Vec<NodeId> = vs.ids().collect();
            rng.shuffle(&mut ids);
            let total: f64 = stake_split.iter().sum();
            let goals: Vec<f64> = stake_split
                .iter()
                .map(|f| f / total * vs.total as f64)
                .collect();
            let mut groups: Vec<Vec<NodeId>> = vec![Vec::new(); goals.len()];
            let mut acc = vec![0f64; goals.len()];
            for id in ids {
                // Put each node into the group furthest below its goal.
                let gi = (0..goals.len())
                    .min_by(|a, b| {
                        (acc[*a] / goals[*a])
                            .partial_cmp(&(acc[*b] / goals[*b]))
                            .unwrap()
                    })
                    .unwrap();
                groups[gi].push(id);
                acc[gi] += vs.stake(id) as f64;
            }
            groups.iter_mut().for_each(|g| g.sort_unstable());
            groups
        }
    }
}
