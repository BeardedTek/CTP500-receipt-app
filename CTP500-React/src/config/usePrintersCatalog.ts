import { useEffect, useState } from 'react';
import { mergeUserPrinterFragments, parsePrintersYamlText, type PrintersCatalog } from './parsePrintersYaml';

export type PrintersCatalogLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; catalog: PrintersCatalog };

function urlPrefix(): string {
  const base = import.meta.env.BASE_URL;
  return base.endsWith('/') ? base : `${base}/`;
}

async function loadPrintersCatalog(): Promise<PrintersCatalog> {
  const prefix = urlPrefix();
  const builtInUrl = `${prefix}printers.yaml`;
  const res = await fetch(builtInUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load ${builtInUrl}: HTTP ${res.status}`);
  }
  const base = parsePrintersYamlText(await res.text());
  return await mergeUserPrinterFragments(base, prefix);
}

/**
 * Loads built-in `printers.yaml`, then merges optional `printers/manifest.yaml` + `printers/<id>.yaml`
 * for user-added printers. Re-fetched on each full page load so ops can edit files without rebuilding.
 */
export function usePrintersCatalog(): PrintersCatalogLoadState {
  const [state, setState] = useState<PrintersCatalogLoadState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const catalog = await loadPrintersCatalog();
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
