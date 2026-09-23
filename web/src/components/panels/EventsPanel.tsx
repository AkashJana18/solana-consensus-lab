import { useRef, useState } from 'react';
import type { FeedItem } from '../../store/runView';
import { protocolsFor, useStore } from '../../store/useStore';
import { PROTOCOL_LABEL, fmtMs } from '../../util/format';

const ROW_H = 46;
const OVERSCAN = 6;

/** Virtualised feed: only the rows inside the scroll viewport (+overscan) exist in the DOM. */
export function EventsPanel() {
  const mode = useStore((s) => s.mode);
  const runs = useStore((s) => s.runs);
  const protocols = protocolsFor(mode);
  const [proto, setProto] = useState(protocols[0]);
  const active = protocols.includes(proto) ? proto : protocols[0];
  const feed = runs[active]?.feed ?? [];
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const ref = useRef<HTMLDivElement>(null);
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(feed.length, Math.ceil((scrollTop + viewport) / ROW_H) + OVERSCAN);

  return (
    <div className="events-panel">
      <div className="row-between">
        {protocols.length > 1 ? (
          <div className="segmented small">
            {protocols.map((p) => (
              <button key={p} className={active === p ? 'on' : ''} onClick={() => setProto(p)}>
                {PROTOCOL_LABEL[p]}
              </button>
            ))}
          </div>
        ) : (
          <h3>Events</h3>
        )}
        <span className="muted small">{feed.length} shown · newest first</span>
      </div>
      <div
        className="feed"
        ref={ref}
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
          setViewport(e.currentTarget.clientHeight);
        }}
        data-testid="event-feed"
      >
        {feed.length === 0 && <p className="empty">Nothing yet — press play.</p>}
        <div style={{ height: feed.length * ROW_H, position: 'relative' }}>
          {feed.slice(start, end).map((it, i) => (
            <FeedRow key={it.key} item={it} top={(start + i) * ROW_H} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FeedRow({ item, top }: { item: FeedItem; top: number }) {
  return (
    <div className={`feed-row type-${item.type}`} style={{ top, height: ROW_H }}>
      <span className="chip-dot" data-kind={item.kind} data-type={item.type} />
      <div className="feed-body">
        <div className="feed-title">
          <span className="feed-kind">{item.kind.replace(/_/g, ' ')}</span>
          {item.node !== undefined && <span className="muted"> · node {item.node}</span>}
        </div>
        <div className="feed-text">{item.text}</div>
      </div>
      <span className="feed-time">{fmtMs(item.t)}</span>
    </div>
  );
}
