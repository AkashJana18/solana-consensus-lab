import { describe, expect, it } from 'vitest';
import {
  accountHexAt,
  bytesToHex,
  changedRegisters,
  conflicts,
  cuPercent,
  deployPlan,
  formatBytes,
  formatHexBytes,
  hexToBytes,
  hostAddress,
  laneConflicts,
  patchHex,
  regionByAddress,
  shortAddress,
} from '../src/svm/engine/model';
import type { Run, RegionView, Step } from '../src/svm/engine/types';

const stack: RegionView = {
  region: 'stack',
  base: 0x2_0000_0000,
  host_base: 0x58a0_1234_0000,
  size: 4 * 1024 * 1024 * 1024,
  used: 256 * 1024,
  writable: true,
  description: 'stack',
};

describe('hostAddress', () => {
  it('keeps the VM address in identity mode', () => {
    expect(hostAddress(stack, 16, 'identity')).toEqual({ ok: true, address: stack.base + 16 });
  });

  it('uses the host base in aligned mode and refuses a misaligned offset', () => {
    expect(hostAddress(stack, 64, 'aligned')).toEqual({ ok: true, address: stack.host_base + 64 });
    const refused = hostAddress(stack, 63, 'aligned');
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain('not 8-byte aligned');
  });

  it('lets unaligned mode through', () => {
    expect(hostAddress(stack, 63, 'unaligned')).toEqual({ ok: true, address: stack.host_base + 63 });
  });

  it('refuses an offset outside the slice', () => {
    const refused = hostAddress(stack, stack.size, 'identity');
    expect(refused.ok).toBe(false);
    expect(refused.reason).toContain('outside');
  });
});

describe('address helpers', () => {
  it('prints lowercase hex', () => {
    expect(shortAddress(0x4_0000_0000)).toBe('0x400000000');
  });

  it('finds the region that owns an address', () => {
    const regions: RegionView[] = [
      { ...stack, region: 'text', base: 0 },
      { ...stack, region: 'rodata', base: 0x1_0000_0000 },
      stack,
    ];
    expect(regionByAddress(regions, 0x2_0000_0010)?.region).toBe('stack');
    expect(regionByAddress(regions, 0x2_0000_0000 - 1)?.region).toBe('rodata');
    expect(regionByAddress(regions, 0x9_0000_0000)).toBeNull();
  });
});

describe('account conflicts', () => {
  const a = { id: 'A', label: 'swap A', reads: ['pool', 'mintA'], writes: ['pool', 'vaultA'] };
  const b = { id: 'B', label: 'swap B', reads: ['pool', 'mintB'], writes: ['pool', 'vaultB'] };
  const c = { id: 'C', label: 'read oracle', reads: ['oracle', 'config'], writes: [] };
  const d = { id: 'D', label: 'update config', reads: ['config'], writes: ['config'] };

  it('finds a write/write conflict', () => {
    expect(conflicts(a, b)).toEqual(['pool']);
  });

  it('finds a write/read conflict in either direction', () => {
    expect(conflicts(c, d)).toEqual(['config']);
    expect(conflicts(d, c)).toEqual(['config']);
  });

  it('lets two readers run together', () => {
    expect(conflicts(c, c)).toEqual([]);
  });

  it('reports every conflicting pair across two lanes', () => {
    const hits = laneConflicts([a, c], [b, d]);
    expect(hits.map((hit) => `${hit.a}${hit.b}`)).toEqual(['AB', 'CD']);
    expect(hits[0].accounts).toEqual(['pool']);
  });
});

describe('deployPlan', () => {
  it('splits the ELF into chunks and counts the transactions', () => {
    const plan = deployPlan(24_832, 1_024);
    expect(plan.chunks).toBe(25);
    expect(plan.txs).toBe(27);
    expect(plan.cuPerWrite).toBe(82);
    expect(plan.cuTotal).toBe(3_250);
  });

  it('charges more total CU for smaller chunks, because each write is a transaction', () => {
    const small = deployPlan(24_832, 256);
    const large = deployPlan(24_832, 4_096);
    expect(small.chunks).toBeGreaterThan(large.chunks);
    expect(small.cuTotal).toBeGreaterThan(large.cuTotal);
  });
});

