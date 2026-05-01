#!/usr/bin/env python3
"""
Discover a BLE thermal printer and dump GATT services/characteristics.

Run on the same machine as the printer (Bluetooth radio required).
Install:  py -3.11 -m pip install -r scripts/requirements-ble.txt

Examples:
  py -3.11 scripts/ble_printer_discover.py scan
  py -3.11 scripts/ble_printer_discover.py scan --name "Mini Printer" --verbose
  py -3.11 scripts/ble_printer_discover.py dump --address AA:BB:CC:DD:EE:FF
  py -3.11 scripts/ble_printer_discover.py dump-scan --name "Mini" --scan-timeout 20
  py -3.11 scripts/ble_printer_discover.py sweep --name "Mini" --timeout 15

If Windows still hides services, use nRF Connect (phone/desktop) or Microsoft's
"Bluetooth LE Explorer" from the Store to read GATT without Python.

Background (similar idea to phone HCI logs in reverse-engineering writeups):
  https://thirtythreedown.com/2025/11/02/pc-app-for-walmart-thermal-printer/
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from dataclasses import dataclass
from typing import Iterable

from bleak import BleakClient, BleakScanner
from bleak.backends.characteristic import BleakGATTCharacteristic
from bleak.backends.device import BLEDevice
from bleak.backends.scanner import AdvertisementData


def _match_device(needle: str, d: BLEDevice, adv: AdvertisementData | None) -> bool:
    needle = needle.strip().lower()
    if not needle:
        return True
    local = (adv.local_name or "") if adv else ""
    name = f"{d.name or ''} {local}".strip()
    return needle in name.lower()


def _fmt_props(props: Iterable[str] | str | None) -> str:
    if props is None:
        return ""
    if isinstance(props, str):
        return props
    return ",".join(sorted(props))


def _ascii_preview(data: bytes | bytearray) -> str:
    try:
        text = bytes(data).decode("ascii")
    except UnicodeDecodeError:
        return ""
    if all(32 <= ord(c) < 127 or c in "\r\n\t" for c in text):
        return repr(text)
    return ""


async def _safe_read(client: BleakClient, char: BleakGATTCharacteristic) -> bytes | None:
    props = char.properties
    if isinstance(props, str):
        can_read = "read" in props.lower()
    else:
        can_read = "read" in props
    if not can_read:
        return None
    try:
        return await client.read_gatt_char(char)
    except Exception as e:  # noqa: BLE001 - diagnostic tool
        print(f"    read skipped: {e}")
        return None


def _adv_service_uuids(adv: AdvertisementData | None) -> list[str]:
    if not adv or not adv.service_uuids:
        return []
    return list(adv.service_uuids)


async def _collect_scan_matches(needle: str, timeout: float) -> dict[str, tuple[BLEDevice, AdvertisementData | None]]:
    found: list[tuple[BLEDevice, AdvertisementData | None]] = []
    needle_l = needle.strip().lower()

    if needle_l:

        def detection_callback(device: BLEDevice, advertisement_data: AdvertisementData) -> None:
            if _match_device(needle_l, device, advertisement_data):
                found.append((device, advertisement_data))

        async with BleakScanner(detection_callback=detection_callback):
            await asyncio.sleep(timeout)
    else:
        devices = await BleakScanner.discover(timeout=timeout)
        for d in devices:
            found.append((d, None))

    by_addr: dict[str, tuple[BLEDevice, AdvertisementData | None]] = {}
    for d, adv in found:
        if not _match_device(needle_l, d, adv):
            continue
        cur = by_addr.get(d.address)
        if cur is None or (d.name and not cur[0].name):
            by_addr[d.address] = (d, adv)
    return by_addr


def _pick_best_device(by_addr: dict[str, tuple[BLEDevice, AdvertisementData | None]]) -> tuple[BLEDevice, AdvertisementData | None] | None:
    if not by_addr:
        return None

    def score(item: tuple[BLEDevice, AdvertisementData | None]) -> tuple[int, int]:
        d, adv = item
        uuids = _adv_service_uuids(adv)
        rssi = adv.rssi if adv and adv.rssi is not None else -999
        return (len(uuids), rssi)

    return max(by_addr.values(), key=score)


async def cmd_scan(args: argparse.Namespace) -> int:
    by_addr = await _collect_scan_matches(args.name, args.timeout)
    if not by_addr:
        print("No devices matched. Try a longer --timeout or a broader --name.", file=sys.stderr)
        return 1

    print(f"{'Address':<18} {'RSSI':>5}  Name / local name")
    print("-" * 60)
    for addr, (d, adv) in sorted(by_addr.items(), key=lambda x: x[0]):
        rssi = adv.rssi if adv else "?"
        local = getattr(adv, "local_name", None) if adv else None
        bits = [d.name or "(no name)"]
        if local and local != d.name:
            bits.append(f"adv:{local}")
        print(f"{addr:<18} {str(rssi):>5}  {' | '.join(bits)}")
        if args.verbose and adv:
            su = _adv_service_uuids(adv)
            if su:
                print(f"           advertised service_uuids: {', '.join(su)}")
            if adv.manufacturer_data:
                for k, v in adv.manufacturer_data.items():
                    hx = v.hex(" ") if v else ""
                    print(f"           manufacturer 0x{k:04X}: {hx}")
    return 0


def _winrt_opts(args: argparse.Namespace) -> dict[str, object]:
    w: dict[str, object] = {}
    if args.use_cached_services:
        w["use_cached_services"] = True
    else:
        w["use_cached_services"] = False
    if getattr(args, "address_type", None):
        w["address_type"] = args.address_type
    return w


def _gatt_counts(client: BleakClient) -> tuple[int, int, list[str]]:
    """Return (num_services, num_characteristics, service_uuids_lower)."""
    svc_list = list(client.services)
    n_char = sum(len(s.characteristics) for s in svc_list)
    uuids = [s.uuid.lower() for s in svc_list]
    return len(svc_list), n_char, uuids


async def _print_gatt_tree(client: BleakClient) -> tuple[int, list[str]]:
    services = client.services
    svc_list = list(services)
    for svc in svc_list:
        print()
        print(f"Service {svc.uuid}")
        if svc.description and svc.description != str(svc.uuid):
            print(f"  description: {svc.description}")
        for char in svc.characteristics:
            props = _fmt_props(char.properties)
            print(f"  Characteristic {char.uuid}")
            print(f"    properties: {props}")
            if char.descriptors:
                for desc in char.descriptors:
                    print(f"    descriptor {desc.uuid}")
            data = await _safe_read(client, char)
            if data is not None:
                preview = data[:64]
                hexed = preview.hex(" ")
                tip = _ascii_preview(preview)
                if tip:
                    tip = f"  ({tip})"
                print(f"    read: {len(data)} bytes: {hexed}{' …' if len(data) > 64 else ''}{tip}")
    uuids = [s.uuid.lower() for s in svc_list]
    return len(svc_list), uuids


def _incomplete_gatt_hint(svc_count: int, uuids_lower: list[str]) -> None:
    ctp_uart = "49535343-fe7d-4ae5-8fa9-9fafd205e455"
    mini_main = "0000ae30-0000-1000-8000-00805f9b34fb"
    if ctp_uart in uuids_lower or mini_main in uuids_lower:
        return
    if svc_count > 3:
        return
    print(file=sys.stderr)
    print(
        "Note: GATT table still looks small (no known CTP UART service). "
        "Windows often hides vendor services until pairing/cache is right.",
        file=sys.stderr,
    )
    print(
        "Try:  dump-scan / sweep  (uses BLEDevice from live scan),  --address-type random|public,  "
        "--pair-before / --pair,  remove device in Windows Bluetooth settings,  "
        "restart Bluetooth (services.msc → Bluetooth Support Service),  "
        "or use nRF Connect / Bluetooth LE Explorer to read GATT.",
        file=sys.stderr,
    )


async def cmd_dump(args: argparse.Namespace) -> int:
    address = args.address.strip()
    winrt = _winrt_opts(args)

    print(f"Connecting to {address} ...")
    print(f"WinRT options: {winrt}")
    try:
        async with BleakClient(
            address,
            timeout=args.timeout,
            pair=args.pair_before,
            winrt=winrt,
        ) as client:
            if args.pair:
                print("Pairing (if required by device/OS)...")
                await client.pair()

            print(f"Connected: {client.is_connected}")
            if client.mtu_size:
                print(f"MTU: {client.mtu_size}")

            if args.post_connect_delay > 0:
                await asyncio.sleep(args.post_connect_delay)

            n, uuids = await _print_gatt_tree(client)
            _incomplete_gatt_hint(n, uuids)
    except Exception as e:  # noqa: BLE001
        print(f"Error: {e}", file=sys.stderr)
        return 1
    return 0


async def cmd_dump_scan(args: argparse.Namespace) -> int:
    needle = args.name.strip()
    if not needle:
        print("--name is required for dump-scan", file=sys.stderr)
        return 1

    print(f"Scanning {args.scan_timeout}s for name match: {needle!r} ...")
    by_addr = await _collect_scan_matches(needle, args.scan_timeout)
    picked = _pick_best_device(by_addr)
    if not picked:
        print("No matching device found.", file=sys.stderr)
        return 1

    device, adv = picked
    print(f"Picked {device.address}  name={device.name!r}")
    if adv and _adv_service_uuids(adv):
        print(f"Advertised service_uuids: {_adv_service_uuids(adv)}")

    winrt = _winrt_opts(args)
    print(f"Connecting via BLEDevice object ...")
    print(f"WinRT options: {winrt}")

    try:
        async with BleakClient(
            device,
            timeout=args.connect_timeout,
            pair=args.pair_before,
            winrt=winrt,
        ) as client:
            if args.pair:
                print("Pairing (if required by device/OS)...")
                await client.pair()
            print(f"Connected: {client.is_connected}")
            if client.mtu_size:
                print(f"MTU: {client.mtu_size}")
            if args.post_connect_delay > 0:
                await asyncio.sleep(args.post_connect_delay)
            n, uuids = await _print_gatt_tree(client)
            _incomplete_gatt_hint(n, uuids)
    except Exception as e:  # noqa: BLE001
        print(f"Error: {e}", file=sys.stderr)
        return 1
    return 0


@dataclass
class SweepStrategy:
    label: str
    use_ble_device: bool
    address_type: str | None  # None = omit
    use_cached_services: bool
    pair_before: bool
    pair_after: bool


async def cmd_sweep(args: argparse.Namespace) -> int:
    device: BLEDevice | None = None
    adv: AdvertisementData | None = None
    address = (args.address or "").strip()

    if args.name.strip():
        print(f"Scanning {args.timeout}s for {args.name!r} ...")
        by_addr = await _collect_scan_matches(args.name, args.timeout)
        picked = _pick_best_device(by_addr)
        if not picked:
            print("No matching device for sweep.", file=sys.stderr)
            return 1
        device, adv = picked
        print(f"Device: {device.address}  {device.name!r}")
        if adv and _adv_service_uuids(adv):
            print(f"Advertised service_uuids: {_adv_service_uuids(adv)}")
    elif address:
        pass
    else:
        print("sweep requires --name or --address", file=sys.stderr)
        return 1

    strategies = [
        SweepStrategy("BLEDevice + uncached", True, None, False, False, False),
        SweepStrategy("BLEDevice + uncached + pair_before", True, None, False, True, False),
        SweepStrategy("BLEDevice + uncached + pair_after", True, None, False, False, True),
        SweepStrategy("BLEDevice + cached", True, None, True, False, False),
        SweepStrategy("address + uncached + random", False, "random", False, False, False),
        SweepStrategy("address + uncached + public", False, "public", False, False, False),
        SweepStrategy("address + uncached + random + pair_before", False, "random", False, True, False),
    ]

    print()
    print(f"{'Strategy':<45} {'Svcs':>5}  Service UUIDs (first 6)")
    print("-" * 100)

    for st in strategies:
        winrt: dict[str, object] = {"use_cached_services": st.use_cached_services}
        if st.address_type:
            winrt["address_type"] = st.address_type

        target: BLEDevice | str
        if st.use_ble_device:
            if device is None:
                print(f"{st.label:<45} {'skip':>5}  (no BLEDevice; use --name)")
                continue
            target = device
        else:
            if not address and device is not None:
                target = device.address
            elif address:
                target = address
            else:
                print(f"{st.label:<45} {'skip':>5}  (no address)")
                continue

        try:
            async with BleakClient(
                target,
                timeout=args.timeout,
                pair=st.pair_before,
                winrt=winrt,
            ) as client:
                if st.pair_after:
                    await client.pair()
                if args.post_connect_delay > 0:
                    await asyncio.sleep(args.post_connect_delay)
                n_svc, n_char, uuids = _gatt_counts(client)
                short = ", ".join(uuids[:6])
                if len(uuids) > 6:
                    short += ", …"
                print(f"{st.label:<45} {n_svc:>3} svcs {n_char:>3} ch  {short}")
        except Exception as e:  # noqa: BLE001
            print(f"{st.label:<45} {'ERR':>5}  {e}")

    print()
    print(
        "If every strategy fails or only shows 0x1800: use Android nRF Connect or "
        "Microsoft Store 'Bluetooth LE Explorer' on this PC, or capture phone↔printer "
        "HCI logs as in the blog post.",
        file=sys.stderr,
    )
    return 0


def _add_dump_flags(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--pair-before",
        action="store_true",
        help="Pair before connecting (BleakClient(pair=True); helps some Windows GATT issues)",
    )
    p.add_argument("--pair", action="store_true", help="Call pair() after connect (some devices need it)")
    p.add_argument(
        "--use-cached-services",
        action="store_true",
        help="Allow Windows to use its GATT cache (default: force fresh read from device)",
    )
    p.add_argument(
        "--address-type",
        choices=("public", "random"),
        default=None,
        help="WinRT Bluetooth address type (try 'random' for peripherals with random static address)",
    )
    p.add_argument(
        "--post-connect-delay",
        type=float,
        default=0.0,
        help="Seconds to wait after connect before dumping (occasionally helps flaky stacks)",
    )


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="BLE scan / GATT dump for thermal printers")
    sub = p.add_subparsers(dest="cmd", required=True)

    ps = sub.add_parser("scan", help="Scan for BLE devices (optionally filter by name substring)")
    ps.add_argument("--timeout", type=float, default=15.0, help="Scan duration in seconds")
    ps.add_argument("--name", type=str, default="", help="Case-insensitive substring to filter names")
    ps.add_argument(
        "--verbose",
        action="store_true",
        help="Show advertised service UUIDs and manufacturer data when available",
    )
    ps.set_defaults(func=cmd_scan)

    pd = sub.add_parser("dump", help="Connect by address and print all services/characteristics")
    pd.add_argument("--address", required=True, help="Bluetooth address, e.g. AA:BB:CC:DD:EE:FF")
    pd.add_argument("--timeout", type=float, default=30.0, help="Connect timeout (seconds)")
    _add_dump_flags(pd)
    pd.set_defaults(func=cmd_dump)

    pds = sub.add_parser(
        "dump-scan",
        help="Scan for --name, connect using BLEDevice from the scan (recommended on Windows)",
    )
    pds.add_argument("--name", required=True, help="Name substring (same as scan --name)")
    pds.add_argument("--scan-timeout", type=float, default=20.0, help="How long to scan for advertisements (seconds)")
    pds.add_argument("--connect-timeout", type=float, default=30.0, help="GATT connect timeout (seconds)")
    _add_dump_flags(pds)
    pds.set_defaults(func=cmd_dump_scan)

    psw = sub.add_parser(
        "sweep",
        help="Try several connection strategies and print service counts (find what works)",
    )
    psw.add_argument("--name", type=str, default="", help="Name substring to scan for")
    psw.add_argument("--address", type=str, default="", help="Bluetooth address (optional if --name matches one device)")
    psw.add_argument("--timeout", type=float, default=25.0, help="Scan (if --name) and per-connect timeout")
    psw.add_argument(
        "--post-connect-delay",
        type=float,
        default=0.5,
        help="Seconds to wait after connect before reading GATT (sweep default 0.5)",
    )
    psw.set_defaults(func=cmd_sweep)

    return p


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return asyncio.run(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
