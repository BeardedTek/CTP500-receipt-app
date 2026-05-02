/** CTP500 vendor UART-style GATT (from printer catalog). */
export const CTP500_SERVICE = '49535343-fe7d-4ae5-8fa9-9fafd205e455';
export const CTP500_WRITE = '49535343-8841-43f4-a8d4-ecbe34729bb3';
export const CTP500_NOTIFY = '49535343-1e4d-4bd9-ba61-23c647249616';

/** Mini AE30 block (from printer catalog). */
export const MINI_SERVICE = '0000ae30-0000-1000-8000-00805f9b34fb';
export const MINI_WRITE = '0000ae01-0000-1000-8000-00805f9b34fb';
export const MINI_NOTIFY = '0000ae02-0000-1000-8000-00805f9b34fb';

/** Extra services often needed for Mini firmware paths (optionalServices). */
export const EXTRA_OPTIONAL = [
  '0000ae3a-0000-1000-8000-00805f9b34fb',
  '0000af30-0000-1000-8000-00805f9b34fb',
] as const;

/** Common services that help discovery without narrowing the picker. */
export const COMMON_OPTIONAL = ['battery_service', 'device_information', 'generic_access'] as const;
