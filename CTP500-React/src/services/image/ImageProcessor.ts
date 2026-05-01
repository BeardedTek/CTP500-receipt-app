import { PRINTER_WIDTH } from '../bluetooth/constants';

export interface ProcessedImage {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Stack 1-bpp images top-to-bottom (same pixel width). Optional white gap between segments. */
export function stackProcessedImagesVertically(
  segments: ProcessedImage[],
  gapRows = 8,
): ProcessedImage {
  if (segments.length === 0) {
    throw new Error('stackProcessedImagesVertically: no segments');
  }
  const width = segments[0]!.width;
  const wBytes = Math.ceil(width / 8);
  for (const s of segments) {
    if (s.width !== width) {
      throw new Error('stackProcessedImagesVertically: width mismatch');
    }
    if (Math.ceil(s.width / 8) !== wBytes) {
      throw new Error('stackProcessedImagesVertically: byte stride mismatch');
    }
  }

  let totalH = 0;
  for (let i = 0; i < segments.length; i++) {
    totalH += segments[i]!.height;
    if (i < segments.length - 1) totalH += gapRows;
  }

  const data = new Uint8Array(wBytes * totalH);
  let yOff = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    for (let y = 0; y < s.height; y++) {
      const src = s.data.subarray(y * wBytes, y * wBytes + wBytes);
      data.set(src, (yOff + y) * wBytes);
    }
    yOff += s.height;
    if (i < segments.length - 1) {
      yOff += gapRows;
    }
  }

  return { data, width, height: totalH };
}

type PreviewDecodeColors = { ink: [number, number, number]; paper: [number, number, number] };

/** Decode 1-bpp raster (MSB = left pixel within each byte) to an RGBA canvas. */
function decodeProcessedImageToCanvas(
  img: ProcessedImage,
  colors?: PreviewDecodeColors,
): HTMLCanvasElement {
  const ink = colors?.ink ?? [0, 0, 0];
  const paper = colors?.paper ?? [255, 255, 255];
  const wBytes = Math.ceil(img.width / 8);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(img.width, img.height);
  const d = imageData.data;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const byteIdx = y * wBytes + Math.floor(x / 8);
      const bit = 7 - (x % 8);
      const isInk = (img.data[byteIdx]! & (1 << bit)) !== 0;
      const [r, g, b] = isInk ? ink : paper;
      const p = (y * img.width + x) * 4;
      d[p] = r;
      d[p + 1] = g;
      d[p + 2] = b;
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

/** Decode 1-bpp raster to a PNG data URL (native printer resolution). */
export function processedImageToDataUrl(img: ProcessedImage): string {
  return decodeProcessedImageToCanvas(img).toDataURL('image/png');
}

const PREVIEW_SOFT_INK: [number, number, number] = [24, 24, 26];
const PREVIEW_SOFT_PAPER: [number, number, number] = [252, 252, 250];
/** Canvas edge ~16k; keep upscaled preview under this so encoding stays reliable. */
const PREVIEW_MAX_CANVAS_EDGE = 8000;

function choosePreviewPixelScale(dpr: number, width: number, height: number): number {
  const fromDpr = Math.round(dpr * 2);
  let s = Math.min(6, Math.max(3, fromDpr));
  while (s > 1 && (width * s > PREVIEW_MAX_CANVAS_EDGE || height * s > PREVIEW_MAX_CANVAS_EDGE)) {
    s -= 1;
  }
  return s;
}

/**
 * Same 1-bpp dots as print, decoded with slightly softer on-screen ink/paper, then nearest-neighbor
 * upscaled so the browser can show a crisp ~384 CSS px strip without mushy resampling.
 */
export function processedImageToPreviewDataUrl(img: ProcessedImage, scale?: number): string {
  const dpr = typeof window !== 'undefined' && typeof window.devicePixelRatio === 'number' ? window.devicePixelRatio : 1;
  const s = scale ?? choosePreviewPixelScale(dpr || 1, img.width, img.height);
  const src = decodeProcessedImageToCanvas(img, { ink: PREVIEW_SOFT_INK, paper: PREVIEW_SOFT_PAPER });
  if (s <= 1) return src.toDataURL('image/png');
  const out = document.createElement('canvas');
  out.width = img.width * s;
  out.height = img.height * s;
  const octx = out.getContext('2d')!;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(src, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

/** Un-premultiplied RGBA blended onto white → linear-ish luminance 0–255 */
export function luminanceOnWhite(r: number, g: number, b: number, aByte: number): number {
  const a = aByte / 255;
  const rr = (1 - a) * 255 + a * r;
  const gg = (1 - a) * 255 + a * g;
  const bb = (1 - a) * 255 + a * b;
  return rr * 0.299 + gg * 0.587 + bb * 0.114;
}

export interface ProcessImageOptions {
  /** Fit bitmap inside PRINTER_WIDTH × maxHeightPx (aspect preserved, centered on white). */
  maxHeightPx?: number;
}

// Convert a File to a processed image ready for printing
export async function processImage(file: File, options?: ProcessImageOptions): Promise<ProcessedImage> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  const maxH = options?.maxHeightPx;

  let canvasW: number;
  let canvasH: number;
  let drawW: number;
  let drawH: number;
  let offsetX: number;
  let offsetY: number;

  if (maxH != null) {
    const scale = Math.min(PRINTER_WIDTH / bitmap.width, maxH / bitmap.height);
    drawW = Math.round(bitmap.width * scale);
    drawH = Math.round(bitmap.height * scale);
    canvasW = PRINTER_WIDTH;
    canvasH = maxH;
    offsetX = Math.floor((canvasW - drawW) / 2);
    offsetY = Math.floor((canvasH - drawH) / 2);
  } else {
    const scale = PRINTER_WIDTH / bitmap.width;
    drawW = PRINTER_WIDTH;
    drawH = Math.round(bitmap.height * scale);
    canvasW = PRINTER_WIDTH;
    canvasH = drawH;
    offsetX = 0;
    offsetY = 0;
  }

  canvas.width = canvasW;
  canvas.height = canvasH;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvasW, canvasH);
  ctx.drawImage(bitmap, offsetX, offsetY, drawW, drawH);

  // Convert to 1-bit (threshold at 128)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const output = new Uint8Array(Math.ceil(canvas.width / 8) * canvas.height);

  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const idx = (y * canvas.width + x) * 4;
      const r = imageData.data[idx]!;
      const g = imageData.data[idx + 1]!;
      const b = imageData.data[idx + 2]!;
      const a = imageData.data[idx + 3]!;
      const lum = luminanceOnWhite(r, g, b, a);
      const byteIdx = y * Math.ceil(canvas.width / 8) + Math.floor(x / 8);
      const bit = 7 - (x % 8);
      // Burn dot when visually dark (logo/text); transparent → white paper
      if (lum <= 128) {
        output[byteIdx] |= (1 << bit);
      }
    }
  }

  // Pad width to byte boundary
  const paddedWidth = Math.ceil(canvas.width / 8) * 8;
  if (paddedWidth !== canvas.width) {
    const padded = new Uint8Array(canvas.height * (paddedWidth / 8));
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const srcIdx = y * Math.ceil(canvas.width / 8) + Math.floor(x / 8);
        const dstIdx = y * (paddedWidth / 8) + Math.floor(x / 8);
        const srcBit = 7 - (x % 8);
        const dstBit = 7 - (x % paddedWidth);
        if (srcBit === dstBit) {
          padded[dstIdx] |= (output[srcIdx] & (1 << srcBit));
        }
      }
    }
    return { data: padded, width: paddedWidth, height: canvas.height };
  }

  return { data: output, width: canvas.width, height: canvas.height };
}

