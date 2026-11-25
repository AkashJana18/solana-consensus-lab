// Lecture-derived copy. The source is the Lecture 5 notes, so the lab and the cohort
// use the same words for the same things.

/** The model card, public on GitHub. The Notion notes are private to the cohort. */
export const MODEL_DOC_URL =
  'https://github.com/AkashJana18/solana-consensus-lab/blob/main/docs/svm-lab.md';

export const CHAPTERS = [
  {
    id: 'memory',
    number: '01',
    kicker: 'Validators and memory',
    title: 'Where the blockchain lives',
    blurb: 'A Bank, an AccountsDB, and a sandbox that is a view over the validator own heap.',
  },
  {
    id: 'build',
    number: '02',
    kicker: 'Compilation and deployment',
    title: 'From Rust to a program account',
    blurb: 'The fork exists to hit a target the runtime can verify and meter, then the loader stores it in chunks.',
  },
  {
    id: 'execute',
    number: '03',
    kicker: 'Program execution',
    title: 'Inside the sandbox',
    blurb: 'Registers, five regions, a syscall gate, and a meter that ends the transaction.',
  },
] as const;

export type ChapterId = (typeof CHAPTERS)[number]['id'];

export interface PipelineStage {
  id: string;
  title: string;
  kicker: string;
  code: string;
  note: string;
  changed: string;
}

export const PIPELINE: PipelineStage[] = [
  {
    id: 'source',
    title: 'Rust source',
    kicker: 'same language, different target',
    code: `#[entrypoint]
pub fn process(ctx: Context) -> ProgramResult {
    let counter = &ctx.accounts.counter;
    let value = counter.value + 1;
    counter.write(value)?;
    msg!("count = {}", value);
    Ok(())
}`,
    note: 'The program is a library with an entrypoint, not a binary with main. No std, no allocator assumptions, no host calls.',
    changed: 'nothing yet: this is ordinary Rust',
  },
  {
    id: 'mir',
    title: 'MIR',
    kicker: 'borrow checks already done',
    code: `_2 = Account::value(_1)
_3 = _2 + const 1u64
_4 = Account::write(_1, _3)
_5 = msg(_3)`,
    note: 'The Solana fork does not change the borrow checker. Ownership and aliasing are resolved here, before any bytecode exists.',
    changed: 'the target is already sbf-solana-solana',
  },
  {
    id: 'llvm',
    title: 'LLVM IR',
    kicker: 'the custom backend',
    code: `define i64 @entrypoint(ptr %input) {
entry:
  %value = load i64, ptr %input, align 8
  %next = add i64 %value, 1
  store i64 %next, ptr %input, align 8
  call void @sol_log_64(i64 %next, ...)
  ret i64 0
}`,
    note: 'The Solana LLVM fork adds an sBPF target. This is the layer that knows the instruction set and the register file.',
    changed: 'lowering to sBPF instead of x86 or ARM',
  },
  {
    id: 'sbpf',
    title: 'sBPF',
    kicker: 'a verifiable instruction set',
    code: `lddw r1, 0x400000000
ldx  r2, [r1+0]
add  r2, 1
stx  [r1+0], r2
call sol_log_64
exit`,
    note: 'Eleven registers, no I/O, no threads, no clocks. Every instruction is meterable, and the verifier can check the whole program before it runs.',
    changed: 'the sandbox boundary starts here',
  },
  {
    id: 'elf',
    title: 'ELF',
    kicker: 'position independent, chunked on chain',
    code: `.text     sBPF instructions
.rodata   constants
.symtab   function starts
.dynamic  entrypoint

size:     24,832 bytes
deploy:   create, set length, write x N, deploy`,
    note: 'A position-independent shared object. The loader verifies it once, caches the executable, and every later invocation reuses it.',
    changed: 'stored in an executable account, owned by the BPF loader',
  },
];

export interface Forbidden {
  id: string;
  title: string;
  body: string;
  mechanism: string;
}

export const FORBIDDEN: Forbidden[] = [
  {
    id: 'io',
    title: 'Files, sockets, processes',
    body: 'A program cannot read the host filesystem or open a socket.',
    mechanism: 'Every validator must replay the same bytes. Host I/O would make execution depend on the machine.',
  },
  {
    id: 'threads',
    title: 'Threads',
    body: 'No thread creation or shared-memory parallelism inside a program.',
    mechanism: 'The VM is single-threaded by design. Parallelism lives at the account level, outside the program.',
  },
  {
    id: 'random',
    title: 'Randomness and clocks',
    body: 'No entropy source, no wall clock, no environment variables.',
    mechanism: 'Consensus requires identical results. A clock read would make two validators disagree.',
  },
  {
    id: 'statics',
    title: 'Mutable statics',
    body: 'Shared globals must be read-only.',
    mechanism: 'Programs are stateless. State belongs in accounts, where the runtime can lock and commit it.',
  },
  {
    id: 'recursion',
    title: 'Recursive functions',
    body: 'The verifier rejects cycles in the call graph.',
    mechanism: 'A bounded call stack is cheaper to verify. The 64-frame limit is the runtime backstop.',
  },
  {
    id: 'float',
    title: 'Native floating point',
    body: 'Only a subset is available, and it is software-emulated.',
    mechanism: 'FP rounding differs across CPUs. Emulation makes the result identical everywhere.',
  },
];

/** Illustrative only. The panel labels it as an annotated translation, not a real JIT. */
export const X86: Record<string, string> = {
  lddw: 'movabs $imm, %rax',
  mov: 'mov %rsrc, %rdst',
  add: 'add $imm, %rax',
  sub: 'sub $imm, %rax',
  ldx: 'mov (%rbase,%off), %rax',
  stx: 'mov %rsrc, (%rbase,%off)',
  st: 'movq $imm, (%rbase,%off)',
  ja: 'jmp .Ltarget',
  jeq: 'cmp $imm, %rax; je .Ltarget',
  jne: 'cmp $imm, %rax; jne .Ltarget',
  call: 'call .Ltarget',
  syscall: 'call runtime_syscall',
  exit: 'ret',
  invalid: 'ud2',
};

export const PROVENANCE_LABEL = {
  source: 'Agave source',
  docs: 'Solana docs',
  lecture: 'Lecture note',
} as const;

export const MAPPING_NOTE: Record<string, string> = {
  identity: 'Test mode. The VM address is the host address, so translation is the identity function.',
  aligned: 'Current implementation. The host address must preserve the VM alignment, so a misaligned offset is refused.',
  unaligned: 'Future implementation. Flexible alignment, so the low bits can shift without failing.',
};

export const LOCK_TXS = [
  { id: 'A', label: 'swap A to B', reads: ['pool', 'mintA'], writes: ['pool', 'vaultA', 'vaultB'] },
  { id: 'B', label: 'swap B to A', reads: ['pool', 'mintB'], writes: ['pool', 'vaultB', 'vaultA'] },
  { id: 'C', label: 'read oracle', reads: ['oracle', 'config'], writes: [] },
  { id: 'D', label: 'update config', reads: ['config'], writes: ['config'] },
];
