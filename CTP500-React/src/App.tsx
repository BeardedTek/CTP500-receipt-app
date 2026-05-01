import { useCallback, useEffect, useRef, useState } from 'react';
import { ReceiptPanel } from './components/ReceiptPanel';
import { useBluetooth, type BluetoothLogLevel } from './hooks/useBluetooth';
import { RECEIPT_LOGO_MAX_HEIGHT_PX } from './services/bluetooth/constants';
import { buildReceiptDrawPlan, receiptHasContent, type ReceiptPrintInput } from './services/receipt/receiptFormat';
import { renderReceiptToImage } from './services/receipt/receiptCanvas';
import { processImage, stackProcessedImagesVertically, type ProcessedImage } from './services/image/ImageProcessor';
import { initPrinter, startRaster, endRaster, rasterImage } from './services/printer/commands';
import { miniCatPrepare, miniCatFinish, miniPrintProcessedImage } from './services/printer/miniAe30Print';
import type { WebBluetoothEnvironment } from './services/bluetooth/webBluetoothEnvironment';

function BluetoothPanel({
  connection,
  isSupported,
  webBluetoothEnv,
  onScan,
  onDisconnect,
  batteryLevel,
  batteryVoltage,
  printerName,
}: {
  connection: string;
  isSupported: boolean;
  webBluetoothEnv: WebBluetoothEnvironment;
  onScan: () => void;
  onDisconnect: () => void;
  batteryLevel: number | null;
  batteryVoltage: string | null;
  printerName: string | null;
}) {
  const statusColors: Record<string, string> = {
    disconnected: 'text-red-600',
    scanning: 'text-blue-600',
    connecting: 'text-yellow-600',
    connected: 'text-green-600',
  };
  const statusText: Record<string, string> = {
    disconnected: '● Disconnected',
    scanning: '⟳ Scanning...',
    connecting: '⟳ Connecting...',
    connected: '● Connected',
  };

  return (
    <div className="border rounded-lg p-4">
      <h2 className="font-semibold mb-3">Printer</h2>
      <div className="flex gap-2 mb-2">
        {connection === 'connected' ? (
          <button
            type="button"
            onClick={onDisconnect}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-3 rounded font-medium transition"
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={onScan}
            disabled={connection === 'scanning' || !isSupported}
            className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white px-4 py-3 rounded font-medium transition"
          >
            {connection === 'scanning' ? 'Scanning...' : connection === 'connecting' ? 'Connecting...' : 'Scan & Connect'}
          </button>
        )}
      </div>
      <div className={`font-medium ${statusColors[connection] ?? 'text-gray-600'}`}>
        {statusText[connection] ?? '● Unknown'}
      </div>
      {printerName && connection === 'connected' && (
        <div className="text-sm text-gray-600 mt-1">{printerName}</div>
      )}
      {batteryVoltage && (
        <div
          className={`text-sm mt-1 ${(batteryLevel ?? 0) > 50 ? 'text-green-600' : (batteryLevel ?? 0) > 20 ? 'text-yellow-600' : 'text-red-600'}`}
        >
          Battery: {batteryLevel}% {batteryVoltage}
        </div>
      )}
      {!isSupported && (
        <div
          className={`mt-3 rounded-md border p-3 text-sm ${
            webBluetoothEnv.reason === 'insecure_context'
              ? 'border-amber-300 bg-amber-50 text-amber-950'
              : 'border-red-200 bg-red-50 text-red-950'
          }`}
        >
          <p className="font-medium">{webBluetoothEnv.headline}</p>
          <p className="mt-1.5 leading-snug text-[0.8125rem] opacity-95">{webBluetoothEnv.detail}</p>
        </div>
      )}
    </div>
  );
}

interface ActivityLogEntry {
  id: string;
  time: string;
  level: BluetoothLogLevel;
  message: string;
}

