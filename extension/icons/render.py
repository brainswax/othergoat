#!/usr/bin/env python3
"""Rasterize icon.svg into Chrome PNG sizes (16, 32, 48, 128)."""

from __future__ import annotations

import math
import re
import struct
import zlib
from pathlib import Path

BLACK = (0x11, 0x11, 0x11, 255)
WHITE = (0xFF, 0xFF, 0xFF, 255)
CLEAR = (0, 0, 0, 0)
SSAA = 6
SIZES = (16, 32, 48, 128)
VIEW = 32.0
RADIUS = 7.0


def write_png(path: Path, width: int, height: int, pixels: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * stride : (y + 1) * stride])
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def tokenize(d: str) -> list[tuple[str, list[float]]]:
    parts = re.findall(r"[MmLlCcZz]|-?\d*\.?\d+(?:e[-+]?\d+)?", d)
    cmds: list[tuple[str, list[float]]] = []
    i = 0
    while i < len(parts):
        token = parts[i]
        if re.match(r"[MmLlCcZz]", token):
            cmd = token
            i += 1
            nums: list[float] = []
            while i < len(parts) and not re.match(r"[MmLlCcZz]", parts[i]):
                nums.append(float(parts[i]))
                i += 1
            cmds.append((cmd, nums))
        else:
            raise ValueError(f"unexpected path token {token}")
    return cmds


def cubic_point(p0, p1, p2, p3, t: float):
    u = 1 - t
    return (
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    )


def flatten(d: str, steps: int = 20) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    cx = cy = 0.0
    start = (0.0, 0.0)
    for cmd, nums in tokenize(d):
        op = cmd.upper()
        rel = cmd.islower()
        if op == "Z":
            if points and points[-1] != start:
                points.append(start)
            continue
        i = 0
        while i < len(nums):
            if op == "M":
                nx, ny = nums[i], nums[i + 1]
                if rel:
                    nx += cx
                    ny += cy
                cx, cy = nx, ny
                start = (cx, cy)
                points.append((cx, cy))
                i += 2
                op = "L"
            elif op == "L":
                nx, ny = nums[i], nums[i + 1]
                if rel:
                    nx += cx
                    ny += cy
                cx, cy = nx, ny
                points.append((cx, cy))
                i += 2
            elif op == "C":
                x1, y1, x2, y2, nx, ny = nums[i : i + 6]
                if rel:
                    x1 += cx
                    y1 += cy
                    x2 += cx
                    y2 += cy
                    nx += cx
                    ny += cy
                p0 = (cx, cy)
                p1 = (x1, y1)
                p2 = (x2, y2)
                p3 = (nx, ny)
                for s in range(1, steps + 1):
                    points.append(cubic_point(p0, p1, p2, p3, s / steps))
                cx, cy = nx, ny
                i += 6
            else:
                raise ValueError(f"unsupported path command {cmd}")
    return points


def in_polygon(px: float, py: float, poly: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(poly) - 1
    for i, (xi, yi) in enumerate(poly):
        xj, yj = poly[j]
        if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi + 0.0) + xi:
            inside = not inside
        j = i
    return inside


def in_round_rect(px: float, py: float) -> bool:
    half = VIEW / 2
    dx = abs(px - half) - (half - RADIUS)
    dy = abs(py - half) - (half - RADIUS)
    ox = max(dx, 0)
    oy = max(dy, 0)
    return math.hypot(ox, oy) + min(max(dx, dy), 0) - RADIUS <= 0


def mix(samples: list[tuple[int, int, int, int]]) -> tuple[int, int, int, int]:
    n = len(samples)
    return (
        sum(s[0] for s in samples) // n,
        sum(s[1] for s in samples) // n,
        sum(s[2] for s in samples) // n,
        sum(s[3] for s in samples) // n,
    )


def path_ds(svg: str) -> list[str]:
    return re.findall(r"<path[^>]*\sd=\"([^\"]+)\"", svg)


def ellipses(svg: str) -> list[tuple[float, float, float, float]]:
    found = []
    for tag in re.findall(r"<ellipse\b[^>]*>", svg):
        cx = float(re.search(r'\bcx="([^"]+)"', tag).group(1))
        cy = float(re.search(r'\bcy="([^"]+)"', tag).group(1))
        rx = float(re.search(r'\brx="([^"]+)"', tag).group(1))
        ry = float(re.search(r'\bry="([^"]+)"', tag).group(1))
        found.append((cx, cy, rx, ry))
    return found


def ellipse_poly(cx: float, cy: float, rx: float, ry: float, n: int = 48) -> list[tuple[float, float]]:
    return [
        (cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n))
        for i in range(n)
    ]


def goat_polys(svg: str) -> list[list[tuple[float, float]]]:
    polys = [flatten(d) for d in path_ds(svg)]
    polys.extend(ellipse_poly(*e) for e in ellipses(svg))
    return polys


def in_goat(px: float, py: float, polys: list[list[tuple[float, float]]]) -> bool:
    return any(in_polygon(px, py, poly) for poly in polys)


def render(size: int, polys: list[list[tuple[float, float]]]) -> bytes:
    out = bytearray(size * size * 4)
    scale = VIEW / size
    for y in range(size):
        for x in range(size):
            samples = []
            for sy in range(SSAA):
                for sx in range(SSAA):
                    px = (x + (sx + 0.5) / SSAA) * scale
                    py = (y + (sy + 0.5) / SSAA) * scale
                    if not in_round_rect(px, py):
                        samples.append(CLEAR)
                    elif in_goat(px, py, polys):
                        samples.append(WHITE)
                    else:
                        samples.append(BLACK)
            r, g, b, a = mix(samples)
            i = (y * size + x) * 4
            out[i : i + 4] = bytes((r, g, b, a))
    return bytes(out)


def main() -> None:
    dest = Path(__file__).resolve().parent
    svg = (dest / "icon.svg").read_text()
    polys = goat_polys(svg)
    if not polys:
        raise SystemExit("icon.svg has no goat shapes")
    for size in SIZES:
        path = dest / f"icon{size}.png"
        write_png(path, size, size, render(size, polys))
        print(path.name)


if __name__ == "__main__":
    main()