/** Soft threshold keeps antialiased edges; hard threshold snaps grays to paper (crisp receipt text). */
const TEXT_BW_THRESH_SOFT = 128;
const TEXT_BW_THRESH_HARD = 175;

function inkForTrimPixel(data: ImageData['data'], pxIdx: number): boolean {
  const i = pxIdx * 4;
  const lum = luminanceOnWhite(data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!);
  return lum < 250;
}

/** Vertical trim + 1-bpp encode (same rules as plain text print). */
export function rasterizeWhiteCanvasTrimmed(canvas: HTMLCanvasElement, hardBw: boolean): ProcessedImage {
  const bwThreshold = hardBw ? TEXT_BW_THRESH_HARD : TEXT_BW_THRESH_SOFT;
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height);
  let minY = 0;
  let maxY = height;
  outer: for (let y2 = 0; y2 < height; y2++) {
    for (let x = 0; x < width; x++) {
      if (inkForTrimPixel(imageData.data, y2 * width + x)) {
        minY = y2;
        break outer;
      }
    }
  }
  outer2: for (let y2 = height - 1; y2 >= 0; y2--) {
    for (let x = 0; x < width; x++) {
      if (inkForTrimPixel(imageData.data, y2 * width + x)) {
        maxY = y2;
        break outer2;
      }
    }
  }
  const trimmed = ctx.getImageData(0, minY, width, maxY - minY + 10);
  const th = trimmed.height;
  const tw = trimmed.width;
  const result = new Uint8Array(Math.ceil(tw / 8) * th);
  for (let y2 = 0; y2 < th; y2++) {
    for (let x = 0; x < tw; x++) {
      const idx = (y2 * tw + x) * 4;
      const lum = luminanceOnWhite(
        trimmed.data[idx]!,
        trimmed.data[idx + 1]!,
        trimmed.data[idx + 2]!,
        trimmed.data[idx + 3]!,
      );
      const byteIdx = y2 * Math.ceil(tw / 8) + Math.floor(x / 8);
      const bit = 7 - (x % 8);
      if (lum <= bwThreshold) {
        result[byteIdx] |= 1 << bit;
      }
    }
  }
  return { data: result, width: tw, height: th };
}

export interface RenderTextOptions {
  /** If true, only darker pixels become ink (antialias fades to white) for crisp 1-bit output */
  hardBw?: boolean;
}

// Render text to image using canvas
export function renderTextToImage(
  text: string,
  fontSize = 28,
  options?: RenderTextOptions,
): Promise<ProcessedImage> {
  const hardBw = Boolean(options?.hardBw);

  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = PRINTER_WIDTH;
    canvas.height = 5000; // Large enough, will trim
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black';
    ctx.font = `${fontSize}px Menlo, monospace`;

    // Word wrap
    const lines: string[] = [];
    for (const rawLine of text.split('\n')) {
      const words = rawLine.split(' ');
      let current = '';
      for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (ctx.measureText(test).width <= PRINTER_WIDTH) {
          current = test;
        } else {
          if (current) lines.push(current);
          current = word;
        }
      }
      if (current) lines.push(current);
    }

    let y = fontSize;
    for (const line of lines) {
      ctx.fillText(line, 0, y);
      y += fontSize * 1.2;
    }

    resolve(rasterizeWhiteCanvasTrimmed(canvas, hardBw));
  });
}