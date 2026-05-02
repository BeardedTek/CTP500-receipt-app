export type DiscoveredCharacteristic = {
  uuid: string;
  read: boolean;
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  indicate: boolean;
};

export type DiscoveredService = {
  uuid: string;
  characteristics: DiscoveredCharacteristic[];
  error?: string;
};

function charProps(p: BluetoothCharacteristicProperties): Omit<DiscoveredCharacteristic, 'uuid'> {
  return {
    read: !!p.read,
    write: !!p.write,
    writeWithoutResponse: !!p.writeWithoutResponse,
    notify: !!p.notify,
    indicate: !!p.indicate,
  };
}

/** Normalize UUID for comparison (Chrome returns lowercase 128-bit strings). */
export function normalizeUuid(uuid: string): string {
  return uuid.toLowerCase();
}

/**
 * Enumerate all primary services and characteristics after a GATT connection.
 * Requires `getPrimaryServices` (Chrome; not all Web Bluetooth stacks implement it).
 */
export async function enumerateGattServer(server: BluetoothRemoteGATTServer): Promise<DiscoveredService[]> {
  const raw = (server as unknown as { getPrimaryServices?: () => Promise<BluetoothRemoteGATTService[]> })
    .getPrimaryServices;
  if (typeof raw !== 'function') {
    throw new Error('This browser does not support getPrimaryServices(); try Chrome on desktop or Android.');
  }

  const services = await raw.call(server);
  const out: DiscoveredService[] = [];

  for (const svc of services) {
    try {
      const rawChars = (svc as unknown as { getCharacteristics?: () => Promise<BluetoothRemoteGATTCharacteristic[]> })
        .getCharacteristics;
      if (typeof rawChars !== 'function') {
        out.push({ uuid: svc.uuid, characteristics: [], error: 'getCharacteristics() not supported' });
        continue;
      }
      const characteristics = await rawChars.call(svc);
      out.push({
        uuid: svc.uuid,
        characteristics: characteristics.map((c) => ({
          uuid: c.uuid,
          ...charProps(c.properties),
        })),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      out.push({ uuid: svc.uuid, characteristics: [], error: msg });
    }
  }

  return out;
}
