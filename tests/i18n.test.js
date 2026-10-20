import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";
import { loadLocale } from "./setup.js";
import { setMessages, t, tn, resolveLanguage, isRtl } from "../lib/i18n.js";
import { cleanupSummary, relativeTime, rulesSummary } from "../lib/format.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const en = loadLocale("en");
const ur = loadLocale("ur");
const args = (m) => [...new Set(m.match(/\$\d/g) ?? [])].sort().join(",");

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return ["lib", "popup", "options"].includes(name) ? sourceFiles(path) : [];
    return [".js", ".html"].includes(extname(name)) ? [path] : [];
  });
}

// Every message key the code refers to, found by scanning the source.
function usedKeys() {
  const files = [...sourceFiles(join(ROOT, "lib")), ...sourceFiles(join(ROOT, "popup")), ...sourceFiles(join(ROOT, "options")), join(ROOT, "background.js")];
  const keys = new Set();
  const plural = new Set();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const [, key] of text.matchAll(/data-i18n(?:-rich|-placeholder|-title|-aria-label)?="(\w+)"/g)) keys.add(key);
    for (const [, key] of text.matchAll(/\bt\("(\w+)"/g)) keys.add(key);
    for (const [, key] of text.matchAll(/\btn\([^,]+,\s*"(\w+)"/g)) plural.add(key);
    // Keys kept in lookup tables, e.g. MODES or BADGE.
    for (const [, key] of text.matchAll(/:\s*"((?:mode|modeHint|badge|site|count|sum|note|profile|cmd|toast|invalid)[A-Z]\w*)"/g)) keys.add(key);
  }
  return { keys, plural };
}

describe("translations", () => {
  afterEach(() => setMessages("en", en));

  it("Urdu has exactly the English keys, with the same arguments", () => {
    expect(Object.keys(ur).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) expect([key, args(ur[key])]).toEqual([key, args(en[key])]);
  });

  it("every key used in the code exists", () => {
    const { keys, plural } = usedKeys();
    expect(keys.size).toBeGreaterThan(100);
    const exists = (k) => k in en || (`${k}_one` in en && `${k}_other` in en);
    const missing = [...keys].filter((k) => !exists(k));
    for (const k of plural) for (const form of ["one", "other"]) if (!(`${k}_${form}` in en)) missing.push(`${k}_${form}`);
    expect(missing).toEqual([]);
  });

  it("the manifest's messages exist", () => {
    const manifest = readFileSync(join(ROOT, "manifest.json"), "utf8");
    const keys = [...manifest.matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(4);
    for (const key of keys) {
      expect(en).toHaveProperty(key);
      expect(ur).toHaveProperty(key);
    }
  });

  it("substitutes arguments and picks plural forms", () => {
    expect(t("profileSwitched", "Study")).toBe("Switched to Study");
    expect(tn(1, "countSites")).toBe("1 site");
    expect(tn(1500, "countSites")).toBe("1,500 sites");
    expect(t("noSuchKey")).toBe("noSuchKey");
  });

  it("chooses the language from the setting, then Chrome's UI language", () => {
    expect(resolveLanguage("ur", "en-US")).toBe("ur");
    expect(resolveLanguage("auto", "ur-PK")).toBe("ur");
    expect(resolveLanguage("auto", "de")).toBe("en");
    expect(resolveLanguage("xx", "fr")).toBe("en");
    expect(resolveLanguage(undefined, undefined)).toBe("en");
  });

  it("produces Urdu text, right to left", () => {
    setMessages("ur", ur, en);
    expect(isRtl()).toBe(true);
    expect(cleanupSummary({ removed: 3, kept: 1, skipped: 0 }, { ruleMode: "hideAll" }))
      .toBe("3 اندراجات حذف کیے گئے۔ محفوظ فہرست کا 1 صفحہ برقرار ہے۔");
    expect(rulesSummary({ ruleMode: "hideListed", hideList: ["a.com"], keywords: [] })).toBe("صرف 1 سائٹ چھپائیں");
    expect(relativeTime(Date.now() - 5 * 60_000)).toBe("5 منٹ پہلے");
  });
});
