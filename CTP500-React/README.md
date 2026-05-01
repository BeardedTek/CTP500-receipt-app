# CTP500 Receipt Frontend

React + TypeScript + Vite frontend for `CTP500-receipt-app`.

## Install

```bash
npm install
```

## Development

Standard dev server:

```bash
npm run dev
```

LAN dev server:

```bash
npm run dev:host
```

HTTPS dev server (required for Web Bluetooth on Android):

```bash
npm run dev:https
```

Debug variants:

```bash
npm run dev:debug
npm run dev:debug:host
npm run dev:https:debug
```

## Build

```bash
npm run build
```

## Activity Log

Enable the on-screen activity log via querystring:

- `?log`
- `?log=1`
- `?log=true`

Disable with:

- `?log=0`
- `?log=false`
- `?log=off`

## Docker Deployment

Run production container from the repository root (Nginx serving Vite `dist/`):

```bash
docker compose up --build -d
```

Open `http://localhost:8080`.

Useful commands:

```bash
docker compose logs -f
docker compose down
```

For Traefik labels, use `docker-compose.traefik.yml` from the repository root and move/copy it to `docker-compose.override.yml` when enabling Traefik defaults.
