// Builds the store packages from the extension files only (no tests, scripts, or node_modules):
//
//   dist/ghostbrowse-<version>.zip           Chrome Web Store (and Edge, Opera)
//   dist/ghostbrowse-<version>-firefox.zip   addons.mozilla.org
//   dist/firefox/                            unpacked Firefox build, for about:debugging
//
//   node scripts/package.js

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { join, relative, sep, dirname } from "node:path";
import { crc32 } from "./crc32.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const INCLUDE = ["manifest.json", "background.js", "lib", "popup", "options", "help", "styles", "icons", "_locales", "LICENSE", "PRIVACY.md"];
export const GECKO_ID = "{8d3b6f2e-41a7-4c59-9e0b-7a2c5f1d3e86}";

// Firefox runs MV3 background code as an event page, not a service worker,
// and needs an add-on ID.
export function firefoxManifest(manifest) {
  const out = structuredClone(manifest);
  out.background = { scripts: [manifest.background.service_worker], type: "module" };
  delete out.minimum_chrome_version;
  out.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: "128.0",
      data_collection_permissions: { required: ["none"] }
    }
  };
  return out;
}

function collect(path) {
  if (statSync(path).isDirectory()) return readdirSync(path).sort().flatMap((name) => collect(join(path, name)));
  return [path];
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name: path, data, mtime } of entries) {
    const name = Buffer.from(path, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const useDeflate = packed.length < data.length;
    const body = useDeflate ? packed : data;
    const crc = crc32(data);
    const { time, day } = dosDateTime(mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);                    // version needed
    local.writeUInt16LE(0x0800, 6);                // UTF-8 names
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);                  // version made by
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  const files = INCLUDE.flatMap((p) => collect(join(ROOT, p))).map((file) => ({
    name: relative(ROOT, file).split(sep).join("/"),
    data: readFileSync(file),
    mtime: statSync(file).mtime
  }));
  const withManifest = (m) => files.map((f) => (f.name === "manifest.json" ? { ...f, data: Buffer.from(JSON.stringify(m, null, 2)) } : f));

  mkdirSync(join(ROOT, "dist"), { recursive: true });
  const builds = {
    [`ghostbrowse-${manifest.version}.zip`]: files,
    [`ghostbrowse-${manifest.version}-firefox.zip`]: withManifest(firefoxManifest(manifest))
  };
  for (const [name, entries] of Object.entries(builds)) {
    writeFileSync(join(ROOT, "dist", name), zip(entries));
    console.log(`wrote dist/${name} (${entries.length} files)`);
  }

  const unpacked = join(ROOT, "dist", "firefox");
  rmSync(unpacked, { recursive: true, force: true });
  for (const { name, data } of withManifest(firefoxManifest(manifest))) {
    mkdirSync(dirname(join(unpacked, name)), { recursive: true });
    writeFileSync(join(unpacked, name), data);
  }
  console.log("wrote dist/firefox/ (unpacked Firefox build)");
}
