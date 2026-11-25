# SVM Lab: memory and execution

The SVM Lab is a second, self-contained teaching app at `/svm/`. It follows one
counter program across the three layers Lecture 5 uses: where validator state
lives, how Rust becomes a deployable program, and what happens when the program
runs.

This document is the honest model card. It says what is simulated, what is a
parameter, and what is a diagram.

## Why a second core

`sim-core` simulates consensus. The SVM lab is about the runtime underneath a
single transaction, so it needs a different kernel: registers, memory regions,
compute metering, syscalls, and a commit rule. That kernel is `svm-core`, a
deterministic sBPF-shaped interpreter of roughly 1,000 lines. It is not the
Agave VM, and it does not claim to be.

The split is deliberate:

| Crate | Role |
| --- | --- |
| `crates/svm-core` | scenario, memory, instruction subset, verifier, trace |
| `crates/svm-wasm` | four `wasm-bindgen` exports: run, verify, layout, programs |
| `crates/svm-cli` | headless `run`, `verify`, `layout`, `programs` |
| `web/src/svm` | the three chapters, the trace player, the deploy console |

## The three chapters

### 01. Validators and memory

The left side is the validator process: the Bank, the AccountsDB, the SVM
loader, and `VmMemoryPool`. The right side is the address space a program sees:
five 4 GiB slices at `0x0`, `0x100000000`, `0x200000000`, `0x300000000` and
`0x400000000`.

The probe translates a VM offset into a host address under three mapping modes:

- **Identity**: the host address equals the VM address. Test mode.
- **Aligned**: the host address must preserve the VM alignment. An 8-byte access
  at offset 63 is refused.
- **Unaligned**: the future implementation, where the low bits may shift.

The lock puzzle is the runtime version of Rust's aliasing rule: a writer
conflicts with every other reader or writer of the same account, and two
readers do not conflict.

### 02. Compilation and deployment

The pipeline stepper shows Rust source, MIR, LLVM IR, sBPF, and ELF. Toggling to
stock Rust blocks the last two stages, because stock LLVM has no sBPF target.

The deploy console models the v4 loader sequence: create the program account,
set its length, write the ELF in chunks, deploy, finalize. The chunk size is a
slider. The CU figures are illustrative: the model charges a fixed amount per
chunk so the tradeoff between more transactions and larger writes is visible.

The verification panel runs the real `svm-core` verifier against the selected
fault. Ten checks run, and exactly one fails for each injected fault.

The forbidden-operations panel explains why the sandbox has no files, sockets,
threads, clocks, mutable statics, recursion, or native floating point.

### 03. Program execution

A trace player over the real interpreter. Each step records registers, `r10`,
frame depth, compute units, memory accesses, syscall crossings, and a note. The
player can play, pause, step, and seek to the end. Accounts are replayed from
the pre-run snapshot, so writes appear as the program makes them.

The engine panel contrasts the interpreter with an annotated x86 translation.
The x86 strings are a teaching aid, not a JIT: `svm-core` has no compiler.

## The execution model

### Registers

Eleven registers, `r0` through `r10`. `r10` is the frame pointer. It can be read
and used as a base, never written. A write is rejected at verification time and
again at runtime.

### Memory

Five regions, each a 4 GiB slice of the VM address space:

| Region | Base | Backing | Writable |
| --- | --- | --- | --- |
| text | `0x0` | the ELF `.text` segment | no |
| rodata | `0x100000000` | the ELF `.rodata` segment | no |
| stack | `0x200000000` | a `Vec<u8>` owned by the validator | yes |
| heap | `0x300000000` | a `Vec<u8>` owned by the validator | yes |
| input | `0x400000000` | the serialized accounts | yes, per account |

The stack is 64 frames of 4 KiB, and `r10` starts at the top and moves down by
one frame per call. The heap starts at 32 KiB and can be raised to 256 KiB.
The input region is a flat serialization: each account occupies
`offset..offset+len`, and a write that crosses an account boundary is rejected.

The host addresses in Chapter 1 are stable stand-ins. Real host addresses are
ASLR-dependent and differ on every run.

### Instruction subset

The interpreter implements the subset needed to tell the story, not the whole
ISA:

