import { useEffect, useState } from 'react';
import { parsePrintersYamlText, type PrintersCatalog } from './parsePrintersYaml';

export type PrintersCatalogLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; catalog: PrintersCatalog };

function printersYamlUrl(): string {
  const base = import.meta.env.BASE_URL;
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}printers.yaml`;
}

/**
 * Fetches `/printers.yaml` (under Vite base) once on mount. Each full page load re-fetches so ops
 * can edit the file on the server without rebuilding the JS bundle.
 */
export function usePrintersCatalog(): PrintersCatalogLoadState {
  const [state, setState] = useState<PrintersCatalogLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const url = printersYamlUrl();

    void (async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) {
          throw new Error(`Failed to load ${url}: HTTP ${res.status}`);
        }
        const text = await res.text();
        const catalog = parsePrintersYamlText(text);
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
  }, []);

  return state;
}
