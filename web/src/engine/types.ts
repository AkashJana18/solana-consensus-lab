// TypeScript mirror of docs/wasm-api.md (engine <-> UI contract).
// All times are microseconds of simulated time unless a field name says `_ms`.

export type Protocol = 'alpenglow' | 'tower';
export type NodeId = number;
/** u64 rendered as a JSON number; treat as an opaque id, compare by equality only. */
export type BlockHash = number;

export interface Scenario {
  name: string;
  description: string;
  seed: number;
  duration_ms: number;
  validators: { count: number; stake?: unknown; regions?: unknown[] };
  network?: unknown;
  faults: Fault[];
  hero_tx: { submit_at_ms: number; rpc_node: NodeId | null };
  params: { slot_ms: number; leader_window: number; exec_delay_ms: number; [k: string]: unknown };
}

export type FaultTarget = { nodes: NodeId[] } | { stake_pct: number } | { leader_of_slot: number };

export type Fault =
  | { kind: 'offline'; target: FaultTarget; from_ms: number; to_ms?: number | null }
  | { kind: 'partition'; groups: unknown; from_ms: number; to_ms: number }
  | { kind: 'delay'; target: FaultTarget; extra_ms: number; from_ms: number; to_ms?: number | null }
  | { kind: 'drop'; prob: number; from_ms: number; to_ms?: number | null };

export interface SimMeta {
  protocol: Protocol;
  n: number;
  stakes: number[];
  total_stake: number;
  regions: string[];
  node_region: number[];
  leaders: number[];
  window: number;
  slot_ms: number;
  num_slots: number;
  duration_us: number;
  scenario: Scenario;
}

export type DropReason = 'partition' | 'random' | 'receiver_offline' | 'sender_offline';
export type VoteKind = 'notarize' | 'notar_fallback' | 'skip' | 'skip_fallback' | 'finalize' | 'tower';
export type CertKind = 'notarization' | 'notar_fallback' | 'skip' | 'fast_finalization' | 'finalization';
export type PoolEventKind = 'block_notarized' | 'parent_ready' | 'safe_to_notar' | 'safe_to_skip';
export type VotorFlagKind = 'voted' | 'voted_notar' | 'bad_window' | 'its_over' | 'block_notarized' | 'parent_ready';
export type CommitmentLevel = 'processed' | 'confirmed' | 'finalized';

export type TxStage =
  | 'submitted'
  | 'forwarded_to_leader'
  | 'included_in_block'
  | 'propagating'
  | 'replayed'
  | 'voted'
  | 'confirmed'
  | 'finalized';

export const TX_STAGES: readonly TxStage[] = [
  'submitted',
  'forwarded_to_leader',
  'included_in_block',
  'propagating',
  'replayed',
  'voted',
  'confirmed',
  'finalized',
];

export interface Lockout {
  slot: number;
  confirmation_count: number;
}

export type TraceEvent =
  | { type: 'slot_start'; slot: number; leader: NodeId }
  | {
      type: 'msg_sent';
      id: number;
      from: NodeId;
      to: NodeId;
      kind: string;
      bytes: number;
      arrive_at: number;
      dropped?: DropReason;
      slot?: number;
    }
  | { type: 'msg_dropped'; id: number; reason: DropReason }
  | { type: 'node_offline'; node: NodeId }
  | { type: 'node_online'; node: NodeId }
  | { type: 'partition_start'; groups: NodeId[][] }
  | { type: 'partition_end' }
  | {
      type: 'block_produced';
      slot: number;
      hash: BlockHash;
      parent: BlockHash;
      leader: NodeId;
      txs: number[];
      /** Vote transactions packed into the block (TowerBFT only; always 0 under Alpenglow). */
      vote_txs: number;
    }
  | { type: 'block_received'; node: NodeId; slot: number; hash: BlockHash }
  | { type: 'block_replayed'; node: NodeId; slot: number; hash: BlockHash }
  | { type: 'vote'; node: NodeId; slot: number; kind: VoteKind; hash?: BlockHash }
  | { type: 'certificate'; node: NodeId; slot: number; kind: CertKind; hash?: BlockHash; stake_pct: number }
  | { type: 'pool_event'; node: NodeId; slot: number; kind: PoolEventKind; hash?: BlockHash }
  | { type: 'votor_flag'; node: NodeId; slot: number; flag: VotorFlagKind; hash?: BlockHash }
  | { type: 'timeout'; node: NodeId; slot: number }
  | { type: 'tower_update'; node: NodeId; lockouts: Lockout[]; root?: number }
  | { type: 'fork_choice'; node: NodeId; head_slot: number; head_hash: BlockHash }
  | { type: 'commitment'; node: NodeId; slot: number; hash: BlockHash; level: CommitmentLevel }
  | { type: 'tx_stage'; tx: number; stage: TxStage; node?: NodeId; slot?: number; detail?: string }
  | { type: 'log'; node?: NodeId; msg: string };

export type Traced = { t: number } & TraceEvent;
export type TracedOf<K extends TraceEvent['type']> = Extract<Traced, { type: K }>;

// ---- inspect() payloads ----

export interface VotorRow {
  slot: number;
  voted: boolean;
  voted_notar: boolean;
  its_over: boolean;
  block_notarized: boolean;
  parents_ready: number[];
  bad_window: boolean;
  pending: number;
}

export interface PoolTally {
  slot: number;
  notarize: { hash: BlockHash; pct: number }[];
  notar_fallback: { hash: BlockHash; pct: number }[];
  skip_pct: number;
  skip_fallback_pct: number;
  finalize_pct: number;
  certs: { kind: CertKind; hash: BlockHash | null }[];
}

export interface AlpenglowInspect {
  protocol: 'alpenglow';
  node: NodeId;
  highest_finalized_slot: number;
  finalized_blocks: number;
  hero_block: BlockHash | null;
  votor: VotorRow[];
  /** Engine emits `null` for slots the node has no tally for (see README "contract notes"). */
  pool: (PoolTally | null)[];
  leader: { pending_txs: number[]; produced_slots: number[] };
}

export interface ForkNode {
  hash: BlockHash;
  slot: number;
  parent: BlockHash;
  weight_pct: number;
  confirmed: boolean;
  rooted: boolean;
}

export interface TowerInspect {
  protocol: 'tower';
  node: NodeId;
  root: number;
  lockouts: Lockout[];
  head: { slot: number; hash: BlockHash };
  forks: ForkNode[];
  threshold_ok: boolean;
  locked_out_slots: number[];
}

export type Inspect = AlpenglowInspect | TowerInspect | null;

// ---- metrics() ----

export interface MsgStat {
  count: number;
  bytes: number;
  dropped: number;
}

export interface Metrics {
  /** First time (milliseconds) each tx stage was reached. */
  tx_stage_ms: Partial<Record<TxStage, number>>;
  msgs: Record<string, MsgStat>;
  total_msgs: number;
  total_bytes: number;
  votes: Partial<Record<VoteKind, number>>;
  certificates: Partial<Record<CertKind, number>>;
  slots_started: number;
  blocks_produced: number;
  /** Vote transactions packed into blocks (TowerBFT) and their byte cost; 0 under Alpenglow. */
  vote_txs_in_blocks: number;
  vote_tx_bytes_in_blocks: number;
}
