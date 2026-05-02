import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { usePrintersCatalog } from '../config/usePrintersCatalog';
import { getWebBluetoothOptionalServices } from '../config/parsePrintersYaml';
import { getWebBluetoothEnvironment } from '../services/bluetooth/webBluetoothEnvironment';
import {
  enumerateGattServer,
  normalizeUuid,
  type DiscoveredCharacteristic,
  type DiscoveredService,
} from '../services/bluetooth/enumerateGatt';
import {
  COMMON_OPTIONAL,
  CTP500_NOTIFY,
  CTP500_SERVICE,
  CTP500_WRITE,
  EXTRA_OPTIONAL,
  MINI_NOTIFY,
  MINI_SERVICE,
  MINI_WRITE,
} from './printerDiscovery/discoveryConstants';

type Step = 'idle' | 'picking' | 'enumerating' | 'done' | 'error';

function uniqServices(ids: BluetoothServiceUUID[]): BluetoothServiceUUID[] {
  const s = new Set(ids.map((u) => String(u).toLowerCase()));
  return [...s];
}

function buildOptionalServicesForDiscovery(catalogServices: BluetoothServiceUUID[]): BluetoothServiceUUID[] {
  const base = [...catalogServices, ...EXTRA_OPTIONAL, ...COMMON_OPTIONAL];
  return uniqServices(base);
}

