//! Registers, the program counter, and the call depth.

use serde::{Deserialize, Serialize};

pub const NREGS: usize = 11;
pub const R10: usize = 10;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Regs {
    pub r: [u64; NREGS],
    pub pc: usize,
    pub depth: u32,
}

impl Regs {
    pub fn new(input_base: u64, stack_top: u64) -> Self {
        let mut r = [0u64; NREGS];
        r[1] = input_base;
        r[10] = stack_top;
        Regs { r, pc: 0, depth: 0 }
    }
}

pub fn role(index: usize) -> &'static str {
    match index {
        0 => "return value",
        1 => "argument 0 / input base",
        2..=5 => "arguments / scratch",
        6..=9 => "callee-saved",
        10 => "frame pointer",
        _ => "?",
    }
}
