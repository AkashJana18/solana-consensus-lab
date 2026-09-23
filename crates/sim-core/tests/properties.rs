//! Property-based safety/liveness checks over random seeds and fault levels.

use proptest::prelude::*;
use sim_core::protocol::alpenglow::Alpenglow;
use sim_core::protocol::tower::Tower;
use sim_core::trace::{Commitment, TraceEvent};
use sim_core::{Scenario, Simulator, Traced};
use std::collections::{BTreeMap, BTreeSet};

fn finalized_by_slot(tr: &[Traced]) -> BTreeMap<u64, BTreeSet<u64>> {
    let mut m: BTreeMap<u64, BTreeSet<u64>> = BTreeMap::new();
    for t in tr {
        if let TraceEvent::Commitment { slot, hash, level: Commitment::Finalized, .. } = &t.ev {
            m.entry(*slot).or_default().insert(*hash);
        }
    }
    m
}

fn hero_finalized(tr: &[Traced]) -> bool {
    tr.iter().any(|t| matches!(t.ev, TraceEvent::TxStage { stage: sim_core::tx::TxStage::Finalized, .. }))
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 12, .. ProptestConfig::default() })]

    /// Alpenglow safety + liveness with ≤20% offline stake and random loss ≤2%.
    #[test]
    fn alpenglow_20pct_offline_is_safe_and_live(seed in 1u64..10_000, offline in 0.0f64..0.2, drop in 0.0f64..0.02, n in 12usize..30) {
        let json = format!(r#"{{"name":"p","seed":{seed},"duration_ms":12000,"validators":{{"count":{n}}},
            "network":{{"base_drop_prob":{drop}}},
            "faults":[{{"kind":"offline","target":{{"stake_pct":{offline}}},"from_ms":0}}]}}"#);
        let mut sim = Simulator::<Alpenglow>::new(Scenario::from_json(&json).unwrap()).unwrap();
        sim.run_to_end();
        let tr = sim.drain_trace();
        for (slot, hashes) in finalized_by_slot(&tr) {
            prop_assert_eq!(hashes.len(), 1, "conflicting finalization in slot {}", slot);
        }
        prop_assert!(hero_finalized(&tr), "hero tx not finalized with {:.0}% offline", offline * 100.0);
    }

    /// Alpenglow never finalizes conflicting blocks through partitions of any shape.
    #[test]
    fn alpenglow_partitions_never_conflict(seed in 1u64..10_000, split in 0.2f64..0.8, len_ms in 500u64..4000) {
        let json = format!(r#"{{"name":"p","seed":{seed},"duration_ms":12000,"validators":{{"count":20}},
            "faults":[{{"kind":"partition","groups":{{"stake_split":[{split},{}]}},"from_ms":1000,"to_ms":{}}}]}}"#, 1.0 - split, 1000 + len_ms);
        let mut sim = Simulator::<Alpenglow>::new(Scenario::from_json(&json).unwrap()).unwrap();
        sim.run_to_end();
        let tr = sim.drain_trace();
        for (slot, hashes) in finalized_by_slot(&tr) {
            prop_assert_eq!(hashes.len(), 1, "conflicting finalization in slot {}", slot);
        }
    }

    /// TowerBFT roots are consistent across nodes through short partitions.
    #[test]
    fn tower_roots_never_conflict(seed in 1u64..10_000, split in 0.3f64..0.7, len_ms in 400u64..1600) {
        let json = format!(r#"{{"name":"p","seed":{seed},"duration_ms":18000,"validators":{{"count":20}},
            "faults":[{{"kind":"partition","groups":{{"stake_split":[{split},{}]}},"from_ms":1000,"to_ms":{}}}]}}"#, 1.0 - split, 1000 + len_ms);
        let mut sim = Simulator::<Tower>::new(Scenario::from_json(&json).unwrap()).unwrap();
        sim.run_to_end();
        let tr = sim.drain_trace();
        for (slot, hashes) in finalized_by_slot(&tr) {
            prop_assert_eq!(hashes.len(), 1, "conflicting roots in slot {}", slot);
        }
    }
}

#[test]
fn both_protocols_are_deterministic() {
    for (name, json) in sim_core::scenario::BUILTIN {
        let sc = Scenario::from_json(json).unwrap();
        let run_a = {
            let mut s = Simulator::<Alpenglow>::new(sc.clone()).unwrap();
            s.run_to_end();
            serde_json::to_string(&s.drain_trace()).unwrap()
        };
        let run_b = {
            let mut s = Simulator::<Alpenglow>::new(sc.clone()).unwrap();
            s.run_to_end();
            serde_json::to_string(&s.drain_trace()).unwrap()
        };
        assert_eq!(run_a, run_b, "alpenglow nondeterministic on {name}");
        let run_a = {
            let mut s = Simulator::<Tower>::new(sc.clone()).unwrap();
            s.run_to_end();
            serde_json::to_string(&s.drain_trace()).unwrap()
        };
        let run_b = {
            let mut s = Simulator::<Tower>::new(sc.clone()).unwrap();
            s.run_to_end();
            serde_json::to_string(&s.drain_trace()).unwrap()
        };
        assert_eq!(run_a, run_b, "tower nondeterministic on {name}");
    }
}
