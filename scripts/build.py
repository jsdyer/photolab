"""Copy the static workbench and generate the synthetic example."""
from pathlib import Path
import math
import random
import shutil
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
PNG = b"\x89PNG\r\n\x1a\n"


def ifd(buffer, offset, tags):
    struct.pack_into("<H", buffer, offset, len(tags))
    for index, (tag, kind, count, value) in enumerate(tags):
        entry = offset + 2 + 12 * index
        struct.pack_into("<HHI", buffer, entry, tag, kind, count)
        if len(value) <= 4:
            buffer[entry + 8:entry + 8 + len(value)] = value
        else:
            struct.pack_into("<I", buffer, entry + 8, len(buffer))
            buffer.extend(value)


def example_metadata():
    primary_size, exif_size, gps_size = 6, 6, 4
    exif_offset = 8 + 6 + primary_size * 12
    gps_offset = exif_offset + 6 + exif_size * 12
    result = bytearray(gps_offset + 6 + gps_size * 12)
    result[:8] = b"II" + struct.pack("<HI", 42, 8)
    short = lambda number: struct.pack("<H", number)
    long = lambda number: struct.pack("<I", number)
    rational = lambda numerator, denominator: struct.pack("<II", numerator, denominator)
    ifd(result, 8, [
        (0x010f, 2, 9, b"CoolCode\0"),
        (0x0110, 2, 12, b"Demo camera\0"),
        (0x0112, 3, 1, short(1)),
        (0x0131, 2, 10, b"Photo Lab\0"),
        (0x8769, 4, 1, long(exif_offset)),
        (0x8825, 4, 1, long(gps_offset)),
    ])
    ifd(result, exif_offset, [
        (0x829a, 5, 1, rational(1, 125)),
        (0x829d, 5, 1, rational(4, 1)),
        (0x8827, 3, 1, short(400)),
        (0x9003, 2, 20, b"2026:06:15 20:14:00\0"),
        (0x920a, 5, 1, rational(24, 1)),
        (0xa434, 2, 11, b"Demo 24 mm\0"),
    ])
    ifd(result, gps_offset, [
        (1, 2, 2, b"N\0"),
        (2, 5, 3, b"".join(rational(part, 1) for part in (44, 39, 0))),
        (3, 2, 2, b"W\0"),
        (4, 5, 3, b"".join(rational(part, 1) for part in (63, 34, 48))),
    ])
    return result


def chunk(name, data):
    return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data))


def synthetic_coast():
    width, height = 840, 530
    rng = random.Random(492)
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        v = y / height
        for x in range(width):
            u = x / width
            ridge = .62 + .027 * math.sin(u * 19) + .018 * math.sin(u * 46 + 1)
            ripple = int(5 * math.sin(u * 55 + 280 * v) * math.sin(v * 112))
            glow = math.exp(-18 * ((u - .68) ** 2 + (v - .57) ** 2))
            noise = rng.randrange(-3, 4)
            if v > .7:
                red, green, blue = 32 + 32 * glow + ripple, 51 + 32 * glow + ripple, 55 + 31 * glow + ripple
            elif v > ridge:
                red, green, blue = 26 + 7 * glow, 38 + 8 * glow, 34 + 8 * glow
            else:
                red, green, blue = 24 + 188 * glow, 45 + 109 * glow, 79 + 45 * glow
                if (u - .683) ** 2 + ((v - .48) * height / width) ** 2 < .023 ** 2:
                    red, green, blue = 253, 227, 156
            raw.extend(int(max(0, min(255, level + noise))) for level in (red, green, blue))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return PNG + chunk(b"IHDR", header) + chunk(b"eXIf", example_metadata()) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def main():
    target = ROOT / "dist"
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(ROOT / "web", target)
    (target / "sample.png").write_bytes(synthetic_coast())
    print("Built Photo Lab and its synthetic example.")


if __name__ == "__main__":
    main()
