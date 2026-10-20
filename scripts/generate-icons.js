// Draws the GhostBrowse icons (a ghost) and writes them as PNGs into icons/.
// No dependencies: shapes are rasterized with supersampling and encoded with zlib.
//
//   node scripts/generate-icons.js

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { crc32 } from "./crc32.js";

const OUT = fileURLToPath(new URL("../icons/", import.meta.url));

const PALETTES = {
  on:  { top: [139, 108, 255], bottom: [84, 52, 200], eye: [255, 255, 255] },
  off: { top: [168, 168, 176], bottom: [110, 110, 118], eye: [255, 255, 255] }
};

// Ghost geometry in a unit box: round head, straight sides, scalloped hem.
const HEAD = { cx: 0.5, cy: 0.42, r: 0.36 };
const BODY = { x0: 0.14, x1: 0.86, y0: 0.42, y1: 0.84 };
const HEM_R = (BODY.x1 - BODY.x0) / 6;
const HEM = [1, 3, 5].map((i) => ({ cx: BODY.x0 + HEM_R * i, cy: BODY.y1, r: HEM_R }));

function inCircle(x, y, c) {
  return (x - c.cx) ** 2 + (y - c.cy) ** 2 <= c.r ** 2;
}

function inGhost(x, y) {
  if (inCircle(x, y, HEAD)) return true;
  if (x >= BODY.x0 && x <= BODY.x1 && y >= BODY.y0 && y <= BODY.y1) return true;
  return HEM.some((c) => inCircle(x, y, c));
}

// Eyes are drawn larger on tiny icons so they stay visible.
function inEye(x, y, size) {
  const rx = size <= 16 ? 0.085 : 0.07;
  const ry = size <= 16 ? 0.12 : 0.1;
  return [0.37, 0.63].some((ex) => ((x - ex) / rx) ** 2 + ((y - 0.42) / ry) ** 2 <= 1);
}

function render(size, palette) {
  // Bigger icons get transparent padding, as the Chrome Web Store recommends.
  const margin = size >= 128 ? 0.125 : size >= 48 ? 0.06 : 0;
  const box = size * (1 - margin * 2);
  const off = size * margin;
  const ss = size <= 32 ? 8 : 4;
  const px = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (pxl + (sx + 0.5) / ss - off) / box;
          const y = (py + (sy + 0.5) / ss - off) / box;
          if (!inGhost(x, y)) continue;
          const t = Math.min(1, Math.max(0, y));
          const color = inEye(x, y, size)
            ? palette.eye
            : palette.top.map((c, i) => c + (palette.bottom[i] - c) * t);
          r += color[0]; g += color[1]; b += color[2]; a += 1;
        }
      }
      const i = (py * size + pxl) * 4;
      if (a) {
        px[i] = Math.round(r / a);
        px[i + 1] = Math.round(g / a);
        px[i + 2] = Math.round(b / a);
        px[i + 3] = Math.round((a / (ss * ss)) * 255);
      }
    }
  }
  return px;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

mkdirSync(OUT, { recursive: true });
const outputs = [
  ...[16, 32, 48, 128].map((size) => [size, "on", `icon${size}.png`]),
  ...[16, 32].map((size) => [size, "off", `icon${size}-off.png`])
];
for (const [size, variant, name] of outputs) {
  writeFileSync(OUT + name, encodePng(size, render(size, PALETTES[variant])));
  console.log("wrote icons/" + name);
}
