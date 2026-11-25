//! Built-in programs. Each one exists to make one rule visible.

use crate::isa::Insn;
use crate::limits::{HEAP_BASE, INPUT_BASE, STACK_BASE, TEXT_BASE};

#[derive(Clone, Debug)]
pub struct Program {
    pub name: String,
    pub summary: String,
    pub insns: Vec<Insn>,
    pub labels: Vec<String>,
}

impl Program {
    pub fn new(name: &str, summary: &str, insns: Vec<Insn>, labels: Vec<&str>) -> Self {
        let mut labels: Vec<String> = labels.into_iter().map(str::to_string).collect();
        labels.resize(insns.len(), String::new());
        Program {
            name: name.into(),
            summary: summary.into(),
            insns,
            labels,
        }
    }

    pub fn label(&self, index: usize) -> &str {
        self.labels
            .get(index)
            .map(String::as_str)
            .unwrap_or("")
    }
}

pub const NAMES: &[&str] = &[
    "counter",
    "stack-frame",
    "out-of-bounds",
    "heap-overflow",
    "recursion",
    "readonly-write",
    "rodata-write",
    "bad-syscall",
    "cu-exhausted",
];

pub fn builtin(name: &str) -> Option<Program> {
    let program = match name {
        "counter" => Program::new(
            "counter",
            "Read the counter account, add one, write it back, then log it.",
            vec![
                Insn::Lddw {
                    dst: 1,
                    imm: INPUT_BASE,
                },
                Insn::Ldx {
                    dst: 2,
                    src: 1,
                    off: 0,
                    size: 8,
                },
                Insn::AddImm { dst: 2, imm: 1 },
                Insn::Stx {
                    dst: 1,
                    src: 2,
                    off: 0,
                    size: 8,
                },
                Insn::Mov { dst: 3, src: 2 },
                Insn::Syscall {
                    name: "sol_log_64".into(),
                },
                Insn::Exit,
            ],
            vec![
                "point r1 at the serialized accounts",
                "load the counter from account 0",
                "increment in a register",
                "write it back into the input copy",
                "keep the value for the log",
                "cross into the syscall registry",
                "return to the loader",
            ],
        ),
        "stack-frame" => Program::new(
            "stack-frame",
            "Place a value on the stack, call a function, and watch r10 move.",
            vec![
                Insn::Lddw {
                    dst: 1,
                    imm: 7,
                },
                Insn::Stx {
                    dst: 10,
                    src: 1,
                    off: -8,
                    size: 8,
                },
                Insn::Call { target: 5 },
                Insn::Ldx {
                    dst: 2,
                    src: 10,
                    off: -8,
                    size: 8,
                },
                Insn::Exit,
                Insn::Mov { dst: 3, src: 1 },
                Insn::Exit,
            ],
            vec![
                "r1 = 7",
                "store it in the current 4 KiB frame",
                "push a frame and jump to #5",
                "reload it after the call returns",
                "done",
                "the callee gets a fresh frame",
                "return to the caller",
            ],
        ),
        "out-of-bounds" => Program::new(
            "out-of-bounds",
            "Read past the end of the serialized input region.",
            vec![
                Insn::Lddw {
                    dst: 1,
                    imm: INPUT_BASE,
                },
                Insn::Ldx {
                    dst: 2,
                    src: 1,
                    off: 4000,
                    size: 8,
                },
                Insn::Exit,
            ],
            vec![
                "point at the input region",
                "read 8 bytes at offset 4000, past the accounts",
                "unreachable",
            ],
        ),
        "heap-overflow" => Program::new(
            "heap-overflow",
            "Write one byte past the heap the program requested.",
            vec![
                Insn::Lddw {
                    dst: 1,
                    imm: HEAP_BASE,
                },
                Insn::StImm {
                    dst: 1,
                    off: 0,
                    size: 8,
                    imm: 1,
                },
                Insn::Lddw {
                    dst: 1,
                    imm: HEAP_BASE + 32 * 1024,
                },
                Insn::StImm {
                    dst: 1,
                    off: 0,
                    size: 8,
                    imm: 2,
                },
                Insn::Exit,
            ],
            vec![
                "point at the heap base",
                "first 8 bytes are inside the 32 KiB heap",
                "point one byte past the end",
                "the VM rejects the write",
                "unreachable",
            ],
        ),
        "recursion" => Program::new(
            "recursion",
            "Call yourself forever. The verifier forbids this; the frame limit catches it.",
            vec![Insn::Call { target: 0 }, Insn::Exit],
            vec!["call #0 again", "unreachable"],
        ),
        "readonly-write" => Program::new(
            "readonly-write",
            "Write to an account the transaction only declared as a reader.",
            vec![
                Insn::Lddw {
                    dst: 1,
                    imm: INPUT_BASE + 8,
                },
                Insn::StImm {
                    dst: 1,
                    off: 0,
                    size: 8,
                    imm: 7,
                },
                Insn::Exit,
            ],
            vec![
                "point at the second account",
                "write to a read-only account",
                "unreachable",
            ],
        ),
        "rodata-write" => Program::new(
            "rodata-write",
            "Write into the read-only data segment.",
            vec![
                Insn::Lddw {
                    dst: 1,
                    imm: 0x1_0000_0000,
                },
                Insn::StImm {
                    dst: 1,
                    off: 0,
                    size: 8,
                    imm: 1,
                },
                Insn::Exit,
            ],
            vec!["rodata starts at 0x1_0000_0000", "the region is not writable", "unreachable"],
        ),
        "bad-syscall" => Program::new(
            "bad-syscall",
            "Call a syscall that is not in the registry.",
            vec![
                Insn::Syscall {
                    name: "sol_rand".into(),
                },
                Insn::Exit,
            ],
            vec!["no such syscall", "unreachable"],
        ),
        "cu-exhausted" => Program::new(
            "cu-exhausted",
            "Loop forever. The meter, not the clock, ends the transaction.",
            vec![Insn::Jmp { off: -1 }, Insn::Exit],
            vec!["jump to itself", "unreachable"],
        ),
        _ => return None,
    };
    Some(program)
}

