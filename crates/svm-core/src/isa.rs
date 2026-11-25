//! A deliberately small sBPF-shaped instruction set.
//!
//! This is not the real verifier and not real bytecode. It is the subset needed to make
//! registers, memory regions, frames, syscalls and CU metering visible and honest.

use serde::{Deserialize, Serialize};

pub struct SyscallDef {
    pub name: &'static str,
    pub cost: u64,
    pub note: &'static str,
}

/// The syscall registry the verifier checks against. An unknown syscall never reaches
/// execution, which is exactly the check the lecture describes.
pub const SYSCALLS: &[SyscallDef] = &[
    SyscallDef {
        name: "sol_log",
        cost: 100,
        note: "Copy a log message across the isolation boundary.",
    },
    SyscallDef {
        name: "sol_log_64",
        cost: 100,
        note: "Log five u64 values. Used by the counter program.",
    },
    SyscallDef {
        name: "sol_memcpy",
        cost: 10,
        note: "Copy bytes between two VM regions.",
    },
    SyscallDef {
        name: "sol_invoke_signed_c",
        cost: 1_000,
        note: "Cross-program invocation: a new 4 KiB frame and a new program context.",
    },
];

pub fn syscall(name: &str) -> Option<&'static SyscallDef> {
    SYSCALLS.iter().find(|s| s.name == name)
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Insn {
    Lddw {
        dst: u8,
        imm: u64,
    },
    Mov {
        dst: u8,
        src: u8,
    },
    AddImm {
        dst: u8,
        imm: i64,
    },
    AddReg {
        dst: u8,
        src: u8,
    },
    SubImm {
        dst: u8,
        imm: i64,
    },
    Ldx {
        dst: u8,
        src: u8,
        off: i16,
        size: u8,
    },
    Stx {
        dst: u8,
        src: u8,
        off: i16,
        size: u8,
    },
    StImm {
        dst: u8,
        off: i16,
        size: u8,
        imm: u64,
    },
    Jmp {
        off: i16,
    },
    JeqImm {
        dst: u8,
        imm: u64,
        off: i16,
    },
    JneImm {
        dst: u8,
        imm: u64,
        off: i16,
    },
    Call {
        target: u32,
    },
    Syscall {
        name: String,
    },
    Exit,
    /// Only reachable through fault injection in the verification lesson.
    Invalid {
        opcode: u8,
    },
}

impl Insn {
    /// CU is modelled as one unit per instruction plus a table for memory and syscalls.
    pub fn cost(&self) -> u64 {
        match self {
            Insn::Ldx { .. } | Insn::Stx { .. } | Insn::StImm { .. } => 3,
            Insn::Call { .. } => 10,
            Insn::Syscall { name } => syscall(name).map(|s| s.cost).unwrap_or(1),
            _ => 1,
        }
    }

    pub fn writes_register(&self, index: u8) -> bool {
        match self {
            Insn::Lddw { dst, .. }
            | Insn::Mov { dst, .. }
            | Insn::AddImm { dst, .. }
            | Insn::AddReg { dst, .. }
            | Insn::SubImm { dst, .. }
            | Insn::Ldx { dst, .. } => *dst == index,
            _ => false,
        }
    }

    pub fn registers(&self) -> Vec<u8> {
        match self {
            Insn::Lddw { dst, .. }
            | Insn::AddImm { dst, .. }
            | Insn::SubImm { dst, .. }
            | Insn::JeqImm { dst, .. }
            | Insn::JneImm { dst, .. }
            | Insn::StImm { dst, .. } => vec![*dst],
            Insn::Mov { dst, src }
            | Insn::AddReg { dst, src }
            | Insn::Ldx { dst, src, .. }
            | Insn::Stx { dst, src, .. } => vec![*dst, *src],
            _ => vec![],
        }
    }

    pub fn mnemonic(&self) -> &'static str {
        match self {
            Insn::Lddw { .. } => "lddw",
            Insn::Mov { .. } => "mov",
            Insn::AddImm { .. } => "add",
            Insn::AddReg { .. } => "add",
            Insn::SubImm { .. } => "sub",
            Insn::Ldx { .. } => "ldx",
            Insn::Stx { .. } => "stx",
            Insn::StImm { .. } => "st",
            Insn::Jmp { .. } => "ja",
            Insn::JeqImm { .. } => "jeq",
            Insn::JneImm { .. } => "jne",
            Insn::Call { .. } => "call",
            Insn::Syscall { .. } => "syscall",
            Insn::Exit => "exit",
            Insn::Invalid { .. } => "invalid",
        }
    }

    /// A readable line for the instruction strip. Byte offsets stay decimal so they
    /// line up with the account panel.
    pub fn text(&self) -> String {
        match self {
            Insn::Lddw { dst, imm } => format!("r{dst} = {imm:#x}"),
            Insn::Mov { dst, src } => format!("r{dst} = r{src}"),
            Insn::AddImm { dst, imm } => format!("r{dst} += {imm}"),
            Insn::AddReg { dst, src } => format!("r{dst} += r{src}"),
            Insn::SubImm { dst, imm } => format!("r{dst} -= {imm}"),
            Insn::Ldx {
                dst,
                src,
                off,
                size,
            } => format!("r{dst} = u{size}[r{src}{off:+}]"),
            Insn::Stx {
                dst,
                src,
                off,
                size,
            } => format!("u{size}[r{dst}{off:+}] = r{src}"),
            Insn::StImm {
                dst,
                off,
                size,
                imm,
            } => format!("u{size}[r{dst}{off:+}] = {imm:#x}"),
            Insn::Jmp { off } => format!("ja {off:+}"),
            Insn::JeqImm { dst, imm, off } => format!("if r{dst} == {imm:#x} ja {off:+}"),
            Insn::JneImm { dst, imm, off } => format!("if r{dst} != {imm:#x} ja {off:+}"),
            Insn::Call { target } => format!("call #{target}"),
            Insn::Syscall { name } => format!("syscall {name}"),
            Insn::Exit => "exit".into(),
            Insn::Invalid { opcode } => format!("invalid {opcode:#04x}"),
        }
    }
}
