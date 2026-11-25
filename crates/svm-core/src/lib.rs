//! The SVM lab engine: a deterministic sBPF-subset runtime.
//!
//! It exists to make three things visible, in the order Lecture 5 teaches them:
//! where state lives, how code gets there, and what happens when it runs.

pub mod isa;
pub mod limits;
pub mod memory;
pub mod programs;
pub mod regs;
pub mod scenario;
pub mod trace;
pub mod verify;
pub mod vm;

use serde::Serialize;

use crate::limits::{constants, Constant};
use crate::memory::MappingMode;
use crate::programs::{builtin, Program};
use crate::scenario::Scenario;
use crate::trace::{Check, RegionView};
use crate::vm::layout;

#[derive(Clone, Debug, Serialize)]
pub struct InsnView {
    pub index: usize,
    pub mnemonic: String,
    pub text: String,
    pub label: String,
    pub cost: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct ProgramView {
    pub name: String,
    pub summary: String,
    pub insns: Vec<InsnView>,
}

pub fn program_view(program: &Program) -> ProgramView {
    ProgramView {
        name: program.name.clone(),
        summary: program.summary.clone(),
        insns: program
            .insns
            .iter()
            .enumerate()
            .map(|(index, insn)| InsnView {
                index,
                mnemonic: insn.mnemonic().into(),
                text: insn.text(),
                label: program.label(index).into(),
                cost: insn.cost(),
            })
            .collect(),
    }
}

pub fn programs_json() -> String {
    let views: Vec<ProgramView> = programs::NAMES
        .iter()
        .filter_map(|name| builtin(name).as_ref().map(program_view))
        .collect();
    serde_json::to_string(&views).unwrap_or_else(|_| "[]".into())
}

#[derive(Serialize)]
struct LayoutView<'a> {
    regions: Vec<RegionView>,
    constants: Vec<Constant>,
    modes: [&'a str; 3],
}

pub fn layout_json(mode: &str) -> String {
    let mapping = match mode {
        "identity" => MappingMode::Identity,
        "unaligned" => MappingMode::Unaligned,
        _ => MappingMode::Aligned,
    };
    let view = LayoutView {
        regions: layout(mapping),
        constants: constants(),
        modes: ["identity", "aligned", "unaligned"],
    };
    serde_json::to_string(&view).unwrap_or_else(|_| "{}".into())
}

pub fn run_json(scenario_json: &str) -> Result<String, String> {
    let scenario = Scenario::from_json(scenario_json)?;
    let program = scenario.program()?;
    let run = vm::run(&program, &scenario);
    serde_json::to_string(&run).map_err(|e| e.to_string())
}

pub fn verify_json(scenario_json: &str) -> Result<String, String> {
    let scenario = Scenario::from_json(scenario_json)?;
    let program = scenario.program()?;
    let checks: Vec<Check> = verify::verify(&program, &scenario);
    serde_json::to_string(&checks).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::isa::Insn;
    use crate::memory::{host_address, region_of, MemError, Region};
    use crate::scenario::hex_decode;

    fn scenario(program: &str) -> Scenario {
        Scenario {
            program: program.into(),
            ..Default::default()
        }
    }

    #[test]
    fn counter_commits_the_increment() {
        let run = run_json(&scenario("counter").to_json()).unwrap();
        let run: serde_json::Value = serde_json::from_str(&run).unwrap();
        assert_eq!(run["result"]["ok"], true);
        assert_eq!(run["result"]["committed"], true);
        assert_eq!(run["accounts_after"][0]["data_hex"], "2a00000000000000");
        assert_eq!(run["accounts_before"][0]["data_hex"], "2900000000000000");
        assert!(!run["steps"].as_array().unwrap().is_empty());
    }

    #[test]
    fn runs_are_byte_identical() {
        let json = scenario("counter").to_json();
        assert_eq!(run_json(&json).unwrap(), run_json(&json).unwrap());
    }

    #[test]
    fn counter_charges_compute_units() {
        let run = vm::run(&scenario("counter").program().unwrap(), &scenario("counter"));
        assert!(run.cu_used > 0);
        assert!(run.cu_used < 10_000);
        assert!(run.steps.iter().any(|s| s.syscall.is_some()));
    }

    #[test]
    fn out_of_bounds_read_fails_without_commit() {
        let run = vm::run(&scenario("out-of-bounds").program().unwrap(), &scenario("out-of-bounds"));
        assert!(!run.result.ok);
        assert_eq!(run.result.code, "out-of-bounds");
        assert!(!run.result.committed);
        assert_eq!(run.accounts_after[0].data_hex, run.accounts_before[0].data_hex);
    }

    #[test]
    fn read_only_account_write_is_rejected() {
        let run = vm::run(&scenario("readonly-write").program().unwrap(), &scenario("readonly-write"));
        assert!(!run.result.ok);
        assert_eq!(run.result.code, "read-only-account");
    }

    #[test]
    fn rodata_write_is_rejected() {
        let run = vm::run(&scenario("rodata-write").program().unwrap(), &scenario("rodata-write"));
        assert!(!run.result.ok);
        assert_eq!(run.result.code, "read-only-region");
    }

    #[test]
    fn heap_overflow_is_rejected() {
        let run = vm::run(&scenario("heap-overflow").program().unwrap(), &scenario("heap-overflow"));
        assert!(!run.result.ok);
        assert_eq!(run.result.code, "out-of-bounds");
    }

    #[test]
    fn recursion_hits_the_frame_limit() {
        let run = vm::run(&scenario("recursion").program().unwrap(), &scenario("recursion"));
        assert!(!run.result.ok);
        assert_eq!(run.result.code, "stack-overflow");
    }

    #[test]
    fn infinite_loop_hits_the_budget() {
        let run = vm::run(&scenario("cu-exhausted").program().unwrap(), &scenario("cu-exhausted"));
        assert!(!run.result.ok);
        assert_eq!(run.result.code, "budget-exceeded");
        assert_eq!(run.cu_used, 200_000);
    }

    #[test]
    fn unknown_syscall_is_rejected() {
        let run = vm::run(&scenario("bad-syscall").program().unwrap(), &scenario("bad-syscall"));
        assert!(!run.result.ok);
        assert_eq!(run.result.code, "bad-syscall");
    }

    #[test]
    fn stack_frame_moves_r10_and_restores_it() {
        let run = vm::run(&scenario("stack-frame").program().unwrap(), &scenario("stack-frame"));
        assert!(run.result.ok);
        let call = run.steps.iter().find(|s| s.kind == crate::trace::StepKind::Call).unwrap();
        assert_eq!(call.frame, 1);
        let last = run.steps.last().unwrap();
        assert_eq!(last.frame, 0);
        assert_eq!(last.r10, run.steps[0].r10);
    }

    #[test]
    fn verification_passes_the_builtins() {
        // Two builtins exist to fail: the unknown syscall, and recursion. Everything else
        // must survive the checklist.
        for name in programs::NAMES
            .iter()
            .filter(|name| !matches!(**name, "bad-syscall" | "recursion"))
        {
            let sc = scenario(name);
            let checks = verify::verify(&sc.program().unwrap(), &sc);
            let failures: Vec<_> = checks.iter().filter(|c| !c.ok).map(|c| c.id).collect();
            assert!(failures.is_empty(), "{name} failed {failures:?}");
        }
    }

    #[test]
    fn recursion_fails_verification() {
        let sc = scenario("recursion");
        let checks = verify::verify(&sc.program().unwrap(), &sc);
        assert!(checks.iter().any(|c| c.id == "recursion" && !c.ok));
    }

    #[test]
    fn each_fault_trips_its_own_check() {
        let cases = [
            ("empty", "not-empty"),
            ("opcode", "opcodes"),
            ("register", "registers"),
            ("r10", "r10"),
            ("jump", "calls"),
            ("syscall", "syscalls"),
        ];
        for (fault, expected) in cases {
            let sc = Scenario {
                program: "counter".into(),
                fault: Some(fault.into()),
                ..Default::default()
            };
            let checks = verify::verify(&sc.program().unwrap(), &sc);
            let failed: Vec<_> = checks.iter().filter(|c| !c.ok).map(|c| c.id).collect();
            assert_eq!(failed, vec![expected], "fault {fault}");
        }
    }

    #[test]
    fn alignment_and_identity_mapping() {
        let aligned = host_address(Region::Stack, 64, MappingMode::Aligned, 8).unwrap();
        assert_eq!(aligned, Region::Stack.host_base() + 64);
        assert!(matches!(
            host_address(Region::Stack, 63, MappingMode::Aligned, 8),
            Err(MemError::Misaligned { .. })
        ));
        assert!(host_address(Region::Stack, 63, MappingMode::Unaligned, 8).is_ok());
        assert_eq!(
            host_address(Region::Stack, 64, MappingMode::Identity, 8).unwrap(),
            Region::Stack.base() + 64
        );
    }

    #[test]
    fn every_region_resolves_at_its_base() {
        for region in Region::ALL {
            assert_eq!(region_of(region.base()), Some((region, 0)));
            assert_eq!(region_of(region.base() + 123), Some((region, 123)));
        }
        assert_eq!(region_of(crate::limits::REGION_SLICE * 5), None);
    }

    #[test]
    fn hex_round_trips() {
        let bytes = vec![0, 1, 0x29, 0xff];
        let text = crate::scenario::hex_encode(&bytes);
        assert_eq!(text, "000129ff");
        assert_eq!(hex_decode(&text).unwrap(), bytes);
        assert!(hex_decode("abc").is_err());
    }

    #[test]
    fn r10_write_is_rejected_at_runtime() {
        let mut sc = scenario("counter");
        sc.fault = Some("r10".into());
        let run = vm::run(&sc.program().unwrap(), &sc);
        assert!(!run.result.ok);
        assert_eq!(run.result.code, "r10-write");
    }

    #[test]
    fn program_view_lists_every_instruction() {
        let program = builtin("counter").unwrap();
        let view = program_view(&program);
        assert_eq!(view.insns.len(), program.insns.len());
        assert_eq!(view.insns[0].mnemonic, "lddw");
        assert_eq!(program.insns[5], Insn::Syscall { name: "sol_log_64".into() });
    }
}
