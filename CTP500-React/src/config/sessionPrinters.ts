import {
  mergeUserPrinterFragments,
  parsePrinterFragmentYaml,
  parsePrintersYamlText,
  type PrinterDefinition,
  type PrintersCatalog,
} from './parsePrintersYaml';

const STORAGE_KEY = 'ctp500.sessionPrinters.v1';

export const SESSION_PRINTERS_CHANGED_EVENT = 'ctp500-session-printers-changed';

export type SessionPrinterRecord = { id: string; yaml: string };

function emitChanged(): void {
  window.dispatchEvent(new Event(SESSION_PRINTERS_CHANGED_EVENT));
}

export function getSessionPrinterRecords(): SessionPrinterRecord[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter(
      (x): x is SessionPrinterRecord =>
        typeof x === 'object' &&
        x !== null &&
        typeof (x as SessionPrinterRecord).id === 'string' &&
        typeof (x as SessionPrinterRecord).yaml === 'string',
    );
  } catch {
    return [];
  }
}

function setSessionPrinterRecords(records: SessionPrinterRecord[]): void {
  if (records.length === 0) {
    sessionStorage.removeItem(STORAGE_KEY);
  } else {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }
  emitChanged();
}

/** Validates YAML, then stores (or replaces) this id for the current tab. */
export function addOrUpdateSessionPrinter(id: string, yaml: string): void {
  parsePrinterFragmentYaml(yaml, id);
  const next = getSessionPrinterRecords().filter((r) => r.id !== id);
  next.push({ id, yaml });
  setSessionPrinterRecords(next);
}

export function clearSessionPrinters(): void {
  sessionStorage.removeItem(STORAGE_KEY);
  emitChanged();
}

/** Parsed session definitions, in storage order; invalid entries are skipped. */
export function parseSessionPrinterDefinitions(): PrinterDefinition[] {
  const out: PrinterDefinition[] = [];
  for (const { id, yaml } of getSessionPrinterRecords()) {
    try {
      out.push(parsePrinterFragmentYaml(yaml, id));
    } catch {
      /* skip corrupt row */
    }
  }
  return out;
}

/**
 * After server catalog is loaded: any printer with the same `id` as a session entry is replaced;
 * remaining session entries are appended (storage order).
 */
export function mergeSessionPrintersIntoCatalog(catalog: PrintersCatalog): PrintersCatalog {
  const sessionDefs = parseSessionPrinterDefinitions();
  if (sessionDefs.length === 0) return catalog;
  const override = new Set(sessionDefs.map((d) => d.id));
  const printers = [...catalog.printers.filter((p) => !override.has(p.id)), ...sessionDefs];
  return { ...catalog, printers };
}

/** Same network load as `usePrintersCatalog` without React (for tests or one-off use). */
export async function loadPrintersCatalogWithSession(urlPrefix: string): Promise<PrintersCatalog> {
  const builtInUrl = `${urlPrefix}printers.yaml`;
  const res = await fetch(builtInUrl, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Failed to load ${builtInUrl}: HTTP ${res.status}`);
  }
  const base = parsePrintersYamlText(await res.text());
  const merged = await mergeUserPrinterFragments(base, urlPrefix);
  return mergeSessionPrintersIntoCatalog(merged);
}
