export interface AnalyticsEnv {
  /**
   * GA4 measurement id. Unset means no analytics at all, which is the local default.
   *
   * Read from `import.meta.env` rather than inlined, so a developer's clone sends nothing to
   * the production property. Set it in `.env.local` for a real GA4 property, or in the Vercel
   * project's environment for production.
   */
  VITE_GA_ID?: string;
}

/** Shape of the bits of the global GA4 bootstrap the app relies on. */
interface GtagWindow extends Window {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

/**
 * GA4 measurement ids look like `G-` followed by 10 uppercase alphanumerics. Anything else is
 * treated as absent rather than injected, because a typo that ships as a live script tag fails
 * silently and gets no traffic for ever.
 */
const GA4_ID = /^G-[A-Z0-9]{4,}$/;

/** The real property. Never hardcoded into the shipped app: see `.env.example`. */
export const GA4_ID_PATTERN = GA4_ID;

export function isValidGaId(value: string | undefined | null): boolean {
  return typeof value === 'string' && GA4_ID.test(value.trim());
}

/**
 * Install the GA4 tag, if a valid id was provided.
 *
 * Returns whether it installed, so a caller or a test can tell "no analytics configured" from
 * "installed but blocked", which look identical from the outside otherwise.
 *
 * Idempotent: the gtag script is only added once, so a remount or a hot reload cannot load the
 * tag twice and double-count page views.
 */
export function installAnalytics(env: AnalyticsEnv, doc: Document = document): boolean {
  const id = env.VITE_GA_ID?.trim();
  if (!isValidGaId(id)) return false;

  const win = doc.defaultView as GtagWindow | null;
  if (!win) return false;
  if (win.gtag && doc.querySelector(`script[src*="${id}"]`)) return true;

  win.dataLayer = win.dataLayer || [];
  const gtag = function gtag(...args: unknown[]): void {
    win.dataLayer!.push(args);
  };
  win.gtag = gtag;
  gtag('js', new Date());
  gtag('config', id);

  const script = doc.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id!)}`;
  doc.head.appendChild(script);
  return true;
}
