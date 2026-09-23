// Derived, display-time-accurate view of one protocol run. Built by folding the
// trace events the display clock has passed (never events the worker has merely
// pre-computed), so panels and canvas always agree on "now".
import type { Inspect, Lockout, Metrics, Protocol, SimMeta, Traced, TxStage } from '../engine/types';
import { reduceTxStages, type TxStageMap } from '../engine/txStages';

export interface FeedItem {
  key: number;
  t: number;
  type: Traced['type'];
  kind: string;
  text: string;
  node?: number;
}

export interface BlockInfo {
  slot: number;
  hash: number;
  parent: number;
  leader: number;
  txs: number[];
  t: number;
}

export interface RunView {
  protocol: Protocol;
  meta: SimMeta | null;
  txStages: TxStageMap;
  leader: number | null;
  currentSlot: number;
  offline: ReadonlySet<number>;
  partition: number[][] | null;
  rpcNode: number | null;
  heroSlot: number | null;
  heroHash: number | null;
  feed: FeedItem[];
  blocks: BlockInfo[];
  towers: ReadonlyMap<number, { lockouts: Lockout[]; root: number | null; t: number }>;
  heads: ReadonlyMap<number, { slot: number; hash: number }>;
  /** Highest slot any node reported at each commitment level. */
  commitment: { processed: number; confirmed: number; finalized: number };
  inspect: Inspect;
  metrics: Metrics | null;
  workerNow: number;
  error: string | null;
  eventsSeen: number;
}

export const FEED_CAP = 400;
const FEED_TYPES = new Set<Traced['type']>([
  'certificate',
  'pool_event',
  'timeout',
  'node_offline',
  'node_online',
  'partition_start',
  'partition_end',
  'log',
  'tx_stage',
  'slot_start',
  'block_produced',
]);

export function emptyView(protocol: Protocol, meta: SimMeta | null = null): RunView {
  return {
    protocol,
    meta,
    txStages: {},
    leader: null,
    currentSlot: 0,
    offline: new Set(),
    partition: null,
    rpcNode: null,
    heroSlot: null,
    heroHash: null,
    feed: [],
    blocks: [],
    towers: new Map(),
    heads: new Map(),
    commitment: { processed: -1, confirmed: -1, finalized: -1 },
    inspect: null,
    metrics: null,
    workerNow: 0,
    error: null,
    eventsSeen: 0,
  };
}

let feedKey = 0;

/**
 * Short display id for a block hash. The doc suggests the last 4 hex digits, but u64 hashes
 * arrive as JSON doubles and lose their low bits (they render as ...000), so the leading
 * digits are used — they survive the rounding and stay distinct.
 */
export function shortHash(h: number | null | undefined): string {
  if (h === null || h === undefined) return '—';
  return h.toString(16).slice(0, 4).padStart(4, '0');
}

function describe(e: Traced): string {
  switch (e.type) {
    case 'certificate':
      return `${e.kind} cert slot ${e.slot} (${(e.stake_pct * 100).toFixed(1)}% stake)${e.hash !== undefined ? ' · ' + shortHash(e.hash) : ''}`;
    case 'pool_event':
      return `${e.kind.replace(/_/g, ' ')} slot ${e.slot}`;
    case 'timeout':
      return `timeout slot ${e.slot}`;
    case 'node_offline':
      return `node ${e.node} went offline`;
    case 'node_online':
      return `node ${e.node} back online`;
    case 'partition_start':
      return `partition: ${e.groups.map((g) => g.length).join(' | ')} nodes`;
    case 'partition_end':
      return 'partition healed';
    case 'log':
      return e.msg;
    case 'tx_stage':
      return `hero tx ${e.stage.replace(/_/g, ' ')}${e.slot !== undefined ? ' (slot ' + e.slot + ')' : ''}${e.detail ? ' — ' + e.detail : ''}`;
    case 'slot_start':
      return `slot ${e.slot} · leader ${e.leader}`;
    case 'block_produced':
      return `block ${shortHash(e.hash)} slot ${e.slot} by ${e.leader}${e.txs.includes(0) ? ' · contains hero tx' : ''}`;
    case 'commitment':
      return `slot ${e.slot} ${e.level}`;
    default:
      return e.type;
  }
}

