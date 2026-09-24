//! Scenario configuration (JSON). Shared by the CLI and the web UI.

use crate::rng::Rng;
use crate::stake::{LeaderSchedule, NodeId, ValidatorSet};
use serde::{Deserialize, Serialize};

pub const STAKE_UNITS: u64 = 1_000_000;

/// Scenarios shipped with the simulator (also embedded in the wasm build).
pub const BUILTIN: &[(&str, &str)] = &[
    ("happy-path", include_str!("../../../scenarios/happy-path.json")),
    ("offline-25pct", include_str!("../../../scenarios/offline-25pct.json")),
    ("leader-down", include_str!("../../../scenarios/leader-down.json")),
    ("partition-heal", include_str!("../../../scenarios/partition-heal.json")),
    ("twenty-twenty", include_str!("../../../scenarios/twenty-twenty.json")),
];

pub fn builtin(name: &str) -> Option<&'static str> {
    BUILTIN.iter().find(|(n, _)| *n == name).map(|(_, j)| *j)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Scenario {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "d_seed")]
    pub seed: u64,
    #[serde(default = "d_duration")]
    pub duration_ms: u64,
    #[serde(default)]
    pub validators: ValidatorSpec,
    #[serde(default)]
    pub network: NetworkSpec,
    #[serde(default)]
    pub faults: Vec<Fault>,
    #[serde(default)]
    pub hero_tx: HeroTx,
    #[serde(default)]
    pub params: Params,
}

fn d_seed() -> u64 {
    1
}
fn d_duration() -> u64 {
    20_000
}

impl Scenario {
    pub fn from_json(s: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(s)
    }

    pub fn num_slots(&self) -> u64 {
        self.duration_ms.div_ceil(self.params.slot_ms) + 1
    }
}

// ---------------------------------------------------------------- validators

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ValidatorSpec {
    #[serde(default = "d_count")]
    pub count: usize,
    #[serde(default)]
    pub stake: StakeDist,
    /// Regions with relative stake weight for node placement. Empty = preset.
    #[serde(default)]
    pub regions: Vec<RegionSpec>,
}

fn d_count() -> usize {
    25
}

