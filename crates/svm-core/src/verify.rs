//! The eleven-check verifier from the lecture, reduced to the checks this subset can
//! actually enforce. Each check is independent so Chapter 2 can inject one fault at a time.

use crate::isa::{syscall, Insn};
use crate::limits::{MAX_CALL_DEPTH, MAX_PROGRAM_BYTES};
use crate::programs::Program;
use crate::scenario::Scenario;
use crate::trace::Check;

fn check(id: &'static str, label: &'static str, detail: &'static str, ok: bool) -> Check {
    Check {
        id,
        label,
        detail,
        ok,
    }
}

/// Recursion is a cycle in the local-call graph. The verifier rejects it, which is why
/// the runtime's 64-frame limit is a backstop rather than the primary defence.
fn has_recursion(insns: &[Insn]) -> bool {
    fn dfs(pc: usize, insns: &[Insn], color: &mut [u8]) -> bool {
        match color[pc] {
            1 => return true,
            2 => return false,
            _ => {}
        }
        color[pc] = 1;
        if let Insn::Call { target } = insns[pc] {
            let target = target as usize;
            if target < insns.len() && dfs(target, insns, color) {
                return true;
            }
        }
        color[pc] = 2;
        false
    }

    let mut color = vec![0u8; insns.len()];
    (0..insns.len()).any(|pc| dfs(pc, insns, &mut color))
}

pub fn verify(program: &Program, scenario: &Scenario) -> Vec<Check> {
    let insns = &program.insns;
    let len = insns.len();

    let not_empty = !insns.is_empty();
    let opcodes = insns.iter().all(|i| !matches!(i, Insn::Invalid { .. }));
    let registers = insns
        .iter()
        .all(|i| i.registers().iter().all(|r| *r < 11));
    let r10 = insns.iter().all(|i| !i.writes_register(10));
    let calls = insns.iter().all(|i| match i {
        Insn::Call { target } => (*target as usize) < len,
        _ => true,
    });
    let recursion = !has_recursion(insns);
    let jumps = insns.iter().enumerate().all(|(pc, i)| {
        let off = match i {
            Insn::Jmp { off } | Insn::JeqImm { off, .. } | Insn::JneImm { off, .. } => *off,
            _ => return true,
        };
        let target = pc as i64 + 1 + off as i64;
        target >= 0 && (target as usize) < len
    });
    let syscalls = insns.iter().all(|i| match i {
        Insn::Syscall { name } => syscall(name).is_some(),
        _ => true,
    });
    let stack = scenario.call_depth <= MAX_CALL_DEPTH;
    let size = scenario.elf_bytes <= MAX_PROGRAM_BYTES;

    vec![
        check(
            "not-empty",
            "Program is not empty",
            "The .text section must contain at least one instruction.",
            not_empty,
        ),
        check(
            "opcodes",
            "Every opcode is sBPF",
            "No non-sBPF opcodes may appear in the compiled program.",
            opcodes,
        ),
        check(
            "registers",
            "Registers are r0 to r10",
            "Every referenced register must exist.",
            registers,
        ),
        check(
            "r10",
            "r10 is read-only",
            "The frame pointer can be read and used as a base, never written.",
            r10,
        ),
        check(
            "calls",
            "Call targets are inside the program",
            "A call must land on an instruction in a valid function.",
            calls,
        ),
        check(
            "jumps",
            "Jumps stay inside function bounds",
            "Every relative jump must resolve to an instruction in this program.",
            jumps,
        ),
        check(
            "recursion",
            "No recursive calls",
            "Recursion is rejected so the call stack stays bounded. The frame limit is the backstop.",
            recursion,
        ),
        check(
            "syscalls",
            "Every syscall is registered",
            "The loader rejects a syscall the runtime does not know.",
            syscalls,
        ),
        check(
            "stack",
            "Call depth is bounded",
            "Recursion is rejected. The frame limit is 64.",
            stack,
        ),
        check(
            "size",
            "ELF fits the 10 MiB ceiling",
            "BPFLoader rejects a program image larger than 10 MiB.",
            size,
        ),
    ]
}