function feedKind(e: Traced): string {
  if ('kind' in e && typeof e.kind === 'string') return e.kind;
  if (e.type === 'tx_stage') return e.stage;
  if (e.type === 'commitment') return e.level;
  return e.type;
}

/** Fold a batch of events (already sorted by t) into the view. Returns the same object if nothing changed. */
export function applyEvents(view: RunView, events: readonly Traced[]): RunView {
  if (events.length === 0) return view;
  const v: RunView = { ...view, eventsSeen: view.eventsSeen + events.length };
  let offline: Set<number> | null = null;
  let towers: Map<number, { lockouts: Lockout[]; root: number | null; t: number }> | null = null;
  let heads: Map<number, { slot: number; hash: number }> | null = null;
  const feed: FeedItem[] = [];
  let blocks: BlockInfo[] | null = null;
  let commitment = view.commitment;
  const finalizedSeen = new Set<number>();

  for (const e of events) {
    switch (e.type) {
      case 'slot_start':
        v.leader = e.leader;
        v.currentSlot = e.slot;
        break;
      case 'node_offline':
        (offline ??= new Set(view.offline)).add(e.node);
        break;
      case 'node_online':
        (offline ??= new Set(view.offline)).delete(e.node);
        break;
      case 'partition_start':
        v.partition = e.groups;
        break;
      case 'partition_end':
        v.partition = null;
        break;
      case 'block_produced':
        (blocks ??= view.blocks.slice()).push({ slot: e.slot, hash: e.hash, parent: e.parent, leader: e.leader, txs: e.txs, t: e.t });
        if (e.txs.includes(0)) {
          v.heroSlot = e.slot;
          v.heroHash = e.hash;
        }
        break;
      case 'tower_update':
        (towers ??= new Map(view.towers)).set(e.node, { lockouts: e.lockouts, root: e.root ?? null, t: e.t });
        break;
      case 'fork_choice':
        (heads ??= new Map(view.heads)).set(e.node, { slot: e.head_slot, hash: e.head_hash });
        break;
      case 'commitment':
        if (e.slot > commitment[e.level]) commitment = { ...commitment, [e.level]: e.slot };
        // Only the first node to finalize a slot makes the feed, otherwise 25 lines per slot.
        if (e.level === 'finalized' && !finalizedSeen.has(e.slot) && e.slot > view.commitment.finalized) {
          finalizedSeen.add(e.slot);
          feed.push({ key: ++feedKey, t: e.t, type: e.type, kind: 'finalized', text: `slot ${e.slot} finalized · ${shortHash(e.hash)}`, node: e.node });
        }
        break;
      case 'tx_stage':
        if (e.stage === 'submitted' && e.node !== undefined && v.rpcNode === null) v.rpcNode = e.node;
        // Tower's block_produced.txs may not list the hero tx; the stage event still tells us the slot.
        if (e.stage === 'included_in_block' && e.slot !== undefined && v.heroSlot === null) {
          v.heroSlot = e.slot;
          v.heroHash = (blocks ?? view.blocks).find((b) => b.slot === e.slot)?.hash ?? null;
        }
        break;
      default:
        break;
    }
    if (FEED_TYPES.has(e.type)) {
      // Only the first tx_stage occurrence is pedagogically interesting; drop repeats.
      if (e.type === 'tx_stage' && (view.txStages[e.stage as TxStage] || feed.some((f) => f.type === 'tx_stage' && f.kind === e.stage))) continue;
      const node = 'node' in e ? e.node : undefined;
      feed.push({ key: ++feedKey, t: e.t, type: e.type, kind: feedKind(e), text: describe(e), node });
    }
  }

  v.txStages = reduceTxStages(view.txStages, events);
  if (offline) v.offline = offline;
  if (towers) v.towers = towers;
  if (heads) v.heads = heads;
  if (blocks) v.blocks = blocks;
  v.commitment = commitment;
  if (feed.length) {
    feed.reverse();
    v.feed = feed.concat(view.feed).slice(0, FEED_CAP);
  }
  return v;
}