describe('accountHexAt', () => {
  const before = '2900000000000000';
  const after = '2a00000000000000';

  const step = (n: number, accesses: Step['accesses']): Step => ({
    n,
    insn: n,
    label: '',
    mnemonic: 'stx',
    text: '',
    pc: n,
    cu: n,
    cost: 3,
    regs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    r10: 0x2_0000_0000,
    frame: 0,
    accesses,
    syscall: null,
    kind: 'instruction',
    note: null,
  });

  const run: Run = {
    program: 'counter',
    summary: '',
    steps: [
      step(0, []),
      step(1, [
        {
          region: 'input',
          offset: 0,
          len: 8,
          kind: 'write',
          account: 0,
          before,
          after,
        },
      ]),
    ],
    steps_total: 2,
    result: { ok: true, code: 'ok', message: '', committed: true },
    cu_used: 1,
    cu_limit: 200_000,
    accounts_before: [
      {
        index: 0,
        name: 'counter',
        owner: 'Counter111',
        lamports: 1_000_000,
        writable: true,
        executable: false,
        offset: 0,
        len: 8,
        data_hex: before,
      },
    ],
    accounts_after: [],
    slots: [
      {
        index: 0,
        name: 'counter',
        offset: 0,
        len: 8,
        writable: true,
        owner: 'Counter111',
        lamports: 1_000_000,
        executable: false,
      },
    ],
    regions: [],
    logs: [],
    verify: [],
    mapping: 'Aligned',
  };

  it('replays writes over the pre-run snapshot', () => {
    expect(accountHexAt(run, 0)).toEqual([before]);
    expect(accountHexAt(run, 1)).toEqual([after]);
    // Past the end is clamped, not an error.
    expect(accountHexAt(run, 99)).toEqual([after]);
  });

  it('ignores accesses that are not account writes', () => {
    const readOnly: Run = {
      ...run,
      steps: [step(0, [{ ...run.steps[1].accesses[0], kind: 'read', after: null }])],
    };
    expect(accountHexAt(readOnly, 0)).toEqual([before]);
  });
});

describe('small helpers', () => {
  it('diffs registers', () => {
    const previous = { ...baseStep(), regs: [1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0] };
    const current = { ...baseStep(), regs: [1, 9, 3, 0, 0, 0, 0, 0, 0, 0, 0] };
    expect([...changedRegisters(previous, current)]).toEqual([1]);
    expect(changedRegisters(null, current).size).toBe(0);
  });

  it('clamps the CU percentage', () => {
    expect(cuPercent(100, 200)).toBe(50);
    expect(cuPercent(300, 200)).toBe(100);
    expect(cuPercent(1, 0)).toBe(0);
  });

  it('formats sizes without pretending to be exact', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(32 * 1024)).toBe('32 KiB');
    expect(formatBytes(4 * 1024 * 1024 * 1024)).toBe('4 GiB');
  });

  it('groups hex bytes in pairs', () => {
    expect(formatHexBytes('2a00000000000000')).toBe('2a 00  00 00  00 00  00 00');
  });

  it('round trips hex and patches a window', () => {
    expect(bytesToHex([0, 1, 0x2a, 0xff])).toBe('00012aff');
    expect(hexToBytes('00012aff')).toEqual([0, 1, 0x2a, 0xff]);
    expect(patchHex('00012aff', 2, 'beef')).toBe('0001beef');
    expect(patchHex('0001', 1, 'beef')).toBe('0001');
  });
});

function baseStep(): Step {
  return {
    n: 0,
    insn: 0,
    label: '',
    mnemonic: 'mov',
    text: '',
    pc: 0,
    cu: 0,
    cost: 1,
    regs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    r10: 0,
    frame: 0,
    accesses: [],
    syscall: null,
    kind: 'instruction',
    note: null,
  };
}
