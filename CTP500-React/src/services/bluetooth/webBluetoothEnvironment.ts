export type WebBluetoothBlockReason = 'ok' | 'insecure_context' | 'missing_api';

export type WebBluetoothEnvironment = {
  canUse: boolean;
  reason: WebBluetoothBlockReason;
  /** Short label for the panel */
  headline: string;
  /** What to do — shown when canUse is false */
  detail: string;
};

/**
 * Web Bluetooth (including Chrome on Android) is only available in a secure context.
 * `http://YOUR_LAN_IP:5173` is not secure, so `navigator.bluetooth` is missing — not a browser bug.
 */
export function getWebBluetoothEnvironment(): WebBluetoothEnvironment {
  if (typeof window === 'undefined') {
    return {
      canUse: false,
      reason: 'missing_api',
      headline: 'Web Bluetooth unavailable',
      detail: 'No window / browser environment.',
    };
  }

  if (!window.isSecureContext) {
    return {
      canUse: false,
      reason: 'insecure_context',
      headline: 'Use HTTPS to connect from Android',
      detail:
        'Chrome only exposes Web Bluetooth on HTTPS (or http://localhost on the same machine). If you opened this app as http:// plus your PC’s IP, switch to HTTPS: from the project folder run npm run dev:https, trust the certificate warning once, then open the https://… URL on your phone. On the phone, use Google Chrome (not Samsung Internet). Bluetooth scanning on Android also needs Location on and Chrome’s location permission.',
    };
  }

  const bt = navigator.bluetooth;
  if (!bt || typeof bt.requestDevice !== 'function') {
    return {
      canUse: false,
      reason: 'missing_api',
      headline: 'Web Bluetooth not in this browser',
      detail:
        'Use an up-to-date Google Chrome on Android. Samsung Internet, Firefox, and most in-app browsers do not implement Web Bluetooth.',
    };
  }

  return {
    canUse: true,
    reason: 'ok',
    headline: '',
    detail: '',
  };
}
