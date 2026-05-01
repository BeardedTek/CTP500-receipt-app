import { PRINTER_WIDTH } from '../bluetooth/constants';

export interface ReceiptItemRow {
  item: string;
  qty: string;
  /** Unit price (multiplied by qty for line total) */
  cost: string;
}

export interface ReceiptPrintInput {
  /** Multi-line optional title / address (centered on slip). */
  header?: string;
  rows: ReceiptItemRow[];
  useTax: boolean;
  /** Percent, e.g. 8.25 for 8.25% */
  taxPercent: number;
  /** Dollars (e.g. `5`, `$5`) or percent of subtotal when value ends with `%` (e.g. `10%`) */
  discountInput: string;
  /** Multi-line closing text (centered on slip). */
  footer?: string;
}

/** Vertical whitespace between major sections (header / body / totals / footer) on the slip */
export const RECEIPT_SECTION_PAD_PX = 18;

const HEADER_PARA_GAP_PX = 8;
const FOOTER_PARA_GAP_PX = 8;
const ITEM_GAP_PX = 8;
const TOTALS_AFTER_DASH_PAD_PX = 10;
const MONEY_LINE_GAP_PX = 8;

export type ReceiptPlanEntry =
  | { kind: 'vspace'; px: number }
  | { kind: 'headerLine'; text: string }
  | { kind: 'dash' }
  | { kind: 'item'; item: string; qtyText: string; priceText: string }
  | { kind: 'money'; label: string; amount: string }
  | { kind: 'footerLine'; text: string };

export interface ReceiptTotals {
  subtotal: number;
  discountApplied: number;
  taxable: number;
  taxAmount: number;
  total: number;
  /** Label for the discount line on the slip (e.g. `Discount` or `Discount (10%)`) */
  discountLineLabel: string;
}

/**
 * Parse discount: amount in dollars (after strip $/commas) unless the trimmed string ends with `%`,
 * in which case it is a percent of `subtotal` (capped at 100%). Applied amount is capped at subtotal.
 */
export function parseDiscount(input: string, subtotal: number): { applied: number; lineLabel: string } {
  const raw = input.trim();
  if (!raw) {
    return { applied: 0, lineLabel: 'Discount' };
  }

  const percentMatch = raw.match(/^([\d.,]+)\s*%$/);
  if (percentMatch) {
    let p = Number.parseFloat(percentMatch[1]!.replace(/,/g, ''));
    if (!Number.isFinite(p) || p < 0) p = 0;
    p = Math.min(p, 100);
    const applied = Math.round(subtotal * (p / 100) * 100) / 100;
    const displayPct = Number.isInteger(p) ? String(p) : String(Math.round(p * 100) / 100).replace(/\.?0+$/, '');
    return {
      applied: Math.min(applied, subtotal),
      lineLabel: p > 0 ? `Discount (${displayPct}%)` : 'Discount',
    };
  }

  const dollars = Math.max(0, parseMoney(raw));
  return {
    applied: Math.min(dollars, subtotal),
    lineLabel: 'Discount',
  };
}

export function parseMoney(input: string): number {
  const s = input.replace(/[$,\s]/g, '').trim();
  if (!s) return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Quantity for math; blank or invalid defaults to 1 */
export function parseQty(input: string): number {
  const s = input.replace(/,/g, '').trim();
  if (!s) return 1;
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, n);
}

/** Short string for the printed qty column */
export function formatQtyColumn(input: string): string {
  const q = parseQty(input);
  if (q === 1 && !input.replace(/,/g, '').trim()) return '1';
  if (Number.isInteger(q)) return String(q);
  const t = Math.round(q * 1000) / 1000;
  return String(t).replace(/\.?0+$/, '') || '0';
}

export function lineTotal(row: ReceiptItemRow): number {
  return Math.round(parseQty(row.qty) * parseMoney(row.cost) * 100) / 100;
}

