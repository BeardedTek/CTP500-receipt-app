import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getBluetoothNamePrefixFilters,
  getWebBluetoothOptionalServices,
  getPrefixSummaryForLog,
  type GattPrinterProfile,
  type PrinterDefinition,
} from '../config/parsePrintersYaml';
import { usePrintersCatalog, type PrintersCatalogLoadState } from '../config/usePrintersCatalog';
import {
  getWebBluetoothEnvironment,
  type WebBluetoothEnvironment,
} from '../services/bluetooth/webBluetoothEnvironment';

export type { GattPrinterProfile };

interface ConnectionState {
  device: BluetoothDevice | null;
  status: 'disconnected' | 'scanning' | 'connecting' | 'connected';
  error: string | null;
  batteryLevel: number | null;
  batteryVoltage: string | null;
  mtu: number;
}

export type BluetoothLogLevel = 'info' | 'error';

interface UseBluetoothOptions {
  onLog?: (level: BluetoothLogLevel, message: string) => void;
}

interface UseBluetoothReturn {
  connection: ConnectionState;
  isSupported: boolean;
  webBluetoothEnv: WebBluetoothEnvironment;
  gattProfile: GattPrinterProfile;
  printersCatalog: PrintersCatalogLoadState;
  startScan: () => void;
  disconnect: () => Promise<void>;
  writeData: (data: Uint8Array) => Promise<void>;
  printerName: string | null;
}

const BATT_MIN_MV = 3300;
const BATT_MAX_MV = 4200;

function parseBatteryFromNotify(data: DataView): { voltage: string; percentage: number } | null {
  const text = new TextDecoder('ascii').decode(data.buffer).replace(/\0+$/, '');
  const match = text.match(/VOLT=(\d+)mv/i);
  if (match) {
    const mv = parseInt(match[1], 10);
    const pct = Math.round(((mv - BATT_MIN_MV) / (BATT_MAX_MV - BATT_MIN_MV)) * 100);
    return {
      voltage: `${mv}mv`,
      percentage: Math.max(0, Math.min(100, pct)),
    };
  }
  return null;
}