impl Default for ValidatorSpec {
    fn default() -> Self {
        ValidatorSpec {
            count: d_count(),
            stake: StakeDist::default(),
            regions: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "dist", rename_all = "snake_case")]
pub enum StakeDist {
    Uniform,
    /// Heavy-tailed stake like mainnet. Smaller alpha = more concentrated.
    Pareto {
        #[serde(default = "d_alpha")]
        alpha: f64,
    },
    Explicit {
        stakes: Vec<u64>,
    },
}

fn d_alpha() -> f64 {
    1.5
}

impl Default for StakeDist {
    fn default() -> Self {
        StakeDist::Pareto { alpha: d_alpha() }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RegionSpec {
    pub name: String,
    pub weight: f64,
}

impl ValidatorSpec {
    pub fn build(&self, rng: &mut Rng) -> ValidatorSet {
        let raw: Vec<f64> = match &self.stake {
            StakeDist::Uniform => vec![1.0; self.count],
            StakeDist::Pareto { alpha } => (0..self.count)
                .map(|_| {
                    let u = rng.f64().max(1e-9);
                    u.powf(-1.0 / alpha.max(0.1))
                })
                .collect(),
            StakeDist::Explicit { stakes } => stakes.iter().map(|s| *s as f64).collect(),
        };
        let total: f64 = raw.iter().sum();
        let mut stakes: Vec<u64> = raw
            .iter()
            .map(|r| ((r / total) * STAKE_UNITS as f64).round().max(1.0) as u64)
            .collect();
        // Sort descending so node 0 is the largest validator (nicer to read).
        stakes.sort_unstable_by(|a, b| b.cmp(a));
        ValidatorSet::new(stakes)
    }
}

// ------------------------------------------------------------------- network

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct NetworkSpec {
    /// Region names in preset order; custom `latency_ms` must match this order.
    #[serde(default)]
    pub regions: Vec<RegionSpec>,
    /// Optional one-way base latency matrix (ms) between regions.
    #[serde(default)]
    pub latency_ms: Option<Vec<Vec<f64>>>,
    /// Log-normal jitter shape applied multiplicatively to latency.
    #[serde(default = "d_jitter")]
    pub jitter_sigma: f64,
    #[serde(default = "d_local")]
    pub local_latency_ms: f64,
    /// Per-node egress bandwidth. `null` disables the bandwidth model.
    #[serde(default = "d_bw")]
    pub bandwidth_mbps: Option<f64>,
    #[serde(default)]
    pub base_drop_prob: f64,
}

fn d_jitter() -> f64 {
    0.15
}
fn d_local() -> f64 {
    2.0
}
fn d_bw() -> Option<f64> {
    Some(1000.0)
}

impl Default for NetworkSpec {
    fn default() -> Self {
        NetworkSpec {
            regions: Vec::new(),
            latency_ms: None,
            jitter_sigma: d_jitter(),
            local_latency_ms: d_local(),
            bandwidth_mbps: d_bw(),
            base_drop_prob: 0.0,
        }
    }
}

/// Six-region preset roughly matching where Solana stake lives.
pub fn preset_regions() -> Vec<RegionSpec> {
    [
        ("eu-central", 0.30),
        ("eu-west", 0.15),
        ("us-east", 0.25),
        ("us-west", 0.10),
        ("ap-tokyo", 0.12),
        ("ap-singapore", 0.08),
    ]
    .iter()
    .map(|(n, w)| RegionSpec {
        name: n.to_string(),
        weight: *w,
    })
    .collect()
}

/// One-way latencies (ms) between preset regions, same order as `preset_regions`.
pub fn preset_latency_ms() -> Vec<Vec<f64>> {
    vec![
        //  eu-c   eu-w   us-e   us-w   tokyo  sg
        vec![2.0, 6.0, 42.0, 72.0, 118.0, 78.0],
        vec![6.0, 2.0, 38.0, 68.0, 122.0, 84.0],
        vec![42.0, 38.0, 2.0, 34.0, 82.0, 108.0],
        vec![72.0, 68.0, 34.0, 2.0, 54.0, 86.0],
        vec![118.0, 122.0, 82.0, 54.0, 2.0, 36.0],
        vec![78.0, 84.0, 108.0, 86.0, 36.0, 2.0],
    ]
}

// -------------------------------------------------------------------- faults

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Fault {
    /// Nodes crash: they send nothing, receive nothing, lose pending timers.
    Offline {
        target: Target,
        #[serde(default)]
        from_ms: u64,
        #[serde(default)]
        to_ms: Option<u64>,
    },
    /// Messages between groups are dropped.
    Partition {
        groups: PartitionSpec,
        from_ms: u64,
        to_ms: u64,
    },
    /// Extra one-way delay on messages to/from the targeted nodes.
    Delay {
        target: Target,
        extra_ms: f64,
        #[serde(default)]
        from_ms: u64,
        #[serde(default)]
        to_ms: Option<u64>,
    },
    /// Random message loss.
    Drop {
        prob: f64,
        #[serde(default)]
        from_ms: u64,
        #[serde(default)]
        to_ms: Option<u64>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Target {
    Nodes { nodes: Vec<NodeId> },
    /// Random nodes until roughly this fraction of stake is covered.
    StakePct { stake_pct: f64 },
    /// Whoever leads this slot (resolved from the leader schedule).
    LeaderOfSlot { leader_of_slot: u64 },
}

impl Target {
    pub fn resolve(&self, vs: &ValidatorSet, sched: &LeaderSchedule, rng: &mut Rng) -> Vec<NodeId> {
        match self {
            Target::Nodes { nodes } => nodes.clone(),
            Target::LeaderOfSlot { leader_of_slot } => vec![sched.leader(*leader_of_slot)],
            Target::StakePct { stake_pct } => {
                let goal = (*stake_pct * vs.total as f64) as u64;
                let mut ids: Vec<NodeId> = vs.ids().collect();
                rng.shuffle(&mut ids);
                let mut out = Vec::new();
                let mut acc = 0u64;
                // First pass: take nodes that fit under the goal.
                for id in &ids {
                    if acc + vs.stake(*id) <= goal {
                        out.push(*id);
                        acc += vs.stake(*id);
                    }
                }
                // If we fell far short (very coarse stakes), allow one overshoot with the
                // smallest remaining node, so a 5% target can never take a 45% whale offline.
                if (acc as f64) < 0.9 * goal as f64 {
                    if let Some(id) = ids.iter().filter(|id| !out.contains(id)).min_by_key(|id| vs.stake(**id)) {
                        out.push(*id);
                    }
                }
                out.sort_unstable();
                out
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum PartitionSpec {
    Explicit { groups: Vec<Vec<NodeId>> },
    /// Split stake into groups with these approximate fractions (e.g. [0.5, 0.5]).
    StakeSplit { stake_split: Vec<f64> },
    /// Group by region name.
    Regions { regions: Vec<Vec<String>> },
}

// -------------------------------------------------------------------- hero tx

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HeroTx {
    #[serde(default = "d_submit")]
    pub submit_at_ms: u64,
    /// RPC node the client talks to. `null` = a random small validator.
    #[serde(default)]
    pub rpc_node: Option<NodeId>,
}

fn d_submit() -> u64 {
    250
}

impl Default for HeroTx {
    fn default() -> Self {
        HeroTx {
            submit_at_ms: d_submit(),
            rpc_node: None,
        }
    }
}

// --------------------------------------------------------------------- params

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Params {
    #[serde(default = "d_slot")]
    pub slot_ms: u64,
    #[serde(default = "d_window")]
    pub leader_window: u64,
    /// Time to execute (replay) a block after reconstructing it.
    #[serde(default = "d_exec")]
    pub exec_delay_ms: f64,
    #[serde(default)]
    pub alpenglow: AlpenglowParams,
    #[serde(default)]
    pub tower: TowerParams,
}

fn d_slot() -> u64 {
    400
}
fn d_window() -> u64 {
    4
}
fn d_exec() -> f64 {
    15.0
}

impl Default for Params {
    fn default() -> Self {
        Params {
            slot_ms: d_slot(),
            leader_window: d_window(),
            exec_delay_ms: d_exec(),
            alpenglow: AlpenglowParams::default(),
            tower: TowerParams::default(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Propagation {
    /// Single-hop stake-weighted relays (Alpenglow paper).
    Rotor,
    /// Multi-hop tree (what mainnet ships with Votor first).
    Turbine,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AlpenglowParams {
    /// Δtimeout: how long after ParentReady a node waits for the first block of
    /// a window before voting Skip. Must exceed Δblock + propagation delay, since
    /// a block is only voted on once all its slices have arrived. Lower it to
    /// watch the cluster skip healthy leaders.
    #[serde(default = "d_timeout")]
    pub timeout_ms: f64,
    #[serde(default = "d_slices")]
    pub slices_per_block: u32,
    /// Γ: total shreds per slice (data + coding).
    #[serde(default = "d_shreds")]
    pub shreds_per_slice: u32,
    /// γ_data: shreds needed to reconstruct a slice.
    #[serde(default = "d_data")]
    pub data_shreds: u32,
    #[serde(default = "d_prop")]
    pub propagation: Propagation,
    #[serde(default = "d_fast")]
    pub fast_threshold: f64,
    #[serde(default = "d_slow")]
    pub slow_threshold: f64,
    /// SafeToNotar: notar(b) >= this, or ...
    #[serde(default = "d_forty")]
    pub safe_notar_threshold: f64,
    /// ... notar(b) >= this and notar(b)+skip(s) >= slow_threshold.
    #[serde(default = "d_twenty")]
    pub safe_notar_low: f64,
    #[serde(default = "d_forty")]
    pub safe_skip_threshold: f64,
    /// Turbine fanout used when `propagation = turbine`.
    #[serde(default = "d_fanout")]
    pub turbine_fanout: usize,
    /// Δstandstill: a node that has seen no new finalization for this long re-broadcasts
    /// its own votes and every certificate it holds from the last finalized slot on (white
    /// paper "standstill" recovery), so peers that missed them (e.g. across a healed
    /// partition) catch up. Teaching default 2 s; the white paper's value is much longer
    /// (on the order of 10 s), which makes partition recovery invisible in short runs.
    #[serde(default = "d_standstill")]
    pub standstill_ms: f64,
}

fn d_timeout() -> f64 {
    900.0
}
fn d_slices() -> u32 {
    4
}
fn d_shreds() -> u32 {
    8
}
fn d_data() -> u32 {
    4
}
fn d_prop() -> Propagation {
    Propagation::Rotor
}
fn d_fast() -> f64 {
    0.8
}
fn d_slow() -> f64 {
    0.6
}
fn d_forty() -> f64 {
    0.4
}
fn d_twenty() -> f64 {
    0.2
}
fn d_fanout() -> usize {
    4
}
fn d_standstill() -> f64 {
    2_000.0
}

impl Default for AlpenglowParams {
    fn default() -> Self {
        AlpenglowParams {
            timeout_ms: d_timeout(),
            slices_per_block: d_slices(),
            shreds_per_slice: d_shreds(),
            data_shreds: d_data(),
            propagation: d_prop(),
            fast_threshold: d_fast(),
            slow_threshold: d_slow(),
            safe_notar_threshold: d_forty(),
            safe_notar_low: d_twenty(),
            safe_skip_threshold: d_forty(),
            turbine_fanout: d_fanout(),
            standstill_ms: d_standstill(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TowerParams {
    /// FEC sets (batches of shreds) per block.
    #[serde(default = "d_slices")]
    pub fec_sets_per_block: u32,
    #[serde(default = "d_data")]
    pub fec_data_shreds: u32,
    #[serde(default = "d_data")]
    pub fec_coding_shreds: u32,
    /// Turbine tree fanout (Agave uses 200; small values make hops visible).
    #[serde(default = "d_fanout")]
    pub fanout: usize,
    #[serde(default = "d_depth")]
    pub threshold_depth: usize,
    #[serde(default = "d_two_thirds")]
    pub threshold_size: f64,
    #[serde(default = "d_switch")]
    pub switch_threshold: f64,
    #[serde(default = "d_max_lockout")]
    pub max_lockout_history: usize,
    #[serde(default = "d_two_thirds")]
    pub optimistic_threshold: f64,
    /// Votes are also sent peer-to-peer (gossip) so nodes can count them before inclusion.
    #[serde(default = "d_true")]
    pub gossip_votes: bool,
    /// Gulf Stream: forward tx/votes to this many upcoming leaders.
    #[serde(default = "d_two")]
    pub forward_leaders: u32,
    /// Grace period: a leader whose slot begins before it has replayed the
    /// previous slot's block waits up to this long before building on an
    /// older parent (Agave grace ticks).
    #[serde(default = "d_grace")]
    pub grace_ms: f64,
}

fn d_grace() -> f64 {
    200.0
}

fn d_depth() -> usize {
    8
}
fn d_two_thirds() -> f64 {
    2.0 / 3.0
}
fn d_switch() -> f64 {
    0.38
}
fn d_max_lockout() -> usize {
    31
}
fn d_true() -> bool {
    true
}
fn d_two() -> u32 {
    2
}

impl Default for TowerParams {
    fn default() -> Self {
        TowerParams {
            fec_sets_per_block: d_slices(),
            fec_data_shreds: d_data(),
            fec_coding_shreds: d_data(),
            fanout: d_fanout(),
            threshold_depth: d_depth(),
            threshold_size: d_two_thirds(),
            switch_threshold: d_switch(),
            max_lockout_history: d_max_lockout(),
            optimistic_threshold: d_two_thirds(),
            gossip_votes: d_true(),
            forward_leaders: d_two(),
            grace_ms: d_grace(),
        }
    }
}