| Mnemonic | Meaning | CU |
| --- | --- | --- |
| `lddw` | load a 64-bit immediate | 1 |
| `mov` | register copy | 1 |
| `add` / `sub` | immediate or register arithmetic | 1 |
| `ldx` / `stx` / `st` | sized memory access, 1 to 8 bytes | 3 |
| `ja` / `jeq` / `jne` | relative control flow | 1 |
| `call` | local call, pushes a 4 KiB frame | 10 |
| `syscall` | registered host call | table below |
| `exit` | return to the caller, or halt | 1 |

CU accounting is one unit per simple instruction, three per memory access, ten
per call, and the syscall table's cost for a host call. Real sBPF costs are
computed per instruction class by the runtime and vary by feature set. The lab
uses round numbers so the meter is readable.

### Syscalls

| Name | CU | What it models |
| --- | --- | --- |
| `sol_log` | 100 | copy a log message across the boundary |
| `sol_log_64` | 100 | log five `u64` values |
| `sol_memcpy` | 10 | copy bytes between VM regions |
| `sol_invoke_signed_c` | 1,000 | CPI: a new frame and a new program context |

An unregistered syscall is rejected by the verifier and, if it somehow runs, by
the interpreter.

### Commit and rollback

A run succeeds only if every instruction completes inside the CU budget. On
success, the writable accounts are copied back to the Bank. On any fault, the
accounts are restored to their pre-run snapshot and the transaction leaves no
state behind. This is the rule the lecture describes, modeled at account
granularity.

## The verifier

`svm-core` runs ten independent checks:

1. the program is not empty
2. every opcode is in the subset
3. every register is `r0` to `r10`
4. `r10` is never written
5. every call target is inside the program
6. every jump target is inside the program
7. the local-call graph has no cycle
8. every syscall is registered
9. the configured call depth is at most 64
10. the configured ELF size is at most 10 MiB

The real loader has more checks (stack initialization, division by zero,
misaligned pointers, and so on). Those are out of scope for this subset and are
not claimed.

## Built-in programs

| Name | What it demonstrates |
| --- | --- |
| `counter` | read, add one, write, log, exit |
| `stack-frame` | a call, a new frame, a return |
| `out-of-bounds` | a read past the end of the input region |
| `heap-overflow` | a write one byte past the heap |
| `recursion` | a program the verifier rejects, run anyway to see the frame limit |
| `readonly-write` | a write to a read-only account |
| `rodata-write` | a write to the read-only `.rodata` region |
| `bad-syscall` | a syscall the registry does not know |
| `cu-exhausted` | an infinite loop that ends at the compute budget |

The trace is capped at 2,000 steps, with `steps_total` recording how many ran.
The `cu-exhausted` program runs until the 200,000 CU budget is gone, so the cap
keeps the wasm payload and the browser responsive.

## Provenance of every number

`crates/svm-core/src/limits.rs` carries the provenance for each constant, and
the UI renders it as a badge:

- **Agave source**: region size, frame size, call depth, default CU.
- **Solana docs**: maximum program size, default and maximum heap.
- **Lecture note**: the stack and heap are slices of the validator's own heap,
  and the virtual ceiling is five 4 GiB slices.

Where the lecture flags a limit as uncertain, the lab says so rather than
inventing precision.

## What is not modeled

- Real sBPF bytecode or a real ELF parser. The "program" is a Rust enum.
- The real loader's account creation, rent, and upgrade authority.
- CPI execution. `sol_invoke_signed_c` is a logged boundary, not a nested run.
- JIT compilation. The x86 panel is an annotated translation.
- Compute-unit costs from the real runtime. The numbers are round and stable.
- Account locking. The lock puzzle is a static conflict check over a fixed set
  of transactions, not a scheduler.
- Transaction fees, prioritization, and the wider runtime pipeline.

Every one of these is labelled in the UI where it appears, so a student can
tell the difference between the model and the chain.

## Running it

```bash
cargo test -p svm-core
cargo run -p svm-cli -- run counter
cargo run -p svm-cli -- verify counter --fault syscall
cargo run -p svm-cli -- programs

./scripts/build-wasm.sh   # builds sim-wasm and svm-wasm
cd web && bun run dev     # /svm/
```

The web app has three e2e tests in `web/e2e/svm.spec.ts` that boot the wasm,
walk the chapters, run a passing program, and run a failing one.
