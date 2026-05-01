import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  WRITE_CHAR_UUID,
  NOTIFY_CHAR_UUID,
  SERVICE_UUID,
  MINI_SERVICE_UUID,
  MINI_WRITE_CHAR_UUID,
  MINI_NOTIFY_CHAR_UUID,
  OPTIONAL_GATT_SERVICES,
  PRINTER_NAME_PREFIXES,
} from '../services/bluetooth/constants';
import {
  getWebBluetoothEnvironment,
  type WebBluetoothEnvironment,
} from '../services/bluetooth/webBluetoothEnvironment';

interface ConnectionState {
  device: BluetoothDevice | null;
  status: 'disconnected' | 'scanning' | 'connecting' | 'connected';
  error: string | null;
  batteryLevel: number | null;
  batteryVoltage: string | null;
  mtu: number;
}

export type GattPrinterProfile = 'ctp500' | 'mini_ae30' | null;
export type BluetoothLogLevel = 'info' | 'error';

interface UseBluetoothOptions {
  onLog?: (level: BluetoothLogLevel, message: string) => void;
}

interface UseBluetoothReturn {
  connection: ConnectionState;
  isSupported: boolean;
  webBluetoothEnv: WebBluetoothEnvironment;
  gattProfile: GattPrinterProfile;
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
      setConnection((prev) => ({ ...prev, status: 'connecting', error: null }));
      log('info', `Connecting to ${device.name ?? device.id}`);

      try {
        const gatt = device.gatt!;
        await gatt.connect();

        let serv: BluetoothRemoteGATTService;
        let write: BluetoothRemoteGATTCharacteristic;
        let notify: BluetoothRemoteGATTCharacteristic;
        let negotiatedMtu = 23;
        let profile: 'ctp500' | 'mini_ae30';

        try {
          serv = await gatt.getPrimaryService(SERVICE_UUID);
          [write, notify] = await Promise.all([
            serv.getCharacteristic(WRITE_CHAR_UUID),
            serv.getCharacteristic(NOTIFY_CHAR_UUID),
          ]);
          profile = 'ctp500';
          setGattProfile('ctp500');
        } catch {
          serv = await gatt.getPrimaryService(MINI_SERVICE_UUID);
          [write, notify] = await Promise.all([
            serv.getCharacteristic(MINI_WRITE_CHAR_UUID),
            serv.getCharacteristic(MINI_NOTIFY_CHAR_UUID),
          ]);
          profile = 'mini_ae30';
          negotiatedMtu = 512;
          setGattProfile('mini_ae30');
        }

        const useResponse = !!write.properties.write;
        setWriteUsesResponse(useResponse);

        setServer(gatt);
        setWriteChar(write);
        setNotifyChar(notify);
        setPrinterName(device.name ?? null);

        notify.addEventListener('characteristicvaluechanged', handleNotify);
        await notify.startNotifications();

        if (profile === 'ctp500') {
          await write.writeValueWithResponse(new Uint8Array([0x1e, 0x47, 0x03]));
        }

        setConnection((prev) => ({
          ...prev,
          device,
          status: 'connected',
          mtu: negotiatedMtu,
        }));
        log('info', `Connected (${profile}, MTU ~${negotiatedMtu} bytes)`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setConnection((prev) => ({ ...prev, status: 'disconnected', error: msg }));
        log('error', `Connection error: ${msg}`);
        clearConnection();
      }
    },
    [handleNotify, clearConnection, log],
  );

  const startScan = useCallback(() => {
    if (!isSupported || !navigator.bluetooth) {
      log('error', `Web Bluetooth not available: ${webBluetoothEnv.reason}`);
      return;
    }
    setConnection((prev) => ({ ...prev, status: 'scanning', error: null }));
    log('info', `Scanning for compatible printers (${PRINTER_NAME_PREFIXES.join(', ')})...`);

    navigator.bluetooth
      .requestDevice({
        filters: PRINTER_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
        optionalServices: [...OPTIONAL_GATT_SERVICES],
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
  }, [isSupported, connectToDevice, webBluetoothEnv.reason, log]);

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
    startScan,
    disconnect,
    writeData,
    printerName,
  };
}