export function useBluetooth(options: UseBluetoothOptions = {}): UseBluetoothReturn {
  const printersCatalog = usePrintersCatalog();
  const catalog = printersCatalog.status === 'ready' ? printersCatalog.catalog : null;

  const [connection, setConnection] = useState<ConnectionState>({
    device: null,
    status: 'disconnected',
    error: null,
    batteryLevel: null,
    batteryVoltage: null,
    mtu: 23,
  });
  const webBluetoothEnv = useMemo(() => getWebBluetoothEnvironment(), []);
  const isSupported = webBluetoothEnv.canUse;
  const [server, setServer] = useState<BluetoothRemoteGATTServer | null>(null);
  const [writeChar, setWriteChar] = useState<BluetoothRemoteGATTCharacteristic | null>(null);
  const [notifyChar, setNotifyChar] = useState<BluetoothRemoteGATTCharacteristic | null>(null);
  const [printerName, setPrinterName] = useState<string | null>(null);
  /** Prefer write-with-response when the characteristic supports it (CTP500); Mini uses write-without-response only. */
  const [writeUsesResponse, setWriteUsesResponse] = useState(true);
  const [gattProfile, setGattProfile] = useState<GattPrinterProfile>(null);
  const log = useCallback(
    (level: BluetoothLogLevel, message: string) => {
      options.onLog?.(level, message);
      if (level === 'error') {
        console.error(`[Bluetooth] ${message}`);
      } else {
        console.info(`[Bluetooth] ${message}`);
      }
    },
    [options.onLog],
  );

  const clearConnection = useCallback(() => {
    setServer(null);
    setWriteChar(null);
    setNotifyChar(null);
    setWriteUsesResponse(true);
    setGattProfile(null);
    setPrinterName(null);
    setConnection((prev) => ({
      ...prev,
      device: null,
      status: 'disconnected',
      mtu: 23,
    }));
  }, []);

  const disconnect = useCallback(async () => {
    if (server) {
      try {
        if (notifyChar) {
          await notifyChar.stopNotifications();
        }
        await server.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
    clearConnection();
    log('info', 'Disconnected from printer');
  }, [server, notifyChar, clearConnection, log]);

  const handleNotify = useCallback((event: Event) => {
    const char = event.target as BluetoothRemoteGATTCharacteristic;
    const data = char.value!;
    const text = new TextDecoder('ascii').decode(data.buffer).replace(/\0+$/, '');
    log('info', `Printer status: ${text}`);

    const batt = parseBatteryFromNotify(data);
    if (batt) {
      setConnection((prev) => ({
        ...prev,
        batteryVoltage: batt.voltage,
        batteryLevel: batt.percentage,
      }));
    }
  }, [log]);

  const connectToDevice = useCallback(
    async (device: BluetoothDevice) => {
      if (!catalog) {
        log('error', 'Printer definitions are not loaded yet');
        return;
      }

      setConnection((prev) => ({ ...prev, status: 'connecting', error: null }));
      log('info', `Connecting to ${device.name ?? device.id}`);

      try {
        const gatt = device.gatt!;
        await gatt.connect();

        const connectionResult = await (async (): Promise<{
          write: BluetoothRemoteGATTCharacteristic;
          notify: BluetoothRemoteGATTCharacteristic;
          matched: PrinterDefinition;
        } | null> => {
          for (const p of catalog.printers) {
            try {
              const serv = await gatt.getPrimaryService(p.service);
              const [write, notify] = await Promise.all([
                serv.getCharacteristic(p.write),
                serv.getCharacteristic(p.notify),
              ]);
              return { write, notify, matched: p };
            } catch {
              continue;
            }
          }
          return null;
        })();

        if (!connectionResult) {
          throw new Error('No supported printer GATT profile matched this device');
        }

        const { write, notify, matched } = connectionResult;

        const negotiatedMtu = matched.mtu;
        setGattProfile(matched.id);

        const useResponse = !!write.properties.write;
        setWriteUsesResponse(useResponse);

        setServer(gatt);
        setWriteChar(write);
        setNotifyChar(notify);
        setPrinterName(device.name ?? null);

        notify.addEventListener('characteristicvaluechanged', handleNotify);
        await notify.startNotifications();

        if (matched.postConnectBytes) {
          const buf = new Uint8Array(matched.postConnectBytes);
          await write.writeValueWithResponse(buf);
        }

        setConnection((prev) => ({
          ...prev,
          device,
          status: 'connected',
          mtu: negotiatedMtu,
        }));
        log(
          'info',
          `Connected (${matched.id}: ${matched.discovery_name} / ${matched.model}, MTU ~${negotiatedMtu} bytes)`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setConnection((prev) => ({ ...prev, status: 'disconnected', error: msg }));
        log('error', `Connection error: ${msg}`);
        clearConnection();
      }
    },
    [handleNotify, clearConnection, log, catalog],
  );

  const startScan = useCallback(() => {
    if (!isSupported || !navigator.bluetooth) {
      log('error', `Web Bluetooth not available: ${webBluetoothEnv.reason}`);
      return;
    }
    if (!catalog) {
      if (printersCatalog.status === 'loading') {
        log('error', 'Printer definitions are still loading; wait a moment and try again.');
      } else if (printersCatalog.status === 'error') {
        log('error', `Printer definitions failed to load: ${printersCatalog.message}`);
      }
      return;
    }

    setConnection((prev) => ({ ...prev, status: 'scanning', error: null }));
    log('info', `Scanning for compatible printers (${getPrefixSummaryForLog(catalog)})...`);

    navigator.bluetooth
      .requestDevice({
        filters: getBluetoothNamePrefixFilters(catalog),
        optionalServices: getWebBluetoothOptionalServices(catalog),
      })
      .then((device) => {
        log('info', `Found: ${device.name}`);
        void connectToDevice(device);
      })
      .catch((e) => {
        if (e instanceof Error && e.name !== 'NotFoundError') {
          const msg = e.message;
          setConnection((prev) => ({ ...prev, status: 'disconnected', error: msg }));
          log('error', `Scan error: ${msg}`);
        } else {
          setConnection((prev) => ({ ...prev, status: 'disconnected' }));
        }
      });
  }, [isSupported, connectToDevice, webBluetoothEnv.reason, log, catalog, printersCatalog]);

  const writeData = useCallback(
    async (data: Uint8Array) => {
      if (!writeChar) throw new Error('Not connected');
      const mtu = connection.mtu || 23;
      const chunkSize = Math.max(20, Math.min(504, mtu - 3));
      const totalChunks = Math.ceil(data.length / chunkSize);

      for (let i = 0; i < data.length; i += chunkSize) {
        const chunk = data.slice(i, i + chunkSize);
        if (writeUsesResponse) {
          await writeChar.writeValueWithResponse(chunk);
        } else {
          await writeChar.writeValueWithoutResponse(chunk);
        }
        if (totalChunks > 10 && Math.floor(i / chunkSize) % 10 === 0) {
          log('info', `Sending... ${Math.min(i + chunkSize, data.length)}/${data.length} bytes`);
        }
      }
      log('info', `Sent ${data.length} bytes`);
    },
    [writeChar, writeUsesResponse, connection.mtu, log],
  );

  useEffect(() => {
    return () => {
      if (notifyChar) {
        notifyChar.removeEventListener('characteristicvaluechanged', handleNotify);
      }
    };
  }, [notifyChar, handleNotify]);

  return {
    connection,
    isSupported,
    webBluetoothEnv,
    gattProfile,
    printersCatalog,
    startScan,
    disconnect,
    writeData,
    printerName,
  };
}
