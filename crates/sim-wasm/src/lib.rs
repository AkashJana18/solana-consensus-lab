//! WebAssembly bridge. See docs/wasm-api.md for the contract.

use sim_core::metrics::Metrics;
use sim_core::protocol::alpenglow::Alpenglow;
use sim_core::protocol::tower::Tower;
use sim_core::protocol::Protocol;
use sim_core::{Scenario, Simulator, Traced};
use wasm_bindgen::prelude::*;

use sim_core::scenario::BUILTIN;

enum Inner {
    Alpenglow(Simulator<Alpenglow>),
    Tower(Simulator<Tower>),
}

macro_rules! with_sim {
    ($inner:expr, |$s:ident| $body:expr) => {
        match $inner {
            Inner::Alpenglow($s) => $body,
            Inner::Tower($s) => $body,
        }
    };
}

#[wasm_bindgen]
pub struct Sim {
    inner: Inner,
    metrics: Metrics,
    protocol: String,
}

fn meta_json<P: Protocol>(sim: &Simulator<P>) -> String {
    serde_json::json!({
        "protocol": P::NAME,
        "n": sim.validators.len(),
        "stakes": sim.validators.stakes,
        "total_stake": sim.validators.total,
        "regions": sim.network.region_names,
        "node_region": sim.network.node_region,
        "leaders": sim.schedule.leaders,
        "window": sim.schedule.window,
        "slot_ms": sim.params.slot_ms,
        "num_slots": sim.scenario.num_slots(),
        "duration_us": sim.end,
        "scenario": sim.scenario,
    })
    .to_string()
}

#[wasm_bindgen]
impl Sim {
    #[wasm_bindgen(constructor)]
    pub fn new(protocol: &str, scenario_json: &str) -> Result<Sim, JsError> {
        let sc = Scenario::from_json(scenario_json).map_err(|e| JsError::new(&e.to_string()))?;
        let inner = match protocol {
            "alpenglow" => Inner::Alpenglow(Simulator::new(sc).map_err(|e| JsError::new(&e.to_string()))?),
            "tower" => Inner::Tower(Simulator::new(sc).map_err(|e| JsError::new(&e.to_string()))?),
            other => return Err(JsError::new(&format!("unknown protocol '{other}' (alpenglow|tower)"))),
        };
        Ok(Sim { inner, metrics: Metrics::default(), protocol: protocol.to_string() })
    }

    pub fn meta(&self) -> String {
        with_sim!(&self.inner, |s| meta_json(s))
    }

    fn drain(&mut self) -> String {
        let events: Vec<Traced> = with_sim!(&mut self.inner, |s| s.drain_trace());
        for e in &events {
            self.metrics.push(e);
        }
        serde_json::to_string(&events).unwrap_or_else(|_| "[]".into())
    }

    #[wasm_bindgen(js_name = runUntil)]
    pub fn run_until(&mut self, t_micros: f64) -> String {
        let t = t_micros.max(0.0) as u64;
        with_sim!(&mut self.inner, |s| s.run_until(t));
        self.drain()
    }

    pub fn step(&mut self) -> String {
        with_sim!(&mut self.inner, |s| {
            s.step();
        });
        self.drain()
    }

    pub fn now(&self) -> f64 {
        with_sim!(&self.inner, |s| s.now as f64)
    }

    pub fn end(&self) -> f64 {
        with_sim!(&self.inner, |s| s.end as f64)
    }

    #[wasm_bindgen(js_name = isDone)]
    pub fn is_done(&self) -> bool {
        with_sim!(&self.inner, |s| s.is_done())
    }

    pub fn inspect(&self, node: u16) -> String {
        with_sim!(&self.inner, |s| {
            if (node as usize) < s.nodes.len() {
                s.inspect(node).to_string()
            } else {
                "null".to_string()
            }
        })
    }

    pub fn metrics(&self) -> String {
        serde_json::to_string(&self.metrics).unwrap_or_else(|_| "{}".into())
    }

    pub fn snapshot(&self) -> Result<Vec<u8>, JsError> {
        with_sim!(&self.inner, |s| s.snapshot().map_err(|e| JsError::new(&e.to_string())))
    }

    pub fn restore(protocol: &str, bytes: &[u8]) -> Result<Sim, JsError> {
        let inner = match protocol {
            "alpenglow" => Inner::Alpenglow(Simulator::restore(bytes).map_err(|e| JsError::new(&e.to_string()))?),
            "tower" => Inner::Tower(Simulator::restore(bytes).map_err(|e| JsError::new(&e.to_string()))?),
            other => return Err(JsError::new(&format!("unknown protocol '{other}'"))),
        };
        Ok(Sim { inner, metrics: Metrics::default(), protocol: protocol.to_string() })
    }

    pub fn protocol(&self) -> String {
        self.protocol.clone()
    }
}

#[wasm_bindgen(js_name = scenarioNames)]
pub fn scenario_names() -> String {
    serde_json::to_string(&BUILTIN.iter().map(|(n, _)| *n).collect::<Vec<_>>()).unwrap()
}

#[wasm_bindgen(js_name = builtinScenario)]
pub fn builtin_scenario(name: &str) -> Option<String> {
    BUILTIN.iter().find(|(n, _)| *n == name).map(|(_, j)| j.to_string())
}

#[wasm_bindgen(js_name = validateScenario)]
pub fn validate_scenario(json: &str) -> String {
    match Scenario::from_json(json) {
        Ok(sc) => match Simulator::<Alpenglow>::new(sc) {
            Ok(_) => "ok".into(),
            Err(e) => e.to_string(),
        },
        Err(e) => e.to_string(),
    }
}
