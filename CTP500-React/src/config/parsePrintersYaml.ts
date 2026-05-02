import { parse } from 'yaml';

/** Runtime printer id (YAML top-level key for each printer). */
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

const META_EXTRA_KEY = 'extra_optional_services';

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

/** Parse and validate `printers.yaml` text (from network or bundled string). */
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

    printers.push({
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
    });
  }

  if (printers.length === 0) {
    throw new Error('printers.yaml: no printer definitions found');
  }

  return { printers, extraOptionalServices };
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
