//! `consensus-lab`: headless runner for the Solana consensus simulator.
//!
//!   consensus-lab scenarios
//!   consensus-lab run --scenario happy-path --protocol both --out trace.jsonl
//!   consensus-lab inspect --scenario leader-down --protocol alpenglow --node 3 --at-ms 2500
//!   consensus-lab replay --trace trace.jsonl --at-ms 900
//!   consensus-lab sweep --scenario offline-25pct --protocol both \
//!       --param faults.0.target.stake_pct=0..0.4:0.05 --seeds 10 --csv sweep.csv

use anyhow::{bail, Context, Result};
use clap::{Parser, Subcommand};
use serde::Serialize;
use sim_core::metrics::Metrics;
use sim_core::protocol::alpenglow::Alpenglow;
use sim_core::protocol::tower::Tower;
use sim_core::protocol::Protocol;
use sim_core::scenario::{builtin, BUILTIN};
use sim_core::trace::{Commitment, TraceEvent};
use sim_core::{Scenario, Simulator, Traced};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{BufRead, Write};

#[derive(Parser)]
#[command(name = "consensus-lab", version, about = "Headless Solana consensus simulator (TowerBFT vs Alpenglow)")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// List built-in scenarios.
    Scenarios,
    /// Run a scenario; print a summary and optionally write the trace (JSON lines).
    Run {
        /// Built-in scenario name or path to a JSON file.
        #[arg(long)]
        scenario: String,
        /// alpenglow | tower | both
        #[arg(long, default_value = "both")]
        protocol: String,
        #[arg(long)]
        seed: Option<u64>,
        /// Stop early (ms of simulated time).
        #[arg(long)]
        until_ms: Option<u64>,
        /// Write every trace event as one JSON object per line ("{protocol}" is substituted).
        #[arg(long)]
        out: Option<String>,
        /// Print this many notable events (default 0).
        #[arg(long, default_value_t = 0)]
        events: usize,
        /// Only print events of these types, comma separated (e.g. tx_stage,certificate,log).
        #[arg(long)]
        only: Option<String>,
    },
    /// Print a node's inspector view at a point in simulated time.
    Inspect {
        #[arg(long)]
        scenario: String,
        #[arg(long, default_value = "alpenglow")]
        protocol: String,
        #[arg(long)]
        node: u16,
        #[arg(long)]
        at_ms: u64,
    },
    /// Summarize a recorded trace up to a point in time.
    Replay {
        #[arg(long)]
        trace: String,
        #[arg(long)]
        at_ms: Option<u64>,
    },
    /// Sweep one scenario parameter over a range and seeds; write CSV.
    Sweep {
        #[arg(long)]
        scenario: String,
        #[arg(long, default_value = "both")]
        protocol: String,
        /// dotted.path=from..to:step, e.g. params.alpenglow.timeout_ms=400..1200:100
        #[arg(long)]
        param: String,
        #[arg(long, default_value_t = 5)]
        seeds: u64,
        #[arg(long)]
        csv: String,
    },
}

fn load_scenario(name_or_path: &str) -> Result<Scenario> {
    let json = match builtin(name_or_path) {
        Some(j) => j.to_string(),
        None => std::fs::read_to_string(name_or_path).with_context(|| format!("reading scenario {name_or_path}"))?,
    };
    Ok(Scenario::from_json(&json)?)
}

fn protocols(p: &str) -> Result<Vec<&'static str>> {
    Ok(match p {
        "alpenglow" => vec!["alpenglow"],
        "tower" => vec!["tower"],
        "both" => vec!["alpenglow", "tower"],
        other => bail!("unknown protocol '{other}' (alpenglow|tower|both)"),
    })
}

struct RunOutput {
    trace: Vec<Traced>,
    metrics: Metrics,
    stats: sim_core::sim::Stats,
}

fn run_protocol<P: Protocol>(sc: Scenario, until_ms: Option<u64>) -> Result<RunOutput> {
    let mut sim = Simulator::<P>::new(sc)?;
    match until_ms {
        Some(t) => sim.run_until(t * 1000),
        None => sim.run_to_end(),
    }
    let trace = sim.drain_trace();
    let metrics = Metrics::from_trace(&trace);
    Ok(RunOutput { trace, metrics, stats: sim.stats.clone() })
}

fn run_any(protocol: &str, sc: Scenario, until_ms: Option<u64>) -> Result<RunOutput> {
    match protocol {
        "alpenglow" => run_protocol::<Alpenglow>(sc, until_ms),
        "tower" => run_protocol::<Tower>(sc, until_ms),
        other => bail!("unknown protocol {other}"),
    }
}

