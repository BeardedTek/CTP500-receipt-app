import { parse } from 'yaml';

/** Runtime printer id (YAML top-level key for each printer, or fragment filename). */
export type GattPrinterProfile = string | null;

export type PrinterDefinition = {
  id: string;
  discovery_name: string;
  description: string;
  model: string;
  prefix: string[];
  service: string;
  write: string;
  notify: string;
  mtu: number;
  postConnectBytes: Uint8Array | null;
};

export type PrintersCatalog = {
  printers: readonly PrinterDefinition[];
  extraOptionalServices: readonly string[];
};

export const META_EXTRA_KEY = 'extra_optional_services';

function hexToBytes(hex: string): Uint8Array {
  const s = hex.replaceAll(/\s+/g, '').toLowerCase();
  if (s.length % 2 !== 0) {
    throw new Error(`post_connect_write_hex must have even length: ${hex}`);
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) {
    out[i / 2] = Number.parseInt(s.slice(i, i + 2), 16);
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asStringArray(v: unknown, path: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new Error(`${path} must be a string array`);
  }
  return v as string[];
}

/** Build one printer definition from a YAML mapping (fragment file body or nested block under an id). */
export function printerDefinitionFromRaw(raw: Record<string, unknown>, id: string): PrinterDefinition {
  const discovery_name = raw.discovery_name;
  const description = raw.description;
  const model = raw.model;
  const prefix = raw.prefix;
  const service = raw.service;
  const write = raw.write;
  const notify = raw.notify;
  const mtuRaw = raw.mtu;
  const postHex = raw.post_connect_write_hex;

  if (typeof discovery_name !== 'string') throw new Error(`Printer "${id}": discovery_name must be a string`);
  if (typeof description !== 'string') throw new Error(`Printer "${id}": description must be a string`);
  if (typeof model !== 'string') throw new Error(`Printer "${id}": model must be a string`);
  if (typeof service !== 'string') throw new Error(`Printer "${id}": service must be a UUID string`);
  if (typeof write !== 'string') throw new Error(`Printer "${id}": write must be a UUID string`);
  if (typeof notify !== 'string') throw new Error(`Printer "${id}": notify must be a UUID string`);

  const prefixes = asStringArray(prefix, `Printer "${id}".prefix`);
  if (prefixes.length === 0) {
    throw new Error(`Printer "${id}": prefix must be non-empty`);
  }

  let mtu = 23;
  if (mtuRaw !== undefined) {
    if (typeof mtuRaw !== 'number' || !Number.isFinite(mtuRaw) || mtuRaw < 23) {
      throw new Error(`Printer "${id}": mtu must be a number >= 23`);
    }
    mtu = Math.floor(mtuRaw);
  }

  let postConnectBytes: Uint8Array | null = null;
  if (postHex !== undefined) {
    if (typeof postHex !== 'string') throw new Error(`Printer "${id}": post_connect_write_hex must be a string`);
    postConnectBytes = hexToBytes(postHex);
  }

  return {
    id,
    discovery_name,
    description,
    model,
    prefix: prefixes,
    service,
    write,
    notify,
    mtu,
    postConnectBytes,
  };
}

/** Parse a single `public/printers/<id>.yaml` fragment (root mapping = printer fields only). */
export function parsePrinterFragmentYaml(yamlText: string, printerId: string): PrinterDefinition {
  const doc = parse(yamlText) as unknown;
  if (!isRecord(doc)) {
    throw new Error(`Printer "${printerId}": YAML root must be a mapping`);
  }
  return printerDefinitionFromRaw(doc, printerId);
}

/** Optional `public/printers/manifest.yaml`: extra UUIDs + user printer ids (fragment filenames). */
export type UserPrintersManifest = {
  extraOptionalServices: string[];
  /** User printer ids = `public/printers/<id>.yaml` stems, appended after built-in `printers.yaml`. */
  printers: string[];
};

/** Parse user manifest under `public/printers/manifest.yaml`. */
export function parseUserPrintersManifestText(text: string): UserPrintersManifest {
  const doc = parse(text) as Record<string, unknown>;
  const extraRaw = doc[META_EXTRA_KEY];
  let extraOptionalServices: string[] = [];
  if (extraRaw !== undefined) {
    if (!Array.isArray(extraRaw) || extraRaw.some((x) => typeof x !== 'string')) {
      throw new Error(`manifest ${META_EXTRA_KEY} must be an array of UUID strings`);
    }
    extraOptionalServices = extraRaw as string[];
  }

  const listRaw = doc.printers ?? doc.printer_files;
  let printers: string[] = [];
  if (listRaw !== undefined) {
    if (!Array.isArray(listRaw) || listRaw.some((x) => typeof x !== 'string')) {
      throw new Error('manifest: "printers" must be an array of printer ids (filename stems)');
    }
    printers = listRaw as string[];
  }
  return { extraOptionalServices, printers };
}

/** Parse legacy monolithic `printers.yaml` (multiple printer keys at root). */
export function parsePrintersYamlText(yamlText: string): PrintersCatalog {
  const doc = parse(yamlText) as Record<string, unknown>;
  const extraRaw = doc[META_EXTRA_KEY];
  let extraOptionalServices: string[] = [];
  if (extraRaw !== undefined) {
    if (!Array.isArray(extraRaw) || extraRaw.some((x) => typeof x !== 'string')) {
      throw new Error(`${META_EXTRA_KEY} must be an array of UUID strings`);
    }
    extraOptionalServices = extraRaw as string[];
  }

  const printers: PrinterDefinition[] = [];

  for (const [id, raw] of Object.entries(doc)) {
    if (id === META_EXTRA_KEY) continue;
    if (!isRecord(raw)) {
      throw new Error(`Printer "${id}": expected a mapping`);
    }
    printers.push(printerDefinitionFromRaw(raw, id));
  }

  if (printers.length === 0) {
    throw new Error('printers.yaml: no printer definitions found');
  }

  return { printers, extraOptionalServices };
}

/** Normalizes `my_printer` or `my_printer.yaml` to a safe fragment filename stem. */
export function normalizePrinterFileStem(id: string): string {
  const stem = /\.ya?ml$/i.test(id) ? id.replace(/\.ya?ml$/i, '') : id;
  if (!/^[a-zA-Z0-9_-]+$/.test(stem)) {
    throw new Error(
      `Invalid printer id "${id}" (use letters, numbers, underscore, hyphen; optional .yaml suffix)`,
    );
  }
  return stem;
}

/** Parse nginx `autoindex_format json` (or compatible dev server) body → sorted printer stems. */
export function stemsFromNginxJsonAutoindex(jsonText: string): string[] | null {
  let data: unknown;
  try {
    data = JSON.parse(jsonText) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;

  const stems: string[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null || !('name' in item)) continue;
    const name = (item as { name: unknown }).name;
    if (typeof name !== 'string') continue;
    const t = (item as { type?: string }).type;
    if (t && t !== 'file' && t !== 'symlink') continue;
    if (!/\.ya?ml$/i.test(name)) continue;
    if (/^manifest\.ya?ml$/i.test(name)) continue;
    if (/^printers\.ya?ml$/i.test(name)) continue;
    const stem = name.replace(/\.ya?ml$/i, '');
    if (!/^[a-zA-Z0-9_-]+$/.test(stem)) continue;
    stems.push(stem);
  }

  stems.sort((a, b) => a.localeCompare(b));
  return stems;
}

/**
 * Merge user `public/printers/*.yaml` into the built-in catalog from `public/printers.yaml`.
 *
 * **Discovery:** `GET printers/` must return nginx JSON autoindex (Docker). Vite dev/preview serves
 * the same shape. Stems are sorted file names (excluding `manifest.yaml`).
 *
 * **Fallback:** If that response is missing or not JSON, use `printers:` from `manifest.yaml` if present.
 *
 * **Extras:** `extra_optional_services` from `manifest.yaml` are always merged when that file exists.
 */
export async function mergeUserPrinterFragments(
  base: PrintersCatalog,
  urlPrefix: string,
): Promise<PrintersCatalog> {
  const manifestUrl = `${urlPrefix}printers/manifest.yaml`;
  const indexUrl = `${urlPrefix}printers/`;

  const [idxRes, mfRes] = await Promise.all([
    fetch(indexUrl, { cache: 'no-store', headers: { Accept: 'application/json' } }),
    fetch(manifestUrl, { cache: 'no-store' }),
  ]);

  let manifestExtras: string[] = [];
  let manifestStems: string[] = [];
  if (mfRes.ok) {
    const m = parseUserPrintersManifestText(await mfRes.text());
    manifestExtras = m.extraOptionalServices;
    manifestStems = m.printers.map((id) => normalizePrinterFileStem(id));
  }

  let stemsFromDir: string[] | null = null;
  if (idxRes.ok) {
    stemsFromDir = stemsFromNginxJsonAutoindex(await idxRes.text());
  }

  const stems = stemsFromDir !== null ? stemsFromDir : manifestStems;

  if (stems.length === 0 && manifestExtras.length === 0) {
    return base;
  }

  const baseIds = new Set(base.printers.map((p) => p.id));
  const seenUser = new Set<string>();
  const extraPrinters: PrinterDefinition[] = [];

  for (const stem of stems) {
    if (baseIds.has(stem)) {
      throw new Error(
        `User printer "${stem}" conflicts with an id from printers.yaml; choose a different id`,
      );
    }
    if (seenUser.has(stem)) {
      throw new Error(`Duplicate user printer id: ${stem}`);
    }
    seenUser.add(stem);

    const fileUrl = `${urlPrefix}printers/${stem}.yaml`;
    const fr = await fetch(fileUrl, { cache: 'no-store' });
    if (!fr.ok) {
      throw new Error(`Failed to load user printer file ${fileUrl}: HTTP ${fr.status}`);
    }
    extraPrinters.push(parsePrinterFragmentYaml(await fr.text(), stem));
    baseIds.add(stem);
  }

  const mergedExtras = [...base.extraOptionalServices];
  for (const u of manifestExtras) {
    if (!mergedExtras.some((x) => x.toLowerCase() === u.toLowerCase())) {
      mergedExtras.push(u);
    }
  }

  return {
    printers: [...base.printers, ...extraPrinters],
    extraOptionalServices: mergedExtras,
  };
}

export function getWebBluetoothOptionalServices(catalog: PrintersCatalog): BluetoothServiceUUID[] {
  const uuids = new Set<string>();
  for (const p of catalog.printers) {
    uuids.add(p.service);
  }
  for (const u of catalog.extraOptionalServices) {
    uuids.add(u);
  }
  return [...uuids];
}

export function getBluetoothNamePrefixFilters(catalog: PrintersCatalog): Array<{ namePrefix: string }> {
  return catalog.printers.flatMap((p) => p.prefix.map((namePrefix) => ({ namePrefix })));
}

export function getPrefixSummaryForLog(catalog: PrintersCatalog): string {
  return catalog.printers.flatMap((p) => p.prefix).join(', ');
}
