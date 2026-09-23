//! `sim-core`: deterministic discrete-event simulation of Solana consensus.
//!
//! Two protocols share one engine: [`protocol::tower`] (TowerBFT + PoH +
//! Turbine, today's mainnet) and [`protocol::alpenglow`] (Votor + Rotor,
//! SIMD-0326). Everything observable is emitted as [`trace::TraceEvent`]s.

pub mod metrics;
pub mod network;
pub mod protocol;
pub mod rng;
pub mod scenario;
pub mod sim;
pub mod stake;
pub mod time;
pub mod trace;
pub mod tx;

pub use scenario::Scenario;
pub use sim::{SimError, Simulator};
pub use trace::{TraceEvent, Traced};

#[cfg(test)]
mod engine_tests {
    use super::protocol::ping::Ping;
    use super::*;

    fn scenario() -> Scenario {
        Scenario::from_json(r#"{"name":"t","duration_ms":2000,"validators":{"count":10}}"#).unwrap()
    }

    #[test]
    fn ping_reaches_everyone() {
        let mut sim = Simulator::<Ping>::new(scenario()).unwrap();
        sim.run_to_end();
        assert_eq!(sim.nodes[0].pongs, 9);
        assert!(sim.stats.msgs_sent >= 18);
    }

    #[test]
    fn deterministic_trace() {
        let mut a = Simulator::<Ping>::new(scenario()).unwrap();
        let mut b = Simulator::<Ping>::new(scenario()).unwrap();
        a.run_to_end();
        b.run_to_end();
        assert_eq!(serde_json::to_string(a.trace()).unwrap(), serde_json::to_string(b.trace()).unwrap());
    }

    #[test]
    fn snapshot_roundtrip_continues_identically() {
        let mut a = Simulator::<Ping>::new(scenario()).unwrap();
        a.run_until(20_000);
        let bytes = a.snapshot().unwrap();
        let mut b = Simulator::<Ping>::restore(&bytes).unwrap();
        a.drain_trace();
        b.drain_trace();
        a.run_to_end();
        b.run_to_end();
        assert_eq!(serde_json::to_string(a.trace()).unwrap(), serde_json::to_string(b.trace()).unwrap());
    }
}
