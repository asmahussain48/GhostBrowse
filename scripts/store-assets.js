// Builds the Chrome Web Store images in store/ from the real extension:
// five 1280x800 screenshots, the 440x280 small promo tile and the 1400x560 marquee.
//
//   npm run store-assets
//
// Needs Chrome (see scripts/chrome-path.js) and the puppeteer-core dev dependency.

import puppeteer from "puppeteer-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "./chrome-path.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT = path.join(ROOT, "store");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ICON = "data:image/png;base64," + fs.readFileSync(path.join(ROOT, "icons/icon128.png")).toString("base64");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>World news</title><h1>World news</h1>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  pipe: true,
  enableExtensions: true,
  protocolTimeout: 30000,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "gb-store-")),
  // A friendly site name in the popup instead of 127.0.0.1.
  args: ["--host-resolver-rules=MAP news.example.com 127.0.0.1"]
});

try {
  await browser.installExtension(ROOT);
  const target = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/background.js"));
  const base = target.url().replace("background.js", "");
  const sw = await target.worker();
  const welcome = await browser.waitForTarget((t) => t.url().includes("#welcome"), { timeout: 5000 }).catch(() => null);
  if (welcome) await (await welcome.page())?.close();
  const set = (patch) => sw.evaluate((p) => chrome.storage.local.set(p), patch);

  await set({
    mode: "onTabClose",
    keepList: ["github.com", "gmail.com", "university.edu"],
    keywords: ["medical", "salary"],
    stats: { today: 27, total: 1432, day: new Date().toDateString() },
    lastActivity: Date.now() - 2 * 60_000,
    ghostSchedule: { enabled: true, days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
    profiles: [
      { id: "study", name: "Study", ruleMode: "hideAll", keepList: ["github.com", "gmail.com", "university.edu"], hideList: [], keywords: ["medical", "salary"] },
      { id: "personal", name: "Personal", ruleMode: "hideAll", keepList: [], hideList: [], keywords: [] }
    ],
    activeProfile: "study"
  });

  // The page the popup describes.
  const site = await browser.newPage();
  await site.goto(`http://news.example.com:${PORT}/world`);

  // Captures an element of an extension page at 2x for crisp downscaling.
  async function capture(file, selector, { width = 1000, height = 900, newWindow = false, before } = {}) {
    let page;
    if (newWindow) {
      const cdp = await browser.target().createCDPSession();
      await cdp.send("Target.createTarget", { url: base + file, newWindow: true });
      page = await (await browser.waitForTarget((t) => t.url() === base + file)).page();
    } else {
      page = await browser.newPage();
      await page.goto(base + file);
    }
    await page.setViewport({ width, height, deviceScaleFactor: 2 });
    await page.bringToFront();
    await page.reload();
    await page.waitForSelector(selector);
    if (before) await before(page);
    await sleep(500);
    const png = await (await page.$(selector)).screenshot({ encoding: "base64" });
    await page.close();
    return "data:image/png;base64," + png;
  }

  const popup = await capture("popup/popup.html", "body", { width: 320, height: 640, newWindow: true });
  const rules = await capture("options/options.html", 'section[aria-labelledby="h-rules"]');
  const schedule = await capture("options/options.html", 'section[aria-labelledby="h-schedule"]');
  const help = await capture("help/help.html", "#what");
  await sw.evaluate(() => chrome.storage.local.set({ ghostSession: { start: Date.now() - 4 * 60_000 } }));
  const ghost = await capture("popup/popup.html", "body", { width: 320, height: 640, newWindow: true });
  await set({ ghostSession: null, language: "ur" });
  const urdu = await capture("popup/popup.html", "body", { width: 320, height: 640, newWindow: true });
  await set({ language: "auto" });

  // ---------- Compose ----------
  const page = await browser.newPage();
  async function render(name, width, height, html) {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0">${html}</body>`);
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
    fs.mkdirSync(path.dirname(path.join(OUT, name)), { recursive: true });
    await page.screenshot({ path: path.join(OUT, name) });
    console.log("wrote store/" + name);
  }

  const slide = ({ title, points, image, imageWidth = 420, dir = "ltr", lang = "en" }) => `
    <div dir="${dir}" lang="${lang}" style="box-sizing:border-box;width:1280px;height:800px;padding:0 80px;display:flex;align-items:center;gap:64px;
      background:radial-gradient(circle at 15% 20%,#ffffff 0,#f1edff 45%,#e3dcff 100%);font-family:'Segoe UI',system-ui,sans-serif;color:#1d1a2b">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:12px;font-size:24px;font-weight:700;color:#5236d6">
          <img src="${ICON}" width="44" height="44" alt="">GhostBrowse
        </div>
        <h1 style="margin:22px 0 26px;font-size:48px;line-height:1.15;letter-spacing:${lang === "ur" ? "0" : "-.5px"}">${title}</h1>
        <ul style="margin:0;padding-inline-start:26px;font-size:23px;line-height:1.65;color:#4a4563">
          ${points.map((p) => `<li>${p}</li>`).join("")}
        </ul>
      </div>
      <img src="${image}" style="flex:none;width:${imageWidth}px;border-radius:18px;box-shadow:0 24px 70px rgba(52,30,140,.28)" alt="">
    </div>`;

  await render("screenshots/1-popup.png", 1280, 800, slide({
    title: "Browse normally.<br>Your history stays clean.",
    points: ["Removes visited pages automatically", "Never touches logins, cookies or passwords", "See what happens to the site you are on", "Counts only: removed URLs are never stored"],
    image: popup
  }));
  await render("screenshots/2-rules.png", 1280, 800, slide({
    title: "You decide what stays.",
    points: ["Keep list for the sites you want in history", "Or hide only chosen sites and keywords", "Profiles such as Study and Personal", "Protect your settings with a PIN"],
    image: rules,
    imageWidth: 600
  }));
  await render("screenshots/3-ghost.png", 1280, 800, slide({
    title: "Ghost Session for<br>sensitive browsing.",
    points: ["Everything you visit is removed right away", "Schedule it, e.g. weekdays 9–5 on an office PC", "A final sweep when the session ends", "Keyboard shortcuts: Alt+Shift+D and Alt+Shift+G"],
    image: ghost
  }));
  await render("screenshots/4-privacy.png", 1280, 800, slide({
    title: "Private by design.",
    points: ["No network requests, no data collection", "Only history is removed; sessions are kept", "Optional: download list and cache cleaning", "Honest about what it cannot do"],
    image: help,
    imageWidth: 640
  }));
  await render("screenshots/5-urdu.png", 1280, 800, slide({
    title: "اردو میں بھی دستیاب",
    points: ["پاپ اپ، ترتیبات اور مدد اردو میں", "دائیں سے بائیں ترتیب", "ترتیبات سے زبان منتخب کریں"],
    image: urdu,
    dir: "rtl",
    lang: "ur"
  }));

  // Small promo tile and marquee: no screenshots, just the brand.
  const tile = (width, height, iconSize, titleSize, tagSize) => `
    <div style="box-sizing:border-box;width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;gap:${iconSize / 3}px;
      background:linear-gradient(135deg,#6d4aff 0%,#4b2fb8 100%);font-family:'Segoe UI',system-ui,sans-serif;color:#fff">
      <div style="flex:none;padding:${iconSize / 6}px;border-radius:28%;background:#fff;box-shadow:0 10px 30px rgba(20,10,60,.3)">
        <img src="${ICON}" width="${iconSize}" height="${iconSize}" alt="" style="display:block">
      </div>
      <div>
        <div style="font-size:${titleSize}px;font-weight:800;letter-spacing:-.5px">GhostBrowse</div>
        <div style="font-size:${tagSize}px;opacity:.9;margin-top:4px">History removed. Logins kept.</div>
      </div>
    </div>`;
  await render("promo-small-440x280.png", 440, 280, tile(440, 280, 96, 40, 18));
  await render("promo-marquee-1400x560.png", 1400, 560, tile(1400, 560, 200, 96, 38));
} finally {
  await browser.close();
  server.close();
}