export default function App() {
  const showLogPanel =
    typeof window !== 'undefined' &&
    (() => {
      const raw = new URLSearchParams(window.location.search).get('log');
      if (raw == null) return false;
      const value = raw.trim().toLowerCase();
      return value !== '0' && value !== 'false' && value !== 'off';
    })();
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const addLog = useCallback(
    (level: BluetoothLogLevel, message: string) => {
      if (!showLogPanel) return;
      const id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      const time = new Date().toLocaleTimeString();
      setActivityLog((prev) => {
        const next = [...prev, { id, time, level, message }];
        return next.length > 250 ? next.slice(next.length - 250) : next;
      });
    },
    [showLogPanel],
  );

  const {
    connection,
    isSupported,
    webBluetoothEnv,
    gattProfile,
    startScan,
    disconnect,
    writeData,
    printerName,
  } = useBluetooth({ onLog: addLog });

  const [printHint, setPrintHint] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHint = useCallback((tone: 'ok' | 'err' | 'info', text: string, ms = 5000) => {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setPrintHint({ tone, text });
    hintTimer.current = setTimeout(() => {
      setPrintHint(null);
      hintTimer.current = null;
    }, ms);
  }, []);

  useEffect(
    () => () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );

  const printProcessed = useCallback(
    async (img: ProcessedImage, logLabel: string) => {
      if (connection.status !== 'connected') {
        showHint('err', 'Connect a printer first');
        return;
      }
      try {
        if (gattProfile === 'mini_ae30') {
          showHint('info', 'Printing…');
          addLog('info', 'Printing receipt...');
          await miniCatPrepare(writeData, { printerName: printerName ?? '' });
          await miniPrintProcessedImage(writeData, img);
          await miniCatFinish(writeData);
          showHint('ok', 'Receipt sent');
          addLog('info', 'Receipt sent');
          return;
        }
        showHint('info', 'Printing…');
        addLog('info', 'Printing receipt...');
        await writeData(initPrinter());
        await new Promise((r) => setTimeout(r, 500));
        await writeData(startRaster());
        await new Promise((r) => setTimeout(r, 500));
        await writeData(rasterImage(img.width, img.height, img.data));
        await new Promise((r) => setTimeout(r, Math.max(1, img.data.length / 5000) * 1000));
        await writeData(endRaster());
        await new Promise((r) => setTimeout(r, 1000));
        showHint('ok', 'Receipt sent');
        addLog('info', 'Receipt sent');
      } catch (e) {
        console.error(logLabel, e);
        showHint('err', e instanceof Error ? e.message : String(e), 8000);
        addLog('error', `${logLabel}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [connection.status, gattProfile, writeData, printerName, showHint, addLog],
  );

  const printReceipt = useCallback(
    async (logo: File | null, payload: ReceiptPrintInput) => {
      try {
        const segments: ProcessedImage[] = [];
        if (logo) {
          segments.push(await processImage(logo, { maxHeightPx: RECEIPT_LOGO_MAX_HEIGHT_PX }));
        }
        if (receiptHasContent(payload)) {
          const plan = buildReceiptDrawPlan(payload);
          if (plan.length > 0) {
            segments.push(await renderReceiptToImage(plan, true));
          }
        }
        if (segments.length === 0) {
          showHint('err', 'Add logo and/or receipt content to print');
          return;
        }
        const stackGap = segments.length > 1 ? 12 : 0;
        const combined =
          segments.length === 1 ? segments[0]! : stackProcessedImagesVertically(segments, stackGap);
        await printProcessed(combined, 'Receipt');
      } catch (e) {
        console.error('Print error:', e);
        showHint('err', e instanceof Error ? e.message : String(e), 8000);
        addLog('error', `Print error: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [printProcessed, showHint, addLog],
  );

  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4 lg:max-w-5xl">
      <h1 className="text-2xl font-bold text-center">Receipt</h1>

      <BluetoothPanel
        connection={connection.status}
        isSupported={isSupported}
        webBluetoothEnv={webBluetoothEnv}
        onScan={startScan}
        onDisconnect={disconnect}
        batteryLevel={connection.batteryLevel}
        batteryVoltage={connection.batteryVoltage}
        printerName={printerName}
      />

      {printHint && (
        <p
          role="status"
          className={
            printHint.tone === 'err'
              ? 'text-sm text-red-600 text-center'
              : printHint.tone === 'ok'
                ? 'text-sm text-green-700 text-center'
                : 'text-sm text-gray-600 text-center'
          }
        >
          {printHint.text}
        </p>
      )}

      <ReceiptPanel onPrintReceipt={printReceipt} />

      {showLogPanel && (
        <div className="border rounded-lg p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Activity log</h2>
            <button
              type="button"
              onClick={() => setActivityLog([])}
              className="text-xs text-gray-600 hover:underline"
              disabled={activityLog.length === 0}
            >
              Clear
            </button>
          </div>
          <div className="max-h-56 overflow-auto rounded border bg-gray-50 p-2">
            {activityLog.length === 0 ? (
              <p className="text-xs text-gray-500">No events yet.</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {activityLog.map((entry) => (
                  <li key={entry.id} className="font-mono">
                    <span className="text-gray-500">[{entry.time}]</span>{' '}
                    <span className={entry.level === 'error' ? 'text-red-700' : 'text-gray-700'}>
                      {entry.level.toUpperCase()}
                    </span>{' '}
                    <span className="text-gray-800">{entry.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-500">Shown because query string contains <code>log</code>.</p>
        </div>
      )}
    </div>
  );
}
