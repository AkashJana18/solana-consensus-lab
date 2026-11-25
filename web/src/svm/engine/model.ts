// Pure helpers for the three chapters. Everything that can be tested without a browser
// lives here, so the React components stay about layout and interaction.

import type { MappingMode, RegionView, Run, Step } from './types';

export interface AddressResult {
  ok: boolean;
  address: number;
  reason?: string;
}

/** VM offset to host address, mirroring svm_core::memory::host_address. */
export function hostAddress(
  region: RegionView,
  offset: number,
  mode: MappingMode,
  align = 8,
): AddressResult {
  if (offset < 0 || offset >= region.size) {
    return { ok: false, address: 0, reason: `offset ${offset} is outside the ${region.region} slice` };
  }
  if (mode === 'aligned' && align > 0 && offset % align !== 0) {
    return {
      ok: false,
      address: 0,
      reason: `${offset} is not ${align}-byte aligned, so Aligned mode refuses it`,
    };
  }
  const address = mode === 'identity' ? region.base + offset : region.host_base + offset;
  return { ok: true, address };
}

export function shortAddress(address: number): string {
  return `0x${address.toString(16)}`;
}

export function regionByAddress(regions: RegionView[], address: number): RegionView | null {
  for (const region of regions) {
    if (address >= region.base && address - region.base < region.size) return region;
  }
  return null;
}

export interface LockTx {
  id: string;
  label: string;
  reads: string[];
  writes: string[];
}

/** Two transactions conflict when one writes an account the other reads or writes. */
export function conflicts(a: LockTx, b: LockTx): string[] {
  const hits = new Set<string>();
  for (const account of a.writes) {
    if (b.writes.includes(account) || b.reads.includes(account)) hits.add(account);
  }
  for (const account of b.writes) {
    if (a.reads.includes(account)) hits.add(account);
  }
  return [...hits];
}

export function laneConflicts(laneA: LockTx[], laneB: LockTx[]): { a: string; b: string; accounts: string[] }[] {
  const out: { a: string; b: string; accounts: string[] }[] = [];
  for (const a of laneA) {
    for (const b of laneB) {
      const accounts = conflicts(a, b);
      if (accounts.length > 0) out.push({ a: a.id, b: b.id, accounts });
    }
  }
  return out;
}

export interface DeployPlan {
  chunks: number;
  cuPerWrite: number;
  cuTotal: number;
  txs: number;
}

/**
 * Illustrative accounting for the deploy console. Every chunk is its own transaction,
 * so a smaller chunk buys nothing: it multiplies the per-transaction overhead. The
 * numbers are round on purpose, and the panel says they are illustrative.
 */
export function deployPlan(elfBytes: number, chunkBytes: number): DeployPlan {
  const chunks = Math.max(1, Math.ceil(elfBytes / chunkBytes));
  const cuPerWrite = 50 + Math.ceil(chunkBytes / 32);
  const cuTotal = chunks * cuPerWrite + 1_200;
  return { chunks, cuPerWrite, cuTotal, txs: chunks + 2 };
}

export function patchHex(hex: string, byteOffset: number, patch: string): string {
  const bytes = hexToBytes(hex);
  const replacement = hexToBytes(patch);
  if (byteOffset < 0 || byteOffset + replacement.length > bytes.length) return hex;
  for (let i = 0; i < replacement.length; i += 1) bytes[byteOffset + i] = replacement[i];
  return bytesToHex(bytes);
}

export function hexToBytes(hex: string): number[] {
  const clean = hex.replace(/\s/g, '');
  const out: number[] = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

export function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Account bytes as they stand at a given step. The trace stores only writes, so this
 * replays them over the pre-run snapshot. It is what makes the memory panel live.
 */
export function accountHexAt(run: Run, upto: number): string[] {
  const state = run.accounts_before.map((a) => a.data_hex);
  const limit = Math.min(upto, run.steps.length - 1);
  for (let i = 0; i <= limit; i += 1) {
    for (const access of run.steps[i].accesses) {
      if (access.kind !== 'write' || access.account === null || access.after === null) continue;
      const slot = run.slots[access.account];
      if (!slot) continue;
      const within = access.offset - slot.offset;
      state[access.account] = patchHex(state[access.account] ?? '', within, access.after);
    }
  }
  return state;
}

export function changedRegisters(previous: Step | null, current: Step): Set<number> {
  const changed = new Set<number>();
  if (!previous) return changed;
  for (let i = 0; i < current.regs.length; i += 1) {
    if (previous.regs[i] !== current.regs[i]) changed.add(i);
  }
  return changed;
}

export function cuPercent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.max(0, (used / limit) * 100));
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(0)} GiB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(n % 1024 === 0 ? 0 : 1)} KiB`;
  return `${n} B`;
}

export function formatCu(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatHexBytes(hex: string, group = 2): string {
  const bytes = hex.match(/.{1,2}/g) ?? [];
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += group) chunks.push(bytes.slice(i, i + group).join(' '));
  return chunks.join('  ');
}

export function accountDataHex(run: Run, index: number): string {
  const after = run.accounts_after[index];
  return after ? after.data_hex : '';
}