/// Apply a fault for the Chapter 2 verification checklist.
pub fn with_fault(name: &str, fault: &str) -> Option<Program> {
    let mut program = builtin(name)?;
    if fault == "empty" {
        program.insns.clear();
        program.labels.clear();
        return Some(program);
    }
    let insn = match fault {
        "opcode" => Insn::Invalid { opcode: 0xff },
        "register" => Insn::Mov { dst: 12, src: 0 },
        "r10" => Insn::Mov { dst: 10, src: 0 },
        "jump" => Insn::Call { target: 999 },
        "syscall" => Insn::Syscall {
            name: "sol_rand".into(),
        },
        _ => return None,
    };
    // Inject before the final Exit, not after it, so the fault is reachable at runtime
    // as well as visible to the static verifier.
    let at = program.insns.len().saturating_sub(1);
    program.insns.insert(at, insn);
    program
        .labels
        .insert(at, format!("fault: {fault}"));
    Some(program)
}

pub fn text_placeholder() -> Vec<u8> {
    // A synthetic "ELF" marker. The lab never pretends to execute real bytecode.
    let mut bytes = b"\x7fELF".to_vec();
    bytes.extend_from_slice(b"sVM-lab");
    bytes
}

pub fn rodata_placeholder() -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&7u64.to_le_bytes());
    bytes.extend_from_slice(b"counter");
    bytes
}

pub fn stack_top(stack_bytes: usize) -> u64 {
    // r10 points one past the top of the current frame, so locals live at [r10-8].
    STACK_BASE + stack_bytes as u64
}

pub fn text_base() -> u64 {
    TEXT_BASE
}
