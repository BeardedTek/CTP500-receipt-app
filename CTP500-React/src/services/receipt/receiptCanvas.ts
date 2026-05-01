import { PRINTER_WIDTH } from '../bluetooth/constants';
import { rasterizeWhiteCanvasTrimmed, type ProcessedImage } from '../image/ImageProcessor';
import type { ReceiptPlanEntry } from './receiptFormat';

const FONT_STACK = 'Menlo, "Courier New", monospace';
/** Body / labels / qty (more characters per line) */
const SMALL_PX = 22;
/** Prices and amounts (unchanged visual weight vs previous 28px receipt) */
const PRICE_PX = 28;
/** Store title line */
const HEADER_PX = 28;

/** Line height multiplier so ascenders/descenders do not collide (thermal readability). */
const LINE_LEADING = 1.52;
const LINE_STEP = Math.ceil(Math.max(SMALL_PX, PRICE_PX, HEADER_PX) * LINE_LEADING);

/** Extra space above/below dashed rules so they do not crowd adjacent text */
const DASH_VERTICAL_PAD_PX = 10;

function setFont(ctx: CanvasRenderingContext2D, px: number) {
  ctx.font = `${px}px ${FONT_STACK}`;
}

function wrapToWidth(ctx: CanvasRenderingContext2D, text: string, maxW: number, fontPx: number): string[] {
  setFont(ctx, fontPx);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return text.trim() ? [text] : [''];
  }
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const tryLine = line ? `${line} ${w}` : w;
    if (ctx.measureText(tryLine).width <= maxW) {
      line = tryLine;
    } else {
      if (line) {
        lines.push(line);
        line = '';
      }
      if (ctx.measureText(w).width <= maxW) {
        line = w;
      } else {
        let rest = w;
        while (rest.length > 0) {
          let lo = 1;
          let hi = rest.length;
          let best = 1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (ctx.measureText(rest.slice(0, mid)).width <= maxW) {
              best = mid;
              lo = mid + 1;
            } else {
              hi = mid - 1;
            }
          }
          lines.push(rest.slice(0, best));
          rest = rest.slice(best);
        }
      }
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function fillTextCentered(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontPx: number,
  yBaseline: number,
): void {
  setFont(ctx, fontPx);
  ctx.textBaseline = 'alphabetic';
  const w = ctx.measureText(text).width;
  const x = Math.max(0, (PRINTER_WIDTH - w) / 2);
  ctx.fillText(text, x, yBaseline);
}

function dashLine(ctx: CanvasRenderingContext2D, yBaseline: number): void {
  setFont(ctx, SMALL_PX);
  ctx.textBaseline = 'alphabetic';
  let s = '-';
  while (ctx.measureText(`${s}-`).width < PRINTER_WIDTH) s += '-';
  ctx.fillText(s, 0, yBaseline);
}

function drawMoneyRow(ctx: CanvasRenderingContext2D, label: string, amount: string, yBaseline: number): void {
  ctx.textBaseline = 'alphabetic';
  setFont(ctx, PRICE_PX);
  const aw = ctx.measureText(amount).width;
  const gap = 12;
  const maxLabelW = PRINTER_WIDTH - aw - gap;
  setFont(ctx, SMALL_PX);
  let lab = label;
  if (ctx.measureText(lab).width > maxLabelW) {
    while (lab.length > 1 && ctx.measureText(`${lab.slice(0, -1)}…`).width > maxLabelW) {
      lab = lab.slice(0, -1);
    }
    lab = `${lab.slice(0, -1)}…`;
  }
  ctx.fillText(lab, 0, yBaseline);
  setFont(ctx, PRICE_PX);
  ctx.fillText(amount, PRINTER_WIDTH - ctx.measureText(amount).width, yBaseline);
}

export function renderReceiptToImage(plan: ReceiptPlanEntry[], hardBw: boolean): Promise<ProcessedImage> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = PRINTER_WIDTH;
    canvas.height = 5600;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black';

    let penY = Math.round(LINE_STEP * 1.12) + 4;

    const baseline = () => penY;

    const advanceLine = () => {
      penY += LINE_STEP;
    };

    const advancePx = (px: number) => {
      penY += px;
    };

    for (const e of plan) {
      if (e.kind === 'vspace') {
        advancePx(e.px);
        continue;
      }
      if (e.kind === 'headerLine') {
        const wrapped = wrapToWidth(ctx, e.text, PRINTER_WIDTH, HEADER_PX);
        for (const ln of wrapped) {
          fillTextCentered(ctx, ln, HEADER_PX, baseline());
          advanceLine();
        }
        continue;
      }
      if (e.kind === 'dash') {
        advancePx(DASH_VERTICAL_PAD_PX);
        setFont(ctx, SMALL_PX);
        dashLine(ctx, baseline());
        advanceLine();
        advancePx(DASH_VERTICAL_PAD_PX);
        continue;
      }
      if (e.kind === 'money') {
        drawMoneyRow(ctx, e.label, e.amount, baseline());
        advanceLine();
        continue;
      }
      if (e.kind === 'footerLine') {
        const wrapped = wrapToWidth(ctx, e.text, PRINTER_WIDTH, SMALL_PX);
        for (const ln of wrapped) {
          fillTextCentered(ctx, ln, SMALL_PX, baseline());
          advanceLine();
        }
        continue;
      }
      if (e.kind === 'item') {
        setFont(ctx, PRICE_PX);
        const priceW = ctx.measureText(e.priceText).width;
        const colGap = 14;
        const minQtyW = 36;
        setFont(ctx, SMALL_PX);
        const qtyW = Math.max(minQtyW, ctx.measureText(e.qtyText).width + 8);
        const itemMaxW = Math.max(40, PRINTER_WIDTH - priceW - qtyW - colGap * 2);
        const itemLines = wrapToWidth(ctx, e.item, itemMaxW, SMALL_PX);
        for (let i = 0; i < itemLines.length; i++) {
          const ln = itemLines[i]!;
          ctx.textBaseline = 'alphabetic';
          setFont(ctx, SMALL_PX);
          ctx.fillText(ln, 0, baseline());
          if (i === 0) {
            const qx = PRINTER_WIDTH - priceW - qtyW - colGap;
            ctx.fillText(e.qtyText, qx, baseline());
            setFont(ctx, PRICE_PX);
            ctx.fillText(e.priceText, PRINTER_WIDTH - priceW, baseline());
            setFont(ctx, SMALL_PX);
          }
          advanceLine();
        }
      }
    }

    resolve(rasterizeWhiteCanvasTrimmed(canvas, hardBw));
  });
}