fn print_summary(protocol: &str, out: &RunOutput) {
    let m = &out.metrics;
    let stage = |k: &str| m.tx_stage_ms.get(k).map(|v| format!("{v:>9.1} ms")).unwrap_or_else(|| "        —   ".into());
    println!("== {protocol}");
    println!("  hero tx   submitted {}  included {}  confirmed {}  finalized {}", stage("submitted"), stage("included_in_block"), stage("confirmed"), stage("finalized"));
    if let (Some(i), Some(f)) = (m.tx_stage_ms.get("included_in_block"), m.tx_stage_ms.get("finalized")) {
        println!("  inclusion → finality {:>8.1} ms", f - i);
    }
    println!("  blocks {}  slots {}  msgs {}  bytes {:.1} MB  dropped {}", m.blocks_produced, m.slots_started, m.total_msgs, m.total_bytes as f64 / 1e6, out.stats.msgs_dropped);
    if !m.certificates.is_empty() {
        println!("  certificates {:?}", m.certificates);
    }
    if m.vote_txs_in_blocks > 0 {
        println!("  vote txs packed into blocks: {} ({:.1} KB of block space)", m.vote_txs_in_blocks, m.vote_tx_bytes_in_blocks as f64 / 1e3);
    }
}

fn print_events(out: &RunOutput, events: usize, only: &Option<String>) -> Result<()> {
    if events == 0 {
        return Ok(());
    }
    let only: Option<Vec<String>> = only.as_ref().map(|s| s.split(',').map(|x| x.trim().to_string()).collect());
    let mut shown = 0;
    for t in &out.trace {
        let v = serde_json::to_value(&t.ev)?;
        let ty = v["type"].as_str().unwrap_or("");
        let show = match &only {
            Some(list) => list.iter().any(|x| x == ty),
            None => !matches!(
                t.ev,
                TraceEvent::MsgSent { .. } | TraceEvent::MsgDropped { .. } | TraceEvent::Vote { .. } | TraceEvent::VotorFlag { .. }
                    | TraceEvent::BlockReceived { .. } | TraceEvent::BlockReplayed { .. } | TraceEvent::Commitment { .. } | TraceEvent::TowerUpdate { .. }
            ),
        };
        if show {
            println!("{:>9.1} ms  {}", t.t as f64 / 1000.0, v);
            shown += 1;
            if shown >= events {
                break;
            }
        }
    }
    Ok(())
}

#[derive(Serialize)]
struct TraceLine<'a> {
    protocol: &'a str,
    #[serde(flatten)]
    ev: &'a Traced,
}

fn write_trace(path: &str, protocol: &str, trace: &[Traced]) -> Result<()> {
    let path = path.replace("{protocol}", protocol);
    let f = std::fs::File::create(&path)?;
    let mut w = std::io::BufWriter::new(f);
    for t in trace {
        serde_json::to_writer(&mut w, &TraceLine { protocol, ev: t })?;
        w.write_all(b"\n")?;
    }
    println!("  wrote {} events to {path}", trace.len());
    Ok(())
}

fn replay(path: &str, at_ms: Option<u64>) -> Result<()> {
    let f = std::fs::File::open(path)?;
    let cutoff = at_ms.map(|m| m * 1000).unwrap_or(u64::MAX);
    let mut by_protocol: BTreeMap<String, Vec<Traced>> = BTreeMap::new();
    for line in std::io::BufReader::new(f).lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let mut v: serde_json::Value = serde_json::from_str(&line)?;
        let protocol = v.get("protocol").and_then(|p| p.as_str()).unwrap_or("unknown").to_string();
        v.as_object_mut().map(|o| o.remove("protocol"));
        let t: Traced = serde_json::from_value(v)?;
        if t.t <= cutoff {
            by_protocol.entry(protocol).or_default().push(t);
        }
    }
    for (protocol, trace) in by_protocol {
        let m = Metrics::from_trace(&trace);
        let mut finalized: BTreeMap<u64, BTreeSet<u64>> = BTreeMap::new();
        let mut per_node_final: BTreeMap<u16, u64> = BTreeMap::new();
        let mut last_slot = 0;
        for t in &trace {
            match &t.ev {
                TraceEvent::Commitment { node, slot, hash, level: Commitment::Finalized } => {
                    finalized.entry(*slot).or_default().insert(*hash);
                    let e = per_node_final.entry(*node).or_default();
                    *e = (*e).max(*slot);
                }
                TraceEvent::SlotStart { slot, .. } | TraceEvent::BlockProduced { slot, .. } => last_slot = last_slot.max(*slot),
                _ => {}
            }
        }
        println!("== {protocol} @ {} ms", trace.last().map(|t| t.t / 1000).unwrap_or(0));
        println!("  events {}  latest slot {}  finalized slots {}  conflicting slots {}", trace.len(), last_slot, finalized.len(), finalized.values().filter(|h| h.len() > 1).count());
        println!("  hero tx stages: {:?}", m.tx_stage_ms);
        println!("  highest finalized slot per node: {:?}", per_node_final);
    }
    Ok(())
}

