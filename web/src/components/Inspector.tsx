import { protocolsFor, useStore, type Tab } from '../store/useStore';
import { controller } from '../engine/controller';
import { EventsPanel } from './panels/EventsPanel';
import { MetricsPanel } from './panels/MetricsPanel';
import { TowerPanel } from './panels/TowerPanel';
import { TransactionPanel } from './panels/TransactionPanel';
import { VotorPanel } from './panels/VotorPanel';

const TABS: { id: Tab; label: string; needs?: 'alpenglow' | 'tower' }[] = [
  { id: 'transaction', label: 'Transaction' },
  { id: 'votor', label: 'Votor', needs: 'alpenglow' },
  { id: 'tower', label: 'Tower', needs: 'tower' },
  { id: 'events', label: 'Events' },
  { id: 'metrics', label: 'Metrics' },
];

export function Inspector() {
  const tab = useStore((s) => s.tab);
  const mode = useStore((s) => s.mode);
  const set = useStore((s) => s.set);
  const protocols = protocolsFor(mode);
  const tabs = TABS.filter((t) => !t.needs || protocols.includes(t.needs));
  const active = tabs.some((t) => t.id === tab) ? tab : 'transaction';

  return (
    <aside className="inspector">
      <NodePicker />
      <nav className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={active === t.id} className={active === t.id ? 'on' : ''} onClick={() => set({ tab: t.id })} data-testid={`tab-${t.id}`}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="panel" role="tabpanel">
        {active === 'transaction' && <TransactionPanel />}
        {active === 'votor' && <VotorPanel />}
        {active === 'tower' && <TowerPanel />}
        {active === 'events' && <EventsPanel />}
        {active === 'metrics' && <MetricsPanel />}
      </div>
    </aside>
  );
}

/**
 * Selecting a validator used to be possible only by clicking its circle on the canvas,
 * which left the Votor and Tower panels -- the two richest views in the app -- unreachable
 * without a pointer. This is the keyboard equivalent, and it also names the nodes that
 * the canvas draws as bare circles.
 */
function NodePicker() {
  const mode = useStore((s) => s.mode);
  const selected = useStore((s) => s.selectedNode);
  const set = useStore((s) => s.set);
  const protocol = protocolsFor(mode)[0];
  const meta = useStore((s) => s.runs[protocol]?.meta ?? null);
  const offline = useStore((s) => s.runs[protocol]?.offline);
  const rpcNode = useStore((s) => s.runs[protocol]?.rpcNode ?? null);
  if (!meta) return null;

  const pick = (v: string) => {
    set({ selectedNode: v === '' ? null : Number(v) });
    // Same follow-up the canvas click does, so inspect() arrives for the new node.
    controller.poll(true);
  };

  return (
    <label className="node-picker">
      <span>Node</span>
      <select value={selected ?? ''} onChange={(e) => pick(e.target.value)} aria-label="Selected validator" data-testid="node-picker">
        <option value="">none</option>
        {meta.stakes.map((stake, id) => (
          <option key={id} value={id}>
            node {id} · {(stake * 100).toFixed(1)}% stake{offline?.has(id) ? ' · offline' : ''}
            {id === rpcNode ? ' · RPC' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
