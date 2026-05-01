import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildReceiptDrawPlan,
  computeReceiptTotals,
  formatMoney,
  receiptHasContent,
  type ReceiptPrintInput,
} from '../services/receipt/receiptFormat';
import { renderReceiptToImage } from '../services/receipt/receiptCanvas';
import {
  processImage,
  processedImageToPreviewDataUrl,
  stackProcessedImagesVertically,
  type ProcessedImage,
} from '../services/image/ImageProcessor';
import { RECEIPT_LOGO_MAX_HEIGHT_PX } from '../services/bluetooth/constants';
import {
  clearReceiptLogoDataUrl,
  dataUrlToFile,
  fileToDataUrl,
  loadReceiptFooter,
  loadReceiptHeader,
  loadReceiptLogoDataUrl,
  loadReceiptTaxPercent,
  saveReceiptFooter,
  saveReceiptHeader,
  saveReceiptLogoDataUrl,
  saveReceiptTaxPercent,
} from '../services/receipt/receiptStorage';

const PREVIEW_DEBOUNCE_MS = 200;
const PREVIEW_STACK_GAP = 12;

interface LineRow {
  id: string;
  item: string;
  qty: string;
  cost: string;
}

function newRow(): LineRow {
  return {
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    item: '',
    qty: '1',
    cost: '',
  };
}

