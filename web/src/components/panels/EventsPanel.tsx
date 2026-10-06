import { memo, useMemo, useRef, useState } from 'react';
import { useSize } from '../../hooks/useSize';
import { FEED_CAP, type FeedItem } from '../../store/runView';
import { protocolsFor, useStore } from '../../store/useStore';
import { PROTOCOL_LABEL, fmtMs } from '../../util/format';
import { forProtocol } from '../../util/protocolRun';

const ROW_H = 46;
const OVERSCAN = 6;

/**
 * Rows worth reading when following one transaction on devnet. A live run emits roughly two
 * rows per slot, so within seconds the transaction's own progress is buried under block and
 * slot traffic that carries no extra information about it. Everything not in here is still
 * recorded and still one click away.
 */
const WATCHED_TYPES = new Set<FeedItem['type']>(['tx_stage', 'rpc_conn', 'slot_skipped', 'log']);

/** Virtualised feed: only the rows inside the scroll viewport (+overscan) exist in the DOM. */
export function EventsPanel() {
  const mode = useStore((s) => s.mode);
  const protocols = protocolsFor(mode);
  const [proto, setProto] = useState(protocols[0]);
  const active = protocols.includes(proto) ? proto : protocols[0];
  const alpenglowFeed = useStore((s) => s.runs.alpenglow?.feed);
  const towerFeed = useStore((s) => s.runs.tower?.feed);
  const liveFeed = useStore((s) => s.runs.live?.feed);
  const feed = forProtocol(active, { alpenglow: alpenglowFeed, tower: towerFeed, live: liveFeed }) ?? [];
  const [scrollTop, setScrollTop] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const isLive = active === 'live';
  const [allTraffic, setAllTraffic] = useState(false);
  const visible = useMemo(
    () => (isLive && !allTraffic ? feed.filter((f) => WATCHED_TYPES.has(f.type)) : feed),
    [feed, isLive, allTraffic],
  );
  const hidden = feed.length - visible.length;
  // Measured rather than tracked on scroll: a resize, a mode switch or the lesson panel
  // opening all resize this without a scroll event, which used to leave the rendered
  // window stale and rows missing at the bottom.
  const { height: viewport } = useSize(ref);
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const end = Math.min(visible.length, Math.ceil((scrollTop + viewport) / ROW_H) + OVERSCAN);

  const scope = (all: boolean) => {
    setAllTraffic(all);
    // The rendered window is derived from scrollTop, so a scroll position past the end of
    // the shorter list would render an empty feed.
    setScrollTop(0);
    if (ref.current) ref.current.scrollTop = 0;
  };

  const countText =
    hidden > 0
      ? `${visible.length} shown · ${hidden} slot/block rows hidden`
      : visible.length >= FEED_CAP
        ? `newest ${FEED_CAP} · older events not listed`
        : `${visible.length} shown · newest first`;

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
        <div className="row gap">
          {isLive && (
            <div className="segmented small" role="group" aria-label="Feed scope">
              <button className={allTraffic ? '' : 'on'} onClick={() => scope(false)} data-testid="feed-scope-watched">
                Watched tx
              </button>
              <button className={allTraffic ? 'on' : ''} onClick={() => scope(true)} data-testid="feed-scope-all">
                All traffic
              </button>
            </div>
          )}
          <span className="muted small" data-testid="feed-count">
            {countText}
          </span>
        </div>
      </div>
      <div
        className="feed"
        ref={ref}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        data-testid="event-feed"
      >
        {visible.length === 0 && (
          <p className="empty">{isLive ? 'No observed events yet. Paste a signature and press Trace.' : 'Nothing yet. Press play.'}</p>
        )}
        <div style={{ height: visible.length * ROW_H, position: 'relative' }}>
          {visible.slice(start, end).map((it, i) => (
            <FeedRow key={it.key} item={it} top={(start + i) * ROW_H} />
          ))}
        </div>
      </div>
    </div>
  );
}

const FeedRow = memo(function FeedRow({ item, top }: { item: FeedItem; top: number }) {
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
});
