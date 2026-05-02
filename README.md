# CTP500-receipt-app

Receipt-focused Web Bluetooth app for CTP500-class thermal printers.

This project provides a browser UI to connect to compatible BLE printers and print receipt layouts with:

- optional logo
- multi-line centered header/footer
- item/qty/cost rows
- subtotal, discount, tax, and total
- live print preview

Repository: [BeardedTek/CTP500-receipt-app](https://github.com/BeardedTek/CTP500-receipt-app)

## Requirements

- Browser: Google Chrome (desktop or Android)
- Printer: CTP500-compatible BLE printer (name prefix `S` or `Mini Printer`)
- For Android: Bluetooth ON, Location ON, and Location permission for Chrome
- Web Bluetooth requires a secure context:
  - `https://...` on networked devices
  - `http://localhost` only on the same machine

## Local Development

```bash
git clone https://github.com/BeardedTek/CTP500-receipt-app.git
cd CTP500-receipt-app/CTP500-React
npm install
```

### Start dev server

```bash
npm run dev
```

### Start dev server with HTTPS (recommended for Android testing)

```bash
npm run dev:https
```

Open the printed URL (for example `https://<your-lan-ip>:5173`) on your phone and accept the dev certificate warning once.

## Activity Log Toggle

The in-app activity log is hidden by default and can be enabled with querystring:

- `?log`
- `?log=1`
- `?log=true`

Disabled values include `?log=0`, `?log=false`, `?log=off`.

## Docker Deployment

From the repository root:

```bash
docker compose up --build -d
```

Then open `http://localhost:8080`.

Useful commands:

```bash
docker compose logs -f
docker compose down
```

### GitHub Container Registry (GHCR)

This repo includes a GitHub Action at `.github/workflows/publish-ghcr.yml` that publishes the Docker image to GHCR:

- triggers on pushes to `main`
- triggers on tags matching `v*`
- supports manual runs via workflow dispatch

Published image path:

- `ghcr.io/beardedtek/ctp500-receipt-app`

Typical tags include branch/tag names, short SHA, and `latest` on the default branch.

### Traefik setup

The repo includes `docker-compose.traefik.yml`. If you want Traefik labels to be auto-applied by default, move or copy it to `docker-compose.override.yml`:

```bash
cp docker-compose.traefik.yml docker-compose.override.yml
```

## BLE Technical Notes

Built-in printers live in `CTP500-React/public/printers.yaml` (site root). User printers are YAML fragments in `CTP500-React/public/printers/<id>.yaml`. The app discovers them by fetching **`GET /printers/`**, which returns **JSON** (nginx `autoindex_format json` in the shipped image; Vite dev/preview serves the same shape). Every `*.yaml` in that folder except `manifest.yaml` is merged **after** the built-in list (sorted by file name). **`manifest.yaml` is optional**: use it for `extra_optional_services` and, only if `/printers/` is not available as JSON, a `printers:` id list. The catalog **re-fetches on each full page load** (no JS rebuild needed for edits).

Docker Compose bind-mounts `./CTP500-React/public/printers` to `/usr/share/nginx/html/printers` so you can drop new YAML files on the host without rebuilding the image; built-ins stay in the image from `printers.yaml` unless you rebuild with a changed file.

Use the in-app helper at **`/printer-setup`** (link on the receipt page) to pick any BLE device, inspect its GATT services, and copy a starter YAML fragment into `public/printers/<printer_id>.yaml`.

The app currently ships with:

- CTP500 UART-style service
- Mini AE30 service

Core CTP500 UUIDs:

| Role | UUID |
| --- | --- |
| Service | `49535343-fe7d-4ae5-8fa9-9fafd205e455` |
| Write (TX) | `49535343-8841-43f4-a8d4-ecbe34729bb3` |
| Notify (RX) | `49535343-1e4d-4bd9-ba61-23c647249616` |

Print data is rendered to 1-bit raster and sent in BLE chunks sized to the negotiated MTU.