export function ReceiptPanel({
  onPrintReceipt,
}: {
  onPrintReceipt: (logo: File | null, payload: ReceiptPrintInput) => void;
}) {
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [header, setHeader] = useState(() => loadReceiptHeader());
  const [rows, setRows] = useState<LineRow[]>(() => [newRow()]);
  const [discountStr, setDiscountStr] = useState('');
  const [useTax, setUseTax] = useState(false);
  const [taxPercent, setTaxPercent] = useState(() => loadReceiptTaxPercent());
  const [footer, setFooter] = useState(() => loadReceiptFooter());
  const [printPreviewUrl, setPrintPreviewUrl] = useState<string | null>(null);
  const [printPreviewBusy, setPrintPreviewBusy] = useState(false);
  const printPreviewRunRef = useRef(0);

  useEffect(() => {
    const stored = loadReceiptLogoDataUrl();
    if (!stored) return;
    let cancelled = false;
    void dataUrlToFile(stored).then((f) => {
      if (cancelled) return;
      if (loadReceiptLogoDataUrl() !== stored) return;
      setLogo((prev) => (prev == null ? f : prev));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!logo) {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logo);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);

  const rowPayload = useMemo(
    () => rows.map((r) => ({ item: r.item, qty: r.qty, cost: r.cost })),
    [rows],
  );

  const taxNum = Number.parseFloat(taxPercent.replace(/,/g, ''));
  const taxPercentValue = Number.isFinite(taxNum) ? taxNum : 0;
  const receiptInput: ReceiptPrintInput = useMemo(
    () => ({
      header: header.trim() || undefined,
      rows: rowPayload,
      useTax,
      taxPercent: taxPercentValue,
      discountInput: discountStr,
      footer: footer.trim() || undefined,
    }),
    [header, rowPayload, useTax, taxPercentValue, discountStr, footer],
  );

  useEffect(() => {
    const run = ++printPreviewRunRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (printPreviewRunRef.current !== run) return;
        setPrintPreviewBusy(true);
        try {
          const segments: ProcessedImage[] = [];
          if (logo) {
            segments.push(await processImage(logo, { maxHeightPx: RECEIPT_LOGO_MAX_HEIGHT_PX }));
          }
          if (receiptHasContent(receiptInput)) {
            const plan = buildReceiptDrawPlan(receiptInput);
            if (plan.length > 0) {
              segments.push(await renderReceiptToImage(plan, true));
            }
          }
          if (printPreviewRunRef.current !== run) return;
          if (segments.length === 0) {
            setPrintPreviewUrl(null);
            return;
          }
          const combined =
            segments.length === 1
              ? segments[0]!
              : stackProcessedImagesVertically(segments, PREVIEW_STACK_GAP);
          setPrintPreviewUrl(processedImageToPreviewDataUrl(combined));
        } catch {
          if (printPreviewRunRef.current === run) setPrintPreviewUrl(null);
        } finally {
          if (printPreviewRunRef.current === run) setPrintPreviewBusy(false);
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [logo, receiptInput]);

  const totals = useMemo(
    () => computeReceiptTotals(rowPayload, useTax, taxPercentValue, discountStr),
    [rowPayload, useTax, taxPercentValue, discountStr],
  );

  const canPrint = Boolean(logo) || receiptHasContent(receiptInput);

  const pickLogo = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/jpg,image/bmp,image/webp';
    input.onchange = () => {
      void (async () => {
        const f = input.files?.[0];
        if (!f) {
          setLogo(null);
          return;
        }
        setLogo(f);
        try {
          saveReceiptLogoDataUrl(await fileToDataUrl(f));
        } catch {
          /* quota or read error — logo still in memory for this session */
        }
      })();
    };
    input.click();
  };

  const clearLogo = () => {
    clearReceiptLogoDataUrl();
    setLogo(null);
  };

  const updateHeader = (v: string) => {
    setHeader(v);
    saveReceiptHeader(v);
  };

  const updateTax = (v: string) => {
    setTaxPercent(v);
    saveReceiptTaxPercent(v);
  };

  const updateFooter = (v: string) => {
    setFooter(v);
    saveReceiptFooter(v);
  };

  const setRow = (id: string, patch: Partial<Pick<LineRow, 'item' | 'qty' | 'cost'>>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addRow = () => setRows((prev) => [...prev, newRow()]);
  const removeRow = (id: string) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  };

  return (
    <div className="border rounded-lg p-4">
      <h2 className="font-semibold mb-3">Receipt</h2>
      <p className="text-sm text-gray-600 mb-3">
        Optional logo (max {RECEIPT_LOGO_MAX_HEIGHT_PX}px tall on the slip), multi-line header and footer (centered on
        the slip), line items (qty × unit price), and totals. Body text is smaller than prices; sections are spaced
        on the slip.
      </p>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="min-w-0 flex-1">
      <div className="flex gap-2 flex-wrap items-center mb-3">
        <button
          type="button"
          onClick={pickLogo}
          className="bg-gray-200 hover:bg-gray-300 px-3 py-2 rounded text-sm transition"
        >
          {logo ? 'Change logo' : 'Add logo (optional)'}
        </button>
        {logo && (
          <button type="button" onClick={clearLogo} className="text-sm text-red-600 hover:underline">
            Remove logo
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 -mt-1 mb-2">Logo is saved in this browser for next time (large files may fail if storage is full).</p>
      {logoPreview && (
        <img
          src={logoPreview}
          alt="Logo"
          className="mb-3 border rounded bg-white object-contain"
          style={{ maxHeight: RECEIPT_LOGO_MAX_HEIGHT_PX }}
        />
      )}

      <label className="block text-sm font-medium text-gray-700 mb-1">Header (optional)</label>
      <textarea
        value={header}
        onChange={(e) => updateHeader(e.target.value)}
        placeholder={'Store name\nAddress or tagline'}
        rows={3}
        className="w-full border rounded p-2 text-sm mb-1 resize-y text-center min-h-[4.5rem]"
      />
      <p className="text-xs text-gray-500 mb-3">Saved in this browser for next time.</p>

      <div className="text-sm font-medium text-gray-700 mb-1">Line items</div>
      <p className="text-xs text-gray-500 mb-1">
        <strong>Cost</strong> is unit price; line total = qty × unit (shown on the printed receipt).
      </p>
      <div className="rounded border overflow-hidden mb-2">
        <div className="grid grid-cols-[1fr_3.25rem_4.5rem_auto] gap-1 bg-gray-100 px-2 py-1.5 text-xs font-semibold text-gray-600 items-center">
          <span>Item</span>
          <span className="text-center">Qty</span>
          <span className="text-right pr-1">Cost</span>
          <span className="w-6" />
        </div>
        {rows.map((r) => (
          <div
            key={r.id}
            className="grid grid-cols-[1fr_3.25rem_4.5rem_auto] gap-1 items-center border-t px-2 py-1.5 bg-white"
          >
            <input
              type="text"
              value={r.item}
              onChange={(e) => setRow(r.id, { item: e.target.value })}
              placeholder="Description"
              className="border rounded px-2 py-1 text-sm min-w-0"
            />
            <input
              type="text"
              inputMode="decimal"
              value={r.qty}
              onChange={(e) => setRow(r.id, { qty: e.target.value })}
              placeholder="1"
              className="border rounded px-1 py-1 text-sm text-center w-full min-w-0"
            />
            <input
              type="text"
              inputMode="decimal"
              value={r.cost}
              onChange={(e) => setRow(r.id, { cost: e.target.value })}
              placeholder="$0"
              className="border rounded px-1 py-1 text-sm text-right w-full min-w-0"
            />
            <button
              type="button"
              onClick={() => removeRow(r.id)}
              disabled={rows.length <= 1}
              className="text-xs text-red-600 hover:underline disabled:opacity-30 disabled:no-underline px-1 justify-self-end"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={addRow} className="text-sm text-blue-600 hover:underline mb-3">
        + Add row
      </button>

      <div className="space-y-2 text-sm border-t pt-3">
        <div className="flex justify-between gap-2">
          <span className="text-gray-600">Subtotal</span>
          <span className="font-mono tabular-nums">{formatMoney(totals.subtotal)}</span>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-gray-700">Discount (dollars or %)</span>
          <input
            type="text"
            inputMode="decimal"
            value={discountStr}
            onChange={(e) => setDiscountStr(e.target.value)}
            placeholder="5, $5, or 10%"
            className="border rounded p-2 font-mono"
          />
          <span className="text-xs text-gray-500">
            Use a number or <code className="rounded bg-gray-100 px-1">$</code> amount; end with{' '}
            <code className="rounded bg-gray-100 px-1">%</code> for a percent of subtotal (e.g. 8.5%).
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-gray-700">Tax rate (%)</span>
          <input
            type="text"
            inputMode="decimal"
            value={taxPercent}
            onChange={(e) => updateTax(e.target.value)}
            placeholder="e.g. 8.25"
            className="border rounded p-2 font-mono"
          />
          <span className="text-xs text-gray-500">Saved in this browser for next time.</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={useTax} onChange={(e) => setUseTax(e.target.checked)} className="rounded" />
          <span>Apply tax to this receipt</span>
        </label>
        {useTax && taxPercentValue > 0 && (
          <div className="flex justify-between gap-2">
            <span className="text-gray-600">Tax ({taxPercentValue}%)</span>
            <span className="font-mono tabular-nums">{formatMoney(totals.taxAmount)}</span>
          </div>
        )}
        <div className="flex justify-between gap-2 pt-1 border-t font-semibold">
          <span>Total</span>
          <span className="font-mono tabular-nums">{formatMoney(totals.total)}</span>
        </div>
      </div>

      <label className="block text-sm font-medium text-gray-700 mt-3 mb-1">Footer (optional)</label>
      <textarea
        value={footer}
        onChange={(e) => updateFooter(e.target.value)}
        placeholder="Thank you, hours, policy…"
        className="w-full h-20 border rounded p-2 text-sm resize-y text-center min-h-[5rem]"
      />
      <p className="text-xs text-gray-500 mt-0.5">Saved in this browser for next time.</p>
        </div>

      {canPrint && (
        <aside className="w-full shrink-0 lg:w-[min(100%,28rem)] lg:self-start">
        <div className="rounded-lg border border-gray-200 bg-neutral-100 p-3 lg:mt-0 mt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-gray-800">Print preview</span>
            <span className="text-xs text-gray-500">
              Full slip height — same 384-dot raster as print; on-screen colors are softened slightly
            </span>
          </div>
          {printPreviewUrl !== null ? (
            <div className="rounded border border-stone-200/80 bg-[#fafaf8] p-3 shadow-inner">
              <img
                src={printPreviewUrl}
                alt="Receipt as it will print"
                draggable={false}
                className="mx-auto block h-auto w-full max-w-[384px] select-none"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>
          ) : printPreviewBusy ? (
            <div className="rounded border border-dashed border-gray-300 bg-white py-8 text-center text-sm text-gray-500">
              Updating preview…
            </div>
          ) : (
            <div className="rounded border border-dashed border-gray-300 bg-white py-6 text-center text-sm text-gray-500">
              Preview will appear in a moment…
            </div>
          )}
        </div>
        </aside>
      )}
      </div>

      <button
        type="button"
        disabled={!canPrint}
        onClick={() => onPrintReceipt(logo, receiptInput)}
        className="mt-3 w-full bg-violet-600 hover:bg-violet-700 disabled:bg-gray-300 text-white px-3 py-2 rounded text-sm font-medium transition"
      >
        Print receipt
      </button>
    </div>
  );
}