fn set_path(v: &mut serde_json::Value, dotted: &str, val: f64) -> Result<()> {
    let ptr = format!("/{}", dotted.replace('.', "/"));
    let slot = v.pointer_mut(&ptr).with_context(|| format!("no such field {dotted}"))?;
    *slot = if slot.is_u64() || slot.is_i64() {
        serde_json::Value::from(val.round() as i64)
    } else {
        serde_json::Value::from(val)
    };
    Ok(())
}

fn sweep(scenario: &str, protocol: &str, param: &str, seeds: u64, csv: &str) -> Result<()> {
    let (path, range) = param.split_once('=').context("param must be path=from..to:step")?;
    let (bounds, step) = range.split_once(':').context("range must be from..to:step")?;
    let (from, to) = bounds.split_once("..").context("range must be from..to:step")?;
    let (from, to, step): (f64, f64, f64) = (from.parse()?, to.parse()?, step.parse()?);
    if step <= 0.0 {
        bail!("step must be > 0");
    }
    let base = load_scenario(scenario)?;
    let mut base_json = serde_json::to_value(&base)?;
    let mut w = std::io::BufWriter::new(std::fs::File::create(csv)?);
    writeln!(w, "param,value,seed,protocol,included_ms,confirmed_ms,finalized_ms,blocks,slots,msgs,bytes,dropped")?;
    let mut value = from;
    let mut runs = 0;
    while value <= to + 1e-9 {
        set_path(&mut base_json, path, value)?;
        for seed in 1..=seeds {
            let mut sc: Scenario = serde_json::from_value(base_json.clone())?;
            sc.seed = seed;
            for p in protocols(protocol)? {
                let out = run_any(p, sc.clone(), None)?;
                let m = &out.metrics;
                let g = |k: &str| m.tx_stage_ms.get(k).map(|v| format!("{v:.1}")).unwrap_or_default();
                let vstr = format!("{value:.6}");
                let vstr = vstr.trim_end_matches('0').trim_end_matches('.');
                writeln!(w, "{path},{vstr},{seed},{p},{},{},{},{},{},{},{},{}", g("included_in_block"), g("confirmed"), g("finalized"), m.blocks_produced, m.slots_started, m.total_msgs, m.total_bytes, out.stats.msgs_dropped)?;
                runs += 1;
            }
        }
        value += step;
    }
    println!("wrote {runs} runs to {csv}");
    Ok(())
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Scenarios => {
            for (name, json) in BUILTIN {
                let sc = Scenario::from_json(json)?;
                println!("{name:<16} {}", sc.description);
            }
        }
        Cmd::Run { scenario, protocol, seed, until_ms, out, events, only } => {
            let mut sc = load_scenario(&scenario)?;
            if let Some(s) = seed {
                sc.seed = s;
            }
            println!("scenario {} (seed {}, {} validators, {} ms)", sc.name, sc.seed, sc.validators.count, sc.duration_ms);
            for p in protocols(&protocol)? {
                let result = run_any(p, sc.clone(), until_ms)?;
                print_summary(p, &result);
                print_events(&result, events, &only)?;
                if let Some(path) = &out {
                    write_trace(path, p, &result.trace)?;
                }
            }
        }
        Cmd::Inspect { scenario, protocol, node, at_ms } => {
            let sc = load_scenario(&scenario)?;
            let v = match protocol.as_str() {
                "alpenglow" => {
                    let mut sim = Simulator::<Alpenglow>::new(sc)?;
                    sim.run_until(at_ms * 1000);
                    sim.inspect(node)
                }
                "tower" => {
                    let mut sim = Simulator::<Tower>::new(sc)?;
                    sim.run_until(at_ms * 1000);
                    sim.inspect(node)
                }
                other => bail!("unknown protocol {other}"),
            };
            println!("{}", serde_json::to_string_pretty(&v)?);
        }
        Cmd::Replay { trace, at_ms } => replay(&trace, at_ms)?,
        Cmd::Sweep { scenario, protocol, param, seeds, csv } => sweep(&scenario, &protocol, &param, seeds, &csv)?,
    }
    Ok(())
}
