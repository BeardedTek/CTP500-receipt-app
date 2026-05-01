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

From `CTP500-React`:

```bash
docker compose up --build -d
```

Then open `http://localhost:8080`.

Useful commands:

```bash
docker compose logs -f
docker compose down
```

## BLE Technical Notes

The app supports two known printer profiles:

- CTP500 UART-style service
- Mini AE30 service

Core CTP500 UUIDs:

| Role | UUID |
| --- | --- |
| Service | `49535343-fe7d-4ae5-8fa9-9fafd205e455` |
| Write (TX) | `49535343-8841-43f4-a8d4-ecbe34729bb3` |
| Notify (RX) | `49535343-1e4d-4bd9-ba61-23c647249616` |

Print data is rendered to 1-bit raster and sent in BLE chunks sized to the negotiated MTU.
