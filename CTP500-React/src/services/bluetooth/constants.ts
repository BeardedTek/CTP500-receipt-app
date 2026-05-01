// BLE UUIDs for CTP500 thermal printer (Nordic UART–style vendor service)
export const WRITE_CHAR_UUID = '49535343-8841-43f4-a8d4-ecbe34729bb3';
export const NOTIFY_CHAR_UUID = '49535343-1e4d-4bd9-ba61-23c647249616';
export const SERVICE_UUID = '49535343-fe7d-4ae5-8fa9-9fafd205e455';

/** "Mini Printer-xxxx" and similar — vendor block seen in BLE dump */
export const MINI_SERVICE_UUID = '0000ae30-0000-1000-8000-00805f9b34fb';
export const MINI_WRITE_CHAR_UUID = '0000ae01-0000-1000-8000-00805f9b34fb';
export const MINI_NOTIFY_CHAR_UUID = '0000ae02-0000-1000-8000-00805f9b34fb';

/** All primary services the app may open (Web Bluetooth optionalServices). */
export const OPTIONAL_GATT_SERVICES = [
  SERVICE_UUID,
  MINI_SERVICE_UUID,
  '0000ae3a-0000-1000-8000-00805f9b34fb',
  '0000af30-0000-1000-8000-00805f9b34fb',
];

// Supported printer names
export const PRINTER_NAME_RE = /S\s+(Pink|Blue|White|Black)\s+Printer/i;
export const PRINTER_NAME_PREFIXES = ['S ', 'Mini Printer'];

// Battery voltage range
export const BATT_MIN_MV = 3300;
export const BATT_MAX_MV = 4200;

// Printer width in pixels
export const PRINTER_WIDTH = 384;

/** Receipt header logo: scaled to fit printer width and this max height (px), centered on white. */
export const RECEIPT_LOGO_MAX_HEIGHT_PX = 75;