/// <reference types="vite/client" />

// Env vars this app reads at build time. Vite exposes only `VITE_`-prefixed variables to
// client code, so these ship to the browser: measurement ids are fine, secrets are not.
interface ImportMetaEnv {
  /** GA4 measurement id. Unset in a local clone, which is why analytics are off by default. */
  readonly VITE_GA_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
