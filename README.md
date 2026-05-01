# CTP500-receipt-app

A web application for printing text and images over Web Bluetooth to the Core Innovations CTP500 thermal printer (and compatible devices sold as "S Blue/Pink/White/Black Printer"). This is a modern, cross-platform replacement for the legacy Python desktop application.

---

## Live Demo

_Coming soon on Cloudflare Pages_

---

## Requirements

- **Browser:** Google Chrome or Microsoft Edge (Web Bluetooth API required)
- **Operating System:** macOS, Windows, Linux, Android (any OS with supported browser)

---

## Local Development

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/BeardedTek/CTP500-receipt-app.git
    cd CTP500-receipt-app/CTP500-React
    ```

2.  **Install dependencies:**

    ```bash
    bun install
    ```

3.  **Run the development server (with HTTPS for Web Bluetooth):**

    ```bash
    bun run dev
    ```

    The application will be available at `https://localhost:5173/` (or `https://100.120.1.4:5173/` via Tailscale). You may need to accept a self-signed certificate warning in your browser.

---

## Features

### Bluetooth Connection (Web Bluetooth API)

-   **Device Discovery** — Scan and connect to nearby compatible printers (`S Blue Printer`, `S Pink Printer`, etc.) directly from the browser.
-   **Connection Status** — Real-time status indicator (disconnected, scanning, connecting, connected).
-   **Battery Level** — Displays current battery percentage and voltage, updated via printer notifications.
-   **Clean Disconnect** — Ensures proper termination of BLE connection.

### Text Printing

-   **Direct Text Input** — Type or paste text directly into the app.
-   **Text File Upload** — Load and print `.txt` files.
-   **Word Wrapping** — Automatically wraps text to the printer's 384-pixel width.

### Image Printing

-   **Image File Upload** — Load PNG, JPG, JPEG, or BMP images.
-   **Preview** — See a live preview of the image before printing.
-   **Image Processing** — Images are automatically scaled/padded to 384px width and converted to 1-bit monochrome using Canvas API.

### Activity Log

-   **Real-time Logging** — Timestamped log entries for all connection events, printer responses, commands sent, and errors.
-   **Clear Feedback** — Provides detailed insights into the app's interaction with the printer.

---

## Technical Details

The web app communicates with the printer over **Bluetooth Low Energy (BLE)** using the **Generic Attribute Profile (GATT)**.

| Role | UUID |
|---|---|
| Service | `49535343-fe7d-4ae5-8fa9-9fafd205e455` |
| Write (TX) | `49535343-8841-43f4-a8d4-ecbe34729bb3` |
| Notify (RX) | `49535343-1e4d-4bd9-ba61-23c647249616` |

Print data is sent as **ESC/POS raster commands (`GS v 0`)** chunked to the negotiated BLE MTU size. Battery status is parsed from the notify characteristic, providing voltage and estimated percentage.


*This codebase was edited, created, and modified by [Leo](https://github.com/leopham), an OpenClaw AI agent working on behalf of [Quinton Pham](https://github.com/phamousq/).*
