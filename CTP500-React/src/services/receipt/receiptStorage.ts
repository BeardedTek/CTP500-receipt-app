export const LS_RECEIPT_TAX = 'ctp500.receipt.taxPercent';
export const LS_RECEIPT_FOOTER = 'ctp500.receipt.footer';
export const LS_RECEIPT_HEADER = 'ctp500.receipt.header';
/** Full data URL (`data:image/...;base64,...`) — can be large; may hit quota on huge originals */
export const LS_RECEIPT_LOGO_DATA_URL = 'ctp500.receipt.logoDataUrl';

export function loadReceiptTaxPercent(): string {
  try {
    return localStorage.getItem(LS_RECEIPT_TAX) ?? '';
  } catch {
    return '';
  }
}

export function saveReceiptTaxPercent(value: string): void {
  try {
    localStorage.setItem(LS_RECEIPT_TAX, value);
  } catch {
    /* private mode / quota */
  }
}

export function loadReceiptFooter(): string {
  try {
    return localStorage.getItem(LS_RECEIPT_FOOTER) ?? '';
  } catch {
    return '';
  }
}

export function saveReceiptFooter(value: string): void {
  try {
    localStorage.setItem(LS_RECEIPT_FOOTER, value);
  } catch {
    /* ignore */
  }
}

export function loadReceiptHeader(): string {
  try {
    return localStorage.getItem(LS_RECEIPT_HEADER) ?? '';
  } catch {
    return '';
  }
}

export function saveReceiptHeader(value: string): void {
  try {
    localStorage.setItem(LS_RECEIPT_HEADER, value);
  } catch {
    /* ignore */
  }
}

export function loadReceiptLogoDataUrl(): string | null {
  try {
    const v = localStorage.getItem(LS_RECEIPT_LOGO_DATA_URL);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveReceiptLogoDataUrl(dataUrl: string): void {
  try {
    localStorage.setItem(LS_RECEIPT_LOGO_DATA_URL, dataUrl);
  } catch {
    /* quota */
  }
}

export function clearReceiptLogoDataUrl(): void {
  try {
    localStorage.removeItem(LS_RECEIPT_LOGO_DATA_URL);
  } catch {
    /* ignore */
  }
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('FileReader failed'));
    r.readAsDataURL(file);
  });
}

export async function dataUrlToFile(dataUrl: string, filenameBase = 'receipt-logo'): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const mime = blob.type || 'image/png';
  let ext = 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpg';
  else if (mime.includes('webp')) ext = 'webp';
  else if (mime.includes('bmp')) ext = 'bmp';
  return new File([blob], `${filenameBase}.${ext}`, { type: mime });
}
