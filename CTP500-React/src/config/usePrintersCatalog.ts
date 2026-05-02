import { useEffect, useState } from 'react';
import { loadPrintersCatalogWithSession, SESSION_PRINTERS_CHANGED_EVENT } from './sessionPrinters';
import type { PrintersCatalog } from './parsePrintersYaml';

export type PrintersCatalogLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; catalog: PrintersCatalog };

function urlPrefix(): string {
  const base = import.meta.env.BASE_URL;
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * Loads built-in `printers.yaml`, merges user `printers/*.yaml` (JSON `GET printers/` or manifest
 * fallback), then merges **tab-only** definitions from `sessionStorage` (see `/printer-setup`).
 * Listens for `SESSION_PRINTERS_CHANGED_EVENT` so the catalog refreshes without a full page reload.
 */
export function usePrintersCatalog(): PrintersCatalogLoadState {
  const [state, setState] = useState<PrintersCatalogLoadState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const onSessionPrintersChanged = () => setReloadToken((n) => n + 1);
    window.addEventListener(SESSION_PRINTERS_CHANGED_EVENT, onSessionPrintersChanged);
    return () => window.removeEventListener(SESSION_PRINTERS_CHANGED_EVENT, onSessionPrintersChanged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    void (async () => {
      try {
        const catalog = await loadPrintersCatalogWithSession(urlPrefix());
        if (!cancelled) {
          setState({ status: 'ready', catalog });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!cancelled) {
          setState({ status: 'error', message });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  return state;
}