function yamlScalar(s: string): string {
  if (s === '' || /[:#@[\]{}]|^\s|\s$|["']/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

function yamlList(items: string[]): string {
  return items.map((p) => `    - ${yamlScalar(p)}`).join('\n');
}

function suggestFromDiscovery(
  services: DiscoveredService[],
  deviceName: string | undefined,
): {
  printerId: string;
  discoveryName: string;
  description: string;
  model: string;
  prefix: string[];
  service: string;
  write: string;
  notify: string;
  mtu: number;
  postConnectHex: string;
  matchNote: string;
} {
  const name = deviceName?.trim() || 'unknown_device';
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || 'new_printer';

  const ctpSvc = services.find((s) => normalizeUuid(s.uuid) === normalizeUuid(CTP500_SERVICE));
  const miniSvc = services.find((s) => normalizeUuid(s.uuid) === normalizeUuid(MINI_SERVICE));

  if (ctpSvc && !ctpSvc.error) {
    const hasW = ctpSvc.characteristics.some((c) => normalizeUuid(c.uuid) === normalizeUuid(CTP500_WRITE));
    const hasN = ctpSvc.characteristics.some((c) => normalizeUuid(c.uuid) === normalizeUuid(CTP500_NOTIFY));
    if (hasW && hasN) {
      return {
        printerId: slug,
        discoveryName: name,
        description: 'CTP500-class (Nordic UART vendor service detected)',
        model: 'CTP500-compatible',
        prefix: [name.length > 20 ? `${name.slice(0, 12)}` : name],
        service: CTP500_SERVICE,
        write: CTP500_WRITE,
        notify: CTP500_NOTIFY,
        mtu: 23,
        postConnectHex: '1e4703',
        matchNote: 'Detected CTP500 vendor service and expected write/notify characteristics.',
      };
    }
  }

  if (miniSvc && !miniSvc.error) {
    const hasW = miniSvc.characteristics.some((c) => normalizeUuid(c.uuid) === normalizeUuid(MINI_WRITE));
    const hasN = miniSvc.characteristics.some((c) => normalizeUuid(c.uuid) === normalizeUuid(MINI_NOTIFY));
    if (hasW && hasN) {
      return {
        printerId: 'mini_ae30',
        discoveryName: 'Mini AE30',
        description: 'Mini Printer (AE30 GATT block detected)',
        model: 'Mini AE30',
        prefix: ['Mini Printer'],
        service: MINI_SERVICE,
        write: MINI_WRITE,
        notify: MINI_NOTIFY,
        mtu: 512,
        postConnectHex: '',
        matchNote: 'Detected Mini AE30 primary service and AE01/AE02 characteristics.',
      };
    }
  }

  const firstWithTx = services.find(
    (s) =>
      !s.error &&
      s.characteristics.some((c) => c.write || c.writeWithoutResponse) &&
      s.characteristics.some((c) => c.notify || c.indicate),
  );

  if (firstWithTx) {
    const writeC = firstWithTx.characteristics.find((c) => c.write || c.writeWithoutResponse);
    const notifyC = firstWithTx.characteristics.find((c) => c.notify || c.indicate);
    return {
      printerId: slug,
      discoveryName: name,
      description: 'Unknown BLE device — pick write/notify UUIDs below if defaults look wrong',
      model: 'Unknown',
      prefix: [name.length > 24 ? `${name.slice(0, 20)}` : name],
      service: firstWithTx.uuid,
      write: writeC?.uuid ?? '',
      notify: notifyC?.uuid ?? '',
      mtu: 23,
      postConnectHex: '',
      matchNote:
        'No known CTP500/Mini profile matched. Suggested first service that has both a writable and a notifiable characteristic.',
    };
  }

  return {
    printerId: slug,
    discoveryName: name,
    description: 'Unknown — no obvious print service; fill UUIDs manually from the table below',
    model: 'Unknown',
    prefix: [name],
    service: services[0]?.uuid ?? '',
    write: '',
    notify: '',
    mtu: 23,
    postConnectHex: '',
    matchNote: 'Could not auto-pick a print channel. Inspect services/characteristics and edit fields.',
  };
}

export default function PrinterDiscoveryPage() {
  const printersCatalog = usePrintersCatalog();
  const webEnv = useMemo(() => getWebBluetoothEnvironment(), []);

  const optionalServices = useMemo(() => {
    if (printersCatalog.status === 'ready') {
      return buildOptionalServicesForDiscovery(getWebBluetoothOptionalServices(printersCatalog.catalog));
    }
    return buildOptionalServicesForDiscovery([
      CTP500_SERVICE,
      CTP500_WRITE,
      CTP500_NOTIFY,
      MINI_SERVICE,
      MINI_WRITE,
      MINI_NOTIFY,
    ]);
  }, [printersCatalog]);

  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [deviceLabel, setDeviceLabel] = useState<string | null>(null);
  const [services, setServices] = useState<DiscoveredService[] | null>(null);
  const [serverRef, setServerRef] = useState<BluetoothRemoteGATTServer | null>(null);

  const [printerId, setPrinterId] = useState('');
  const [discoveryName, setDiscoveryName] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState('');
  const [prefixText, setPrefixText] = useState('');
  const [service, setService] = useState('');
  const [write, setWrite] = useState('');
  const [notify, setNotify] = useState('');
  const [mtu, setMtu] = useState('23');
  const [postHex, setPostHex] = useState('');
  const [matchNote, setMatchNote] = useState('');

  const disconnect = useCallback(async () => {
    if (serverRef) {
      try {
        await serverRef.disconnect();
      } catch {
        /* ignore */
      }
    }
    setServerRef(null);
    setServices(null);
    setDeviceLabel(null);
    setStep('idle');
  }, [serverRef]);

  const pickDevice = useCallback(async () => {
    if (!webEnv.canUse || !navigator.bluetooth) {
      setError('Web Bluetooth is not available in this context (use HTTPS and Chrome).');
      setStep('error');
      return;
    }
    setError(null);
    setStep('picking');
    let gatt: BluetoothRemoteGATTServer | null = null;
    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: optionalServices,
      });
      setDeviceLabel(device.name ?? device.id);
      setStep('enumerating');
      gatt = device.gatt ?? null;
      if (!gatt) throw new Error('No GATT server on this device.');
      await gatt.connect();
      setServerRef(gatt);
      const list = await enumerateGattServer(gatt);
      setServices(list);

      const suggestion = suggestFromDiscovery(list, device.name ?? undefined);
      setPrinterId(suggestion.printerId);
      setDiscoveryName(suggestion.discoveryName);
      setDescription(suggestion.description);
      setModel(suggestion.model);
      setPrefixText(suggestion.prefix.join('\n'));
      setService(suggestion.service);
      setWrite(suggestion.write);
      setNotify(suggestion.notify);
      setMtu(String(suggestion.mtu));
      setPostHex(suggestion.postConnectHex);
      setMatchNote(suggestion.matchNote);
      setStep('done');
    } catch (e) {
      if (gatt) {
        try {
          await gatt.disconnect();
        } catch {
          /* ignore */
        }
      }
      if (e instanceof Error && e.name === 'NotFoundError') {
        setStep('idle');
        setError(null);
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setStep('error');
      }
      setServerRef(null);
      setServices(null);
    }
  }, [optionalServices, webEnv.canUse]);

  const charsForSelectedService = useMemo((): DiscoveredCharacteristic[] => {
    if (!services || !service) return [];
    const svc = services.find((s) => normalizeUuid(s.uuid) === normalizeUuid(service));
    return svc?.characteristics ?? [];
  }, [services, service]);

  const generatedYaml = useMemo(() => {
    const prefixes = prefixText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!printerId.trim() || !prefixes.length || !service || !write || !notify) {
      return '';
    }
    const mtuNum = Number.parseInt(mtu, 10);
    const mtuLine = Number.isFinite(mtuNum) && mtuNum >= 23 ? `  mtu: ${mtuNum}\n` : '';
    const postLine =
      postHex.trim().length > 0 ? `  post_connect_write_hex: ${yamlScalar(postHex.trim())}\n` : '';
    return `${printerId.trim()}:
  discovery_name: ${yamlScalar(discoveryName)}
  description: ${yamlScalar(description)}
  model: ${yamlScalar(model)}
  prefix:
${yamlList(prefixes)}
  service: ${yamlScalar(service)}
  write: ${yamlScalar(write)}
  notify: ${yamlScalar(notify)}
${mtuLine}${postLine}`;
  }, [printerId, discoveryName, description, model, prefixText, service, write, notify, mtu, postHex]);

  const copyYaml = useCallback(async () => {
    if (!generatedYaml) return;
    try {
      await navigator.clipboard.writeText(generatedYaml);
    } catch {
      window.prompt('Copy this YAML:', generatedYaml);
    }
  }, [generatedYaml]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">Add printer (BLE discovery)</h1>
        <Link to="/" className="text-sm text-blue-600 hover:underline">
          ← Back to receipt
        </Link>
      </div>

      <p className="text-sm text-gray-600">
        Opens the system Bluetooth picker for <strong>all</strong> nearby BLE devices. After you connect, this page
        lists GATT services and characteristics and drafts a <code className="rounded bg-gray-100 px-1">printers.yaml</code>{' '}
        block. Add that block to <code className="rounded bg-gray-100 px-1">public/printers.yaml</code> on the server and
        reload the app.
      </p>

      {!webEnv.canUse && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">{webEnv.headline}</p>
          <p className="mt-1">{webEnv.detail}</p>
        </div>
      )}

      {printersCatalog.status === 'loading' && <p className="text-sm text-gray-600">Loading existing printer catalog…</p>}
      {printersCatalog.status === 'error' && (
        <p className="text-sm text-red-600">Could not load printers.yaml ({printersCatalog.message}). Discovery still works with built-in UUID list.</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void pickDevice()}
          disabled={!webEnv.canUse || step === 'picking' || step === 'enumerating' || printersCatalog.status === 'loading'}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-gray-400"
        >
          {step === 'picking' || step === 'enumerating' ? 'Working…' : 'Choose Bluetooth device…'}
        </button>
        {(serverRef || step === 'done' || step === 'error') && (
          <button type="button" onClick={() => void disconnect()} className="rounded border px-4 py-2 text-sm">
            Reset
          </button>
        )}
      </div>
      {printersCatalog.status === 'loading' && webEnv.canUse && (
        <p className="text-xs text-gray-500">Waiting for printers.yaml so optionalServices can include your existing printer UUIDs…</p>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <p className="font-medium">Error</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      {deviceLabel && (
        <p className="text-sm">
          <span className="text-gray-600">Selected:</span> <span className="font-medium">{deviceLabel}</span>
        </p>
      )}

      {matchNote && step === 'done' && (
        <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
          <p className="font-medium">Heuristic</p>
          <p className="mt-1">{matchNote}</p>
        </div>
      )}

      {services && services.length > 0 && (
        <div className="rounded-lg border p-3">
          <h2 className="mb-2 font-semibold">GATT tree</h2>
          <div className="max-h-64 space-y-2 overflow-auto text-xs font-mono">
            {services.map((svc) => (
              <div key={svc.uuid} className="border-b pb-2">
                <div className="font-semibold text-gray-800">{svc.uuid}</div>
                {svc.error && <div className="text-red-600">{svc.error}</div>}
                <ul className="ml-2 mt-1 space-y-0.5 text-gray-700">
                  {svc.characteristics.map((c) => (
                    <li key={c.uuid}>
                      {c.uuid}{' '}
                      <span className="text-gray-500">
                        [
                        {[
                          c.read && 'read',
                          c.write && 'write',
                          c.writeWithoutResponse && 'writeNR',
                          c.notify && 'notify',
                          c.indicate && 'indicate',
                        ]
                          .filter(Boolean)
                          .join(', ')}
                        ]
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'done' && services && (
        <div className="space-y-3 rounded-lg border p-4">
          <h2 className="font-semibold">YAML block (edit, then copy into public/printers.yaml)</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-sm">
              <span className="text-gray-700">printer_id (YAML key)</span>
              <input
                value={printerId}
                onChange={(e) => setPrinterId(e.target.value)}
                className="mt-0.5 w-full rounded border px-2 py-1 font-mono text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="text-gray-700">discovery_name</span>
              <input
                value={discoveryName}
                onChange={(e) => setDiscoveryName(e.target.value)}
                className="mt-0.5 w-full rounded border px-2 py-1 text-sm"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="text-gray-700">description</span>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-0.5 w-full rounded border px-2 py-1 text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="text-gray-700">model</span>
              <input value={model} onChange={(e) => setModel(e.target.value)} className="mt-0.5 w-full rounded border px-2 py-1 text-sm" />
            </label>
            <label className="text-sm">
              <span className="text-gray-700">mtu</span>
              <input value={mtu} onChange={(e) => setMtu(e.target.value)} className="mt-0.5 w-full rounded border px-2 py-1 font-mono text-sm" />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="text-gray-700">prefix (one per line, for Web Bluetooth namePrefix filters)</span>
              <textarea
                value={prefixText}
                onChange={(e) => setPrefixText(e.target.value)}
                rows={3}
                className="mt-0.5 w-full rounded border px-2 py-1 font-mono text-sm"
              />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="text-gray-700">service UUID</span>
              <select
                value={service}
                onChange={(e) => setService(e.target.value)}
                className="mt-0.5 w-full rounded border px-2 py-1 font-mono text-sm"
              >
                <option value="">— select —</option>
                {services.map((s) => (
                  <option key={s.uuid} value={s.uuid}>
                    {s.uuid}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-gray-700">write characteristic</span>
              <select
                value={write}
                onChange={(e) => setWrite(e.target.value)}
                className="mt-0.5 w-full rounded border px-2 py-1 font-mono text-sm"
              >
                <option value="">— select —</option>
                {charsForSelectedService
                  .filter((c) => c.write || c.writeWithoutResponse)
                  .map((c) => (
                    <option key={c.uuid} value={c.uuid}>
                      {c.uuid}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-gray-700">notify characteristic</span>
              <select
                value={notify}
                onChange={(e) => setNotify(e.target.value)}
                className="mt-0.5 w-full rounded border px-2 py-1 font-mono text-sm"
              >
                <option value="">— select —</option>
                {charsForSelectedService
                  .filter((c) => c.notify || c.indicate)
                  .map((c) => (
                    <option key={c.uuid} value={c.uuid}>
                      {c.uuid}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="text-gray-700">post_connect_write_hex (optional, even length)</span>
              <input
                value={postHex}
                onChange={(e) => setPostHex(e.target.value)}
                placeholder="e.g. 1e4703 for CTP500"
                className="mt-0.5 w-full rounded border px-2 py-1 font-mono text-sm"
              />
            </label>
          </div>

          <textarea
            readOnly
            value={generatedYaml || '(fill required fields)'}
            rows={14}
            className="w-full rounded border bg-gray-50 p-2 font-mono text-xs"
          />
          <button
            type="button"
            disabled={!generatedYaml}
            onClick={() => void copyYaml()}
            className="rounded bg-violet-600 px-3 py-2 text-sm font-medium text-white disabled:bg-gray-300"
          >
            Copy YAML
          </button>
        </div>
      )}
    </div>
  );
}
