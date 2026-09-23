import { protocolsFor, useStore, type Tab } from '../store/useStore';
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
