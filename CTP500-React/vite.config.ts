import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin, type ResolvedConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

/** Match nginx `autoindex_format json` so the client can use one parser in dev and production. */
function printersDirJsonPlugin(): Plugin {
  let resolved!: ResolvedConfig;

  function isPrintersIndexPath(urlPath: string, base: string): boolean {
    const pathname = urlPath.split('?')[0].replace(/\/$/, '') || '/';
    const normalizedBase = base === '/' ? '' : base.replace(/\/$/, '');
    const target = normalizedBase === '' ? '/printers' : `${normalizedBase}/printers`;
    return pathname === target;
  }

  function sendPrintersJson(res: { setHeader: (k: string, v: string) => void; end: (b: string) => void }) {
    const dir = path.join(resolved.root, 'public/printers');
    const rows: Array<{ name: string; type: string; mtime: string; size: number }> = [];
    try {
      if (!fs.existsSync(dir)) {
        res.setHeader('Content-Type', 'application/json');
        res.end('[]');
        return;
      }
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (!ent.isFile()) continue;
        const { name } = ent;
        if (!/\.ya?ml$/i.test(name)) continue;
        if (/^manifest\.ya?ml$/i.test(name) || /^printers\.ya?ml$/i.test(name)) continue;
        const full = path.join(dir, name);
        const st = fs.statSync(full);
        rows.push({
          name,
          type: 'file',
          mtime: st.mtime.toUTCString(),
          size: st.size,
        });
      }
      rows.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      res.setHeader('Content-Type', 'application/json');
      res.end('[]');
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(rows));
  }

  return {
    name: 'printers-directory-json',
    configResolved(config) {
      resolved = config;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' || !req.url) return next();
        if (!isPrintersIndexPath(req.url, resolved.base)) return next();
        sendPrintersJson(res);
        return;
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== 'GET' || !req.url) return next();
        if (!isPrintersIndexPath(req.url, resolved.base)) return next();
        sendPrintersJson(res);
        return;
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    printersDirJsonPlugin(),
    react(),
    tailwindcss(),
    ...(mode === 'https' ? [basicSsl()] : []),
  ],
}));