export function computeReceiptTotals(
  rows: ReceiptItemRow[],
  useTax: boolean,
  taxPercent: number,
  discountInput: string,
): ReceiptTotals {
  const subtotal = rows.reduce((s, r) => s + lineTotal(r), 0);
  const { applied: discountApplied, lineLabel: discountLineLabel } = parseDiscount(discountInput, subtotal);
  const taxable = Math.max(0, subtotal - discountApplied);
  const taxRate = Number.isFinite(taxPercent) ? Math.max(0, taxPercent) : 0;
  const taxAmount = useTax && taxRate > 0 ? Math.round(taxable * (taxRate / 100) * 100) / 100 : 0;
  const total = Math.round((taxable + taxAmount) * 100) / 100;
  return { subtotal, discountApplied, taxable, taxAmount, total, discountLineLabel };
}

export function receiptHasContent(input: ReceiptPrintInput): boolean {
  const hasHeader = Boolean(input.header?.trim());
  const hasRows = input.rows.length > 0;
  const hasFooter = Boolean(input.footer?.trim());
  return hasHeader || hasRows || hasFooter;
}

export function measureMonospaceCharsPerLine(fontSize: number, widthPx = PRINTER_WIDTH): number {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = `${fontSize}px Menlo, monospace`;
  const ch = Math.max(ctx.measureText('M').width, ctx.measureText('0').width, 1);
  return Math.max(12, Math.floor(widthPx / ch));
}

export function buildReceiptDrawPlan(input: ReceiptPrintInput): ReceiptPlanEntry[] {
  const PAD = RECEIPT_SECTION_PAD_PX;
  if (!receiptHasContent(input)) {
    return [];
  }

  const hasHeader = Boolean(input.header?.trim());
  const hasFooter = Boolean(input.footer?.trim());
  const plan: ReceiptPlanEntry[] = [];

  if (hasHeader) {
    const headerLines = input.header!.trim().split('\n').map((r) => r.trim()).filter(Boolean);
    for (let i = 0; i < headerLines.length; i++) {
      if (i > 0) plan.push({ kind: 'vspace', px: HEADER_PARA_GAP_PX });
      plan.push({ kind: 'headerLine', text: headerLines[i]! });
    }
    plan.push({ kind: 'dash' });
    plan.push({ kind: 'vspace', px: PAD });
  }

  for (let i = 0; i < input.rows.length; i++) {
    if (i > 0) plan.push({ kind: 'vspace', px: ITEM_GAP_PX });
    const row = input.rows[i]!;
    plan.push({
      kind: 'item',
      item: row.item.trim() || '—',
      qtyText: formatQtyColumn(row.qty),
      priceText: formatMoney(lineTotal(row)),
    });
  }

  plan.push({ kind: 'vspace', px: PAD });
  plan.push({ kind: 'dash' });
  plan.push({ kind: 'vspace', px: TOTALS_AFTER_DASH_PAD_PX });

  const totals = computeReceiptTotals(input.rows, input.useTax, input.taxPercent, input.discountInput);
  const taxRate = Number.isFinite(input.taxPercent) ? Math.max(0, input.taxPercent) : 0;

  const moneyRows: { label: string; amount: string }[] = [
    { label: 'Subtotal', amount: formatMoney(totals.subtotal) },
  ];
  if (totals.discountApplied > 0) {
    moneyRows.push({ label: totals.discountLineLabel, amount: formatMoney(-totals.discountApplied) });
  }
  if (input.useTax && taxRate > 0) {
    moneyRows.push({ label: `Tax (${taxRate}%)`, amount: formatMoney(totals.taxAmount) });
  }
  moneyRows.push({ label: 'Total', amount: formatMoney(totals.total) });
  for (let i = 0; i < moneyRows.length; i++) {
    if (i > 0) plan.push({ kind: 'vspace', px: MONEY_LINE_GAP_PX });
    const m = moneyRows[i]!;
    plan.push({ kind: 'money', label: m.label, amount: m.amount });
  }

  if (hasFooter) {
    plan.push({ kind: 'vspace', px: PAD });
    const footerLines = input.footer!.trim().split('\n').map((r) => r.trim()).filter(Boolean);
    for (let i = 0; i < footerLines.length; i++) {
      if (i > 0) plan.push({ kind: 'vspace', px: FOOTER_PARA_GAP_PX });
      plan.push({ kind: 'footerLine', text: footerLines[i]! });
    }
  }

  return plan;
}
