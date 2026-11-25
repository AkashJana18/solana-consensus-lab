//! The execution loop: registers, memory, frames, syscalls, CU, and the commit rule.

use crate::isa::{syscall, Insn};
use crate::limits::{DEFAULT_STACK_BYTES, FRAME_BYTES, INPUT_BASE, REGION_SLICE, STACK_BASE};
use crate::memory::{
    host_address, read_le, region_of, write_le, MappingMode, MemError, Memory, Region,
};
use crate::programs::{self, Program};
use crate::regs::{Regs, NREGS};
use crate::scenario::{hex_encode, AccountSlot, Scenario};
use crate::trace::{
    AccessKind, AccessView, AccountSnapshot, RegionView, Run, RunResult, Step, StepKind,
    SyscallView,
};
use crate::verify;

const MAX_STEPS: usize = 500_000;
const MAX_TRACE_STEPS: usize = 2_000;

#[derive(Debug, thiserror::Error)]
enum VmError {
    #[error("{0}")]
    Mem(#[from] MemError),
    #[error("call depth limit reached at {0} frames")]
    Depth(u32),
    #[error("unknown syscall '{0}'")]
    Syscall(String),
    #[error("invalid opcode {0:#04x}")]
    Invalid(u8),
    #[error("r{0} does not exist")]
    Register(u8),
    #[error("call target #{0} is outside the program")]
    CallTarget(u32),
    #[error("jump target {0} is outside the program")]
    Jump(i64),
    #[error("r10 is the frame pointer and cannot be written")]
    R10,
}

impl VmError {
    fn code(&self) -> &'static str {
        match self {
            VmError::Mem(e) => match e {
                MemError::OutOfBounds { .. } => "out-of-bounds",
                MemError::Forbidden { .. } => "read-only-region",
                MemError::Misaligned { .. } => "misaligned",
                MemError::Unmapped { .. } => "unmapped",
                MemError::ReadOnlyAccount { .. } => "read-only-account",
                MemError::CrossesAccount { .. } => "account-boundary",
            },
            VmError::Depth(_) => "stack-overflow",
            VmError::Syscall(_) => "bad-syscall",
            VmError::Invalid(_) => "invalid-opcode",
            VmError::Register(_) => "bad-register",
            VmError::CallTarget(_) => "bad-call",
            VmError::Jump(_) => "bad-jump",
            VmError::R10 => "r10-write",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Flow {
    Continue,
    Halt,
}

fn account_at(slots: &[AccountSlot], offset: u64, len: u64) -> Option<usize> {
    slots
        .iter()
        .find(|slot| {
            offset >= slot.offset && offset.saturating_add(len) <= slot.offset + slot.len
        })
        .map(|slot| slot.index)
}

fn writable_account_at(
    slots: &[AccountSlot],
    offset: u64,
    len: u64,
) -> Result<usize, MemError> {
    for slot in slots {
        if offset >= slot.offset && offset.saturating_add(len) <= slot.offset + slot.len {
            if slot.writable {
                return Ok(slot.index);
            }
            return Err(MemError::ReadOnlyAccount {
                offset,
                end: offset.saturating_add(len),
            });
        }
    }
    Err(MemError::CrossesAccount {
        offset,
    })
}

fn capped_hex(bytes: &[u8]) -> String {
    hex_encode(&bytes[..bytes.len().min(16)])
}

#[allow(clippy::too_many_arguments)]
fn execute(
    insn: &Insn,
    regs: &mut Regs,
    mem: &mut Memory,
    slots: &[AccountSlot],
    call_stack: &mut Vec<(usize, u64)>,
    scenario: &Scenario,
    program_len: usize,
    logs: &mut Vec<String>,
    accesses: &mut Vec<AccessView>,
    syscall_view: &mut Option<SyscallView>,
) -> Result<(StepKind, Option<String>, Flow), VmError> {
    if let Some(bad) = insn
        .registers()
        .into_iter()
        .find(|index| *index as usize >= NREGS)
    {
        return Err(VmError::Register(bad));
    }
    match insn {
        Insn::Lddw { dst, imm } => {
            if *dst == 10 {
                return Err(VmError::R10);
            }
            regs.r[*dst as usize] = *imm;
            regs.pc += 1;
            Ok((StepKind::Instruction, None, Flow::Continue))
        }
        Insn::Mov { dst, src } => {
            if *dst == 10 {
                return Err(VmError::R10);
            }
            regs.r[*dst as usize] = regs.r[*src as usize];
            regs.pc += 1;
            Ok((StepKind::Instruction, None, Flow::Continue))
        }
        Insn::AddImm { dst, imm } => {
            if *dst == 10 {
                return Err(VmError::R10);
            }
            regs.r[*dst as usize] = regs.r[*dst as usize].wrapping_add(*imm as u64);
            regs.pc += 1;
            Ok((StepKind::Instruction, None, Flow::Continue))
        }
        Insn::AddReg { dst, src } => {
            if *dst == 10 {
                return Err(VmError::R10);
            }
            regs.r[*dst as usize] = regs.r[*dst as usize].wrapping_add(regs.r[*src as usize]);
            regs.pc += 1;
            Ok((StepKind::Instruction, None, Flow::Continue))
        }
        Insn::SubImm { dst, imm } => {
            if *dst == 10 {
                return Err(VmError::R10);
            }
            regs.r[*dst as usize] = regs.r[*dst as usize].wrapping_sub(*imm as u64);
            regs.pc += 1;
            Ok((StepKind::Instruction, None, Flow::Continue))
        }
        Insn::Ldx {
            dst,
            src,
            off,
            size,
        } => {
            if *dst == 10 {
                return Err(VmError::R10);
            }
            let addr = regs.r[*src as usize].wrapping_add(*off as i64 as u64);
            let (region, offset) =
                region_of(addr).ok_or(MemError::Unmapped { addr })?;
            let bytes = mem.read(region, offset, *size as u64)?;
            regs.r[*dst as usize] = read_le(bytes);
            let account = if region == Region::Input {
                account_at(slots, offset, *size as u64)
            } else {
                None
            };
            accesses.push(AccessView {
                region: region.name(),
                offset,
                len: *size as u64,
                kind: AccessKind::Read,
                account,
                before: None,
                after: None,
            });
            regs.pc += 1;
            Ok((StepKind::Instruction, None, Flow::Continue))
        }
        Insn::Stx {
            dst,
            src,
            off,
            size,
        } => {
            let addr = regs.r[*dst as usize].wrapping_add(*off as i64 as u64);
            let (region, offset) =
                region_of(addr).ok_or(MemError::Unmapped { addr })?;
            let data = write_le(regs.r[*src as usize], *size);
            let account = if region == Region::Input {
                Some(writable_account_at(slots, offset, *size as u64)?)
            } else {
                None
            };
            let before = mem
                .read(region, offset, *size as u64)
                .map(capped_hex)
                .unwrap_or_default();
            mem.write(region, offset, &data)?;
            accesses.push(AccessView {
                region: region.name(),
                offset,
                len: *size as u64,
                kind: AccessKind::Write,
                account,
                before: Some(before),
                after: Some(capped_hex(&data)),
            });
            regs.pc += 1;
            Ok((StepKind::Instruction, None, Flow::Continue))
        }
        Insn::StImm {
            dst,
            off,
            size,
            imm,
        } => {
            let addr = regs.r[*dst as usize].wrapping_add(*off as i64 as u64);
            let (region, offset) =
                region_of(addr).ok_or(MemError::Unmapped { addr })?;
            let data = write_le(*imm, *size);
            let account = if region == Region::Input {
                Some(writable_account_at(slots, offset, *size as u64)?)
            } else {
                None
            };
            let before = mem
                .read(region, offset, *size as u64)
                .map(capped_hex)
                .unwrap_or_default();
            mem.write(region, offset, &data)?;
            accesses.push(AccessView {
                region: region.name(),
                offset,
                len: *size as u64,
                kind: AccessKind::Write,
                account,
                before: Some(before),
                after: Some(capped_hex(&data)),
            });
            regs.pc += 1;
            Ok((StepKind::Instruction, None, Flow::Continue))
        }
        Insn::Jmp { off } => {
            let target = jump_target(regs.pc, *off);
            if target >= program_len {
                return Err(VmError::Jump(target as i64));
            }
            regs.pc = target;
            Ok((StepKind::Instruction, None, Flow::Continue))
        }
        Insn::JeqImm { dst, imm, off } => {
            if regs.r[*dst as usize] == *imm {
                let target = jump_target(regs.pc, *off);
                if target >= program_len {
                    return Err(VmError::Jump(target as i64));
                }
                regs.pc = target;
            } else {
                regs.pc += 1;
            }
            Ok((StepKind::Instruction, None, Flow::Continue))
        }
        Insn::JneImm { dst, imm, off } => {
            if regs.r[*dst as usize] != *imm {
                let target = jump_target(regs.pc, *off);
                if target >= program_len {
                    return Err(VmError::Jump(target as i64));
                }
                regs.pc = target;
            } else {
                regs.pc += 1;
            }
            Ok((StepKind::Instruction, None, Flow::Continue))
        }
        Insn::Call { target } => {
            if regs.depth >= scenario.call_depth || regs.r[10] < STACK_BASE + FRAME_BYTES as u64 {
                return Err(VmError::Depth(regs.depth));
            }
            if *target as usize >= program_len {
                return Err(VmError::CallTarget(*target));
            }
            call_stack.push((regs.pc + 1, regs.r[10]));
            regs.r[10] = regs.r[10].saturating_sub(FRAME_BYTES as u64);
            regs.depth += 1;
            regs.pc = *target as usize;
            Ok((
                StepKind::Call,
                Some(format!("new 4 KiB frame, r10 = {:#x}", regs.r[10])),
                Flow::Continue,
            ))
        }
        Insn::Syscall { name } => {
            let def = syscall(name).ok_or_else(|| VmError::Syscall(name.clone()))?;
            let log = match name.as_str() {
                "sol_log_64" => format!(
                    "sol_log_64({}, {}, {}, {}, {})",
                    regs.r[1], regs.r[2], regs.r[3], regs.r[4], regs.r[5]
                ),
                "sol_log" => format!("sol_log(ptr = {:#x})", regs.r[1]),
                "sol_memcpy" => format!(
                    "sol_memcpy(dst = {:#x}, src = {:#x}, len = {})",
                    regs.r[1], regs.r[2], regs.r[3]
                ),
                "sol_invoke_signed_c" => "CPI: the runtime crosses back into the host".into(),
                other => format!("{other}()"),
            };
            logs.push(log.clone());
            *syscall_view = Some(SyscallView {
                name: def.name.into(),
                cost: def.cost,
                note: def.note.into(),
                log: Some(log),
            });
            regs.r[0] = 0;
            regs.pc += 1;
            Ok((StepKind::Syscall, None, Flow::Continue))
        }
        Insn::Exit => {
            if let Some((ret_pc, r10)) = call_stack.pop() {
                regs.pc = ret_pc;
                regs.r[10] = r10;
                regs.depth = regs.depth.saturating_sub(1);
                Ok((
                    StepKind::Exit,
                    Some("return to the caller, frame popped".into()),
                    Flow::Continue,
                ))
            } else {
                Ok((StepKind::Exit, Some("return to the loader".into()), Flow::Halt))
            }
        }
        Insn::Invalid { opcode } => Err(VmError::Invalid(*opcode)),
    }
}

fn jump_target(pc: usize, off: i16) -> usize {
    let target = pc as i64 + 1 + off as i64;
    if target < 0 {
        0
    } else {
        target as usize
    }
}

fn snapshots(slots: &[AccountSlot], input: &[u8]) -> Vec<AccountSnapshot> {
    slots
        .iter()
        .map(|slot| {
            let start = (slot.offset as usize).min(input.len());
            let end = (start + slot.len as usize).min(input.len());
            AccountSnapshot {
                index: slot.index,
                name: slot.name.clone(),
                owner: slot.owner.clone(),
                lamports: slot.lamports,
                writable: slot.writable,
                executable: slot.executable,
                offset: slot.offset,
                len: slot.len,
                data_hex: hex_encode(&input[start..end]),
            }
        })
        .collect()
}

fn regions(mem: &Memory) -> Vec<RegionView> {
    Region::ALL
        .iter()
        .map(|region| RegionView {
            region: region.name(),
            base: region.base(),
            host_base: region.host_base(),
            size: REGION_SLICE,
            used: mem.bytes(*region).len() as u64,
            writable: region.writable(),
            description: region.description(),
        })
        .collect()
}

pub fn run(program: &Program, scenario: &Scenario) -> Run {
    let (slots, input) = scenario.serialize_accounts();
    let accounts_before = snapshots(&slots, &input);
    let stack_bytes = if scenario.stack_bytes == 0 {
        DEFAULT_STACK_BYTES
    } else {
        scenario.stack_bytes
    };
    let mut mem = Memory::new(
        programs::text_placeholder(),
        programs::rodata_placeholder(),
        stack_bytes,
        scenario.heap_bytes,
        input,
    );
    let mut regs = Regs::new(INPUT_BASE, programs::stack_top(stack_bytes));
    let mut steps: Vec<Step> = Vec::new();
    let mut logs: Vec<String> = Vec::new();
    let mut call_stack: Vec<(usize, u64)> = Vec::new();
    let mut cu = 0u64;
    let mut failure: Option<(String, String)> = None;
    let mut guard = 0usize;
    let mut n = 0u32;

    while regs.pc < program.insns.len() {
        guard += 1;
        if guard > MAX_STEPS {
            failure = Some((
                "step-limit".into(),
                format!("the VM stopped after {MAX_STEPS} steps"),
            ));
            break;
        }

        let insn = program.insns[regs.pc].clone();
        let label = program.label(regs.pc).to_string();
        let cost = insn.cost();
        let pc = regs.pc;

        if cu + cost > scenario.cu_limit {
            let note = format!(
                "the next instruction costs {cost} CU, but only {} CU remain",
                scenario.cu_limit.saturating_sub(cu)
            );
            steps.push(Step {
                n,
                insn: pc as u32,
                label,
                mnemonic: insn.mnemonic().into(),
                text: insn.text(),
                pc: pc as u32,
                cu,
                cost,
                regs: regs.r,
                r10: regs.r[10],
                frame: regs.depth,
                accesses: vec![],
                syscall: None,
                kind: StepKind::Error,
                note: Some(note),
            });
            n += 1;
            failure = Some((
                "budget-exceeded".into(),
                format!("compute budget of {} CU exhausted", scenario.cu_limit),
            ));
            break;
        }

        cu += cost;
        let mut accesses = Vec::new();
        let mut syscall_view = None;

        match execute(
            &insn,
            &mut regs,
            &mut mem,
            &slots,
            &mut call_stack,
            scenario,
            program.insns.len(),
            &mut logs,
            &mut accesses,
            &mut syscall_view,
        ) {
            Ok((kind, note, flow)) => {
                if steps.len() < MAX_TRACE_STEPS {
                    steps.push(Step {
                        n,
                        insn: pc as u32,
                        label,
                        mnemonic: insn.mnemonic().into(),
                        text: insn.text(),
                        pc: pc as u32,
                        cu,
                        cost,
                        regs: regs.r,
                        r10: regs.r[10],
                        frame: regs.depth,
                        accesses,
                        syscall: syscall_view,
                        kind,
                        note,
                    });
                }
                n += 1;
                if flow == Flow::Halt {
                    break;
                }
            }
            Err(error) => {
                n += 1;
                steps.push(Step {
                    n,
                    insn: pc as u32,
                    label,
                    mnemonic: insn.mnemonic().into(),
                    text: insn.text(),
                    pc: pc as u32,
                    cu,
                    cost,
                    regs: regs.r,
                    r10: regs.r[10],
                    frame: regs.depth,
                    accesses,
                    syscall: syscall_view,
                    kind: StepKind::Error,
                    note: Some(error.to_string()),
                });
                failure = Some((error.code().into(), error.to_string()));
                break;
            }
        }
    }

    let ok = failure.is_none();
    let accounts_after = if ok {
        snapshots(&slots, mem.input())
    } else {
        accounts_before.clone()
    };

    let changed = accounts_before
        .iter()
        .zip(accounts_after.iter())
        .filter(|(a, b)| a.data_hex != b.data_hex)
        .count();

    let (code, message) = match failure {
        Some((code, message)) => (code, message),
        None => (
            "ok".into(),
            if changed > 0 {
                format!("committed {changed} account update(s) to the Bank")
            } else {
                "finished with no account changes".into()
            },
        ),
    };

    let summary = if ok {
        format!("{} finished in {} steps and {} CU", program.name, n, cu)
    } else {
        format!("{} failed after {} steps", program.name, n)
    };

    Run {
        program: program.name.clone(),
        summary,
        steps,
        steps_total: n,
        result: RunResult {
            ok,
            code,
            message,
            committed: ok,
        },
        cu_used: cu,
        cu_limit: scenario.cu_limit,
        accounts_before,
        accounts_after,
        slots,
        regions: regions(&mem),
        logs,
        verify: verify::verify(program, scenario),
        mapping: scenario.mapping.label().into(),
    }
}

/// Static layout for Chapter 1. Host addresses are illustrative but stable.
pub fn layout(mode: MappingMode) -> Vec<RegionView> {
    Region::ALL
        .iter()
        .map(|region| {
            let used = match region {
                Region::Text => programs::text_placeholder().len() as u64,
                Region::Rodata => programs::rodata_placeholder().len() as u64,
                Region::Stack => DEFAULT_STACK_BYTES as u64,
                Region::Heap => crate::limits::DEFAULT_HEAP_BYTES as u64,
                Region::Input => 16,
            };
            RegionView {
                region: region.name(),
                base: region.base(),
                host_base: host_address(*region, 0, mode, 8).unwrap_or_else(|_| region.host_base()),
                size: REGION_SLICE,
                used,
                writable: region.writable(),
                description: region.description(),
            }
        })
        .collect()
}
