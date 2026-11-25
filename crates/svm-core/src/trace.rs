//! The trace is the contract. The UI never inspects VM internals, it reads these events.

use serde::Serialize;

use crate::scenario::AccountSlot;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StepKind {
    Instruction,
    Call,
    Syscall,
    Exit,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AccessKind {
    Read,
    Write,
}

#[derive(Clone, Debug, Serialize)]
pub struct AccessView {
    pub region: &'static str,
    pub offset: u64,
    pub len: u64,
    pub kind: AccessKind,
    /// Set when the access lands inside one serialized account.
    pub account: Option<usize>,
    /// Hex before and after, for writes only, capped at 16 bytes.
    pub before: Option<String>,
    pub after: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SyscallView {
    pub name: String,
    pub cost: u64,
    pub note: String,
    pub log: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Step {
    pub n: u32,
    pub insn: u32,
    pub label: String,
    pub mnemonic: String,
    pub text: String,
    pub pc: u32,
    pub cu: u64,
    pub cost: u64,
    pub regs: [u64; 11],
    pub r10: u64,
    pub frame: u32,
    pub accesses: Vec<AccessView>,
    pub syscall: Option<SyscallView>,
    pub kind: StepKind,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct Check {
    pub id: &'static str,
    pub label: &'static str,
    pub detail: &'static str,
    pub ok: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct AccountSnapshot {
    pub index: usize,
    pub name: String,
    pub owner: String,
    pub lamports: u64,
    pub writable: bool,
    pub executable: bool,
    pub offset: u64,
    pub len: u64,
    pub data_hex: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct RegionView {
    pub region: &'static str,
    pub base: u64,
    pub host_base: u64,
    pub size: u64,
    pub used: u64,
    pub writable: bool,
    pub description: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct RunResult {
    pub ok: bool,
    pub code: String,
    pub message: String,
    pub committed: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct Run {
    pub program: String,
    pub summary: String,
    pub steps: Vec<Step>,
    /// How many steps actually ran. `steps` is capped so a 200,000 CU loop does not
    /// ship a 200,000 element trace to the browser.
    pub steps_total: u32,
    pub result: RunResult,
    pub cu_used: u64,
    pub cu_limit: u64,
    pub accounts_before: Vec<AccountSnapshot>,
    pub accounts_after: Vec<AccountSnapshot>,
    pub slots: Vec<AccountSlot>,
    pub regions: Vec<RegionView>,
    pub logs: Vec<String>,
    pub verify: Vec<Check>,
    pub mapping: String,
}
