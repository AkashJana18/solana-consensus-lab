import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Long enough that passing the cursor over the bar does not strobe it. */
const SHOW_DELAY_MS = 350;
const GAP = 10;
const MARGIN = 8;

interface Tip {
  text: string;
  el: HTMLElement;
}

/**
 * One tooltip for the whole app, driven by `data-tip` on the hovered or focused element.
 *
 * It replaces the native `title` popup on the toolbar: that one is positioned by the OS,
 * ignores the dark theme, and cannot be styled. Explanatory hovers inside the panels
 * (what a stage means, a lockout's numbers) still use `title`, since those are read at
 * leisure rather than scanned.
 */
export function Tooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active: HTMLElement | null = null;

    const cancel = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };
    const hide = () => {
      cancel();
      active = null;
      setTip(null);
    };
    const show = (el: HTMLElement, delay: number) => {
      cancel();
      active = el;
      timer = setTimeout(() => setTip({ text: el.dataset.tip ?? '', el }), delay);
    };
    const owner = (t: EventTarget | null) => ((t as HTMLElement | null)?.closest?.('[data-tip]') as HTMLElement | null) ?? null;

    const onOver = (e: PointerEvent) => {
      const el = owner(e.target);
      if (el === active) return;
      hide();
      if (el) show(el, SHOW_DELAY_MS);
    };
    const onOut = (e: PointerEvent) => {
      // Moving onto a child of the same control is still the same control.
      if (owner(e.relatedTarget) === active) return;
      hide();
    };
    // Keyboard users get the same names: show at once, since focus is deliberate.
    const onFocusIn = (e: FocusEvent) => {
      const el = owner(e.target);
      if (el) show(el, 0);
    };
    const onFocusOut = () => hide();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKey);
    // Scrolling or resizing moves the anchor out from under a fixed tooltip.
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      cancel();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !ref.current) return;
    const anchor = tip.el.getBoundingClientRect();
    const box = ref.current.getBoundingClientRect();
    const left = Math.max(MARGIN, Math.min(anchor.left + anchor.width / 2 - box.width / 2, window.innerWidth - box.width - MARGIN));
    // Below the control, unless that would put it off the bottom of the window.
    const below = anchor.bottom + GAP;
    const top = below + box.height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, anchor.top - box.height - GAP);
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={ref} className="tooltip" role="tooltip" style={{ left: pos.left, top: pos.top }}>
      {tip.text}
    </div>
  );
}