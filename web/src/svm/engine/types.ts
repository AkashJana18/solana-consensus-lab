// Mirrors crates/svm-core/src/trace.rs and scenario.rs. The wasm bridge is the only
// producer; the UI is a pure reader.

export type RegionName = 'text' | 'rodata' | 'stack' | 'heap' | 'input';
export type MappingMode = 'identity' | 'aligned' | 'unaligned';
export type StepKind = 'instruction' | 'call' | 'syscall' | 'exit' | 'error';
export type AccessKind = 'read' | 'write';
export type Provenance = 'source' | 'docs' | 'lecture';

export interface RegionView {
  region: RegionName;
  base: number;
  host_base: number;
  size: number;
  used: number;
  writable: boolean;
  description: string;
}

export interface Constant {
  name: string;
  value: string;
  provenance: Provenance;
  note: string;
}

export interface Layout {
  regions: RegionView[];
  constants: Constant[];
  modes: string[];
}

export interface ProgramInsn {
  index: number;
  mnemonic: string;
  text: string;
  label: string;
  cost: number;
}

export interface ProgramView {
  name: string;
  summary: string;
  insns: ProgramInsn[];
}

export interface AccessView {
  region: RegionName;
  offset: number;
  len: number;
  kind: AccessKind;
  account: number | null;
  before: string | null;
  after: string | null;
}

export interface SyscallView {
  name: string;
  cost: number;
  note: string;
  log: string | null;
}

export interface Step {
  n: number;
  insn: number;
  label: string;
  mnemonic: string;
  text: string;
  pc: number;
  cu: number;
  cost: number;
  regs: number[];
  r10: number;
  frame: number;
  accesses: AccessView[];
  syscall: SyscallView | null;
  kind: StepKind;
  note: string | null;
}

export interface Check {
  id: string;
  label: string;
  detail: string;
  ok: boolean;
}

export interface AccountSnapshot {
  index: number;
  name: string;
  owner: string;
  lamports: number;
  writable: boolean;
  executable: boolean;
  offset: number;
  len: number;
  data_hex: string;
}

export interface Slot {
  index: number;
  name: string;
  offset: number;
  len: number;
  writable: boolean;
  owner: string;
  lamports: number;
  executable: boolean;
}

export interface RunResult {
  ok: boolean;
  code: string;
  message: string;
  committed: boolean;
}

export interface Run {
  program: string;
  summary: string;
  steps: Step[];
  steps_total: number;
  result: RunResult;
  cu_used: number;
  cu_limit: number;
  accounts_before: AccountSnapshot[];
  accounts_after: AccountSnapshot[];
  slots: Slot[];
  regions: RegionView[];
  logs: string[];
  verify: Check[];
  mapping: string;
}

export interface AccountSpec {
  name: string;
  data_hex: string;
  writable: boolean;
  owner: string;
  lamports: number;
  executable: boolean;
}

export interface Scenario {
  program: string;
  accounts?: AccountSpec[];
  cu_limit?: number;
  heap_bytes?: number;
  stack_bytes?: number;
  call_depth?: number;
  elf_bytes?: number;
  mapping?: MappingMode;
  fault?: string | null;
}
