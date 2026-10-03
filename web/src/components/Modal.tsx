import { useEffect, useRef, type ReactNode } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog shell for the two modals: Escape closes it, Tab stays inside it, focus lands
 * in it on open and returns to whatever opened it on close.
 *
 * The key handler is registered in the capture phase on `document` so Escape is handled
 * before the window-level transport shortcuts, and it reads `onClose` through a ref so a
 * new inline arrow from the parent does not re-run the effect and steal focus back.
 */
export function Modal({
  className,
  labelledBy,
  onClose,
  children,
}: {
  className?: string;
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = dialog.current;
    if (!root) return;

    const focusable = () => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
    (root.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0])?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      // Wrap at both ends, and pull focus back in if it escaped the dialog entirely.
      if (e.shiftKey && (active === first || !root.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !root.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      opener?.focus();
    };
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialog}
        className={className === undefined ? 'modal' : `modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
