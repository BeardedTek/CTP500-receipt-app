import type { ProcessedImage } from '../image/ImageProcessor';
import { formatMessage, MINI_CMD } from './miniAe30Protocol';

export type MiniWriteFn = (data: Uint8Array) => Promise<void>;

/**
 * Cat-Printer / NaitLee multi-byte payloads are little-endian (see `int_to_bytes`).
 * @see https://github.com/NaitLee/Cat-Printer/blob/main/printer_lib/commander.py
 */
function u16LE(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >> 8) & 0xff]);
}

const INTER_PACKET_MS = 25;

/** Hard-coded start job (CRC position fixed in firmware). */
const START_PRINTING = new Uint8Array([0x51, 0x78, 0xa3, 0x00, 0x01, 0x00, 0x00, 0x00, 0xff]);

/** Some boards expect a leading 0x12 on this packet only. */
const START_PRINTING_NEW = new Uint8Array([0x12, 0x51, 0x78, 0xa3, 0x00, 0x01, 0x00, 0x00, 0x00, 0xff]);

const LATTICE_START_PAYLOAD = new Uint8Array([
  0xaa, 0x55, 0x17, 0x38, 0x44, 0x5f, 0x5f, 0x5f, 0x44, 0x38, 0x2c,
]);
const LATTICE_END_PAYLOAD = new Uint8Array([
  0xaa, 0x55, 0x17, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x17,
]);

async function pause(ms: number): Promise<void> {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

/**
 * X6h doc: left pixel = LSB in each byte. Our raster is MSB-left — reverse per byte
 * (same as Cat-Printer `draw_bitmap`).
 */
function reverseBitsInEachByte(row: Uint8Array): Uint8Array {
  const out = new Uint8Array(row.length);
  for (let i = 0; i < row.length; i++) {
    let v = row[i]!;
    let r = 0;
    for (let b = 0; b < 8; b++) {
      r = (r << 1) | (v & 1);
      v >>= 1;
    }
    out[i] = r & 0xff;
  }
  return out;
}

export type MiniPrepareOptions = {
  /** Bluetooth name; `"Mini Printer…"` often needs `start_printing_new`. */
  printerName?: string;
  interPacketMs?: number;
};

/**
 * Cat-Printer `PrinterDriver._prepare()` — required before raw `0xA2` lines.
 * (Earlier code used `0xBE` as "drawing mode"; in Cat-Printer that is **apply energy**.)
 */
export async function miniCatPrepare(write: MiniWriteFn, options?: MiniPrepareOptions): Promise<void> {
  const gap = options?.interPacketMs ?? INTER_PACKET_MS;
  const name = (options?.printerName ?? '').toLowerCase();
  const useNewStart = name.includes('mini printer');

  await write(formatMessage(0xa3, new Uint8Array([0x00])));
  await pause(gap);
  await write(useNewStart ? START_PRINTING_NEW : START_PRINTING);
  await pause(gap);
  await write(formatMessage(MINI_CMD.setDpi200, new Uint8Array([50])));
  await pause(gap);
  await write(formatMessage(0xbd, new Uint8Array([32])));
  await pause(gap);
  await write(formatMessage(MINI_CMD.setEnergy, u16LE(0x3000)));
  await pause(gap);
  await write(formatMessage(MINI_CMD.applyEnergy, new Uint8Array([0x01])));
  await pause(gap);
  await write(formatMessage(0xa9, new Uint8Array([0x00])));
  await pause(gap);
  await write(formatMessage(0xa6, LATTICE_START_PAYLOAD));
  await pause(gap);
}

/** Cat-Printer `_finish()` (tail feed + reset speed). */
export async function miniCatFinish(write: MiniWriteFn, options?: { interPacketMs?: number }): Promise<void> {
  const gap = options?.interPacketMs ?? INTER_PACKET_MS;
  await write(formatMessage(0xa6, LATTICE_END_PAYLOAD));
  await pause(gap);
  await write(formatMessage(0xbd, new Uint8Array([8])));
  await pause(gap);
  await write(formatMessage(MINI_CMD.feedPaper, u16LE(128)));
  await pause(gap);
  await write(formatMessage(0xa3, new Uint8Array([0x00])));
  await pause(gap);
}

/**
 * Raster: only `0xA2` per line (Cat-Printer does **not** feed after each line — that caused runaway paper).
 */
export async function miniPrintProcessedImage(
  write: MiniWriteFn,
  img: ProcessedImage,
  options?: { interLineMs?: number },
): Promise<void> {
  const lineGap = options?.interLineMs ?? INTER_PACKET_MS;
  const wBytes = Math.ceil(img.width / 8);

  for (let y = 0; y < img.height; y++) {
    const row = img.data.subarray(y * wBytes, y * wBytes + wBytes);
    // Always send each row (including all-white). Skipping empty rows collapses vertical spacing on the slip
    // while the on-screen preview still shows it — Cat-Printer advances one line per 0xA2 packet.
    await write(formatMessage(MINI_CMD.drawBitmap, reverseBitsInEachByte(row)));
    await pause(lineGap);
  }
}

/** @deprecated Use `miniCatPrepare` */
export async function miniPrinterInit(write: MiniWriteFn): Promise<void> {
  await miniCatPrepare(write, {});
}
