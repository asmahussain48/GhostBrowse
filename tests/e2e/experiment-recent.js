// Experiment: can tiny time-range deletions clear Chrome's "Recently closed" list
// without touching other history?
import puppeteer from "puppeteer-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "../../scripts/chrome-path.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>Page ${req.url}</title>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const A = (p) => `http://127.0.0.1:${server.address().port}${p}`;

const copy = fs.mkdtempSync(path.join(os.tmpdir(), "gb-exp-"));
for (const item of ["manifest.json", "background.js", "lib", "popup", "options", "help", "styles", "icons", "_locales"]) {
  fs.cpSync(path.join(ROOT, item), path.join(copy, item), { recursive: true });
}
const manifest = JSON.parse(fs.readFileSync(path.join(copy, "manifest.json"), "utf8"));
manifest.permissions.push("sessions", "browsingData");
fs.writeFileSync(path.join(copy, "manifest.json"), JSON.stringify(manifest));

const launch = (profile) => puppeteer.launch({
  executablePath: findChrome(), headless: true, pipe: true, protocolTimeout: 30000, userDataDir: profile,
  enableExtensions: [copy], args: ["--disable-features=DisableLoadExtensionCommandLineSwitch"]
});
const worker = async (browser) => (await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/background.js"))).worker();
const closed = (sw) => sw.evaluate(() => chrome.sessions.getRecentlyClosed().then((list) =>
  list.map((e) => (e.tab ? e.tab.url : "window"))));
const visitTimes = (sw, url) => sw.evaluate((u) => chrome.history.getVisits({ url: u }).then((v) => v.map((x) => x.visitTime)), url);
const del = (sw, start, end) => sw.evaluate((s, e) => chrome.history.deleteRange({ startTime: s, endTime: e }), start, end);
const inHistory = (sw, url) => sw.evaluate((u) => chrome.history.getVisits({ url: u }).then((v) => v.length > 0), url);
async function visitAndClose(browser, urls) {
  const tab = await browser.newPage();
  for (const u of urls) await tab.goto(u);
  await sleep(300);
  await tab.close();
  await sleep(500);
}
const reset = (sw) => del(sw, 0, Date.now() + 1000);

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gb-exp-profile-"));
let browser = await launch(profile);
try {
  const sw = await worker(browser);
  await sw.evaluate(() => chrome.storage.local.set({ enabled: false }));
  await sleep(500);

  // E1: 1 ms window at the visit time, history entry still there.
  await reset(sw);
  const tab1 = await browser.newPage();
  await tab1.goto(A("/x"));
  const [tx] = await visitTimes(sw, A("/x"));
  await tab1.close();
  await sleep(500);
  console.log("E1 before:", await closed(sw));
  await del(sw, tx, tx + 1);
  console.log("E1 after 1 ms window at visit time:", await closed(sw));

  // E2: history entry already deleted by URL (as in Immediate mode), then the window.
  await reset(sw);
  const tab2 = await browser.newPage();
  await tab2.goto(A("/y"));
  const [ty] = await visitTimes(sw, A("/y"));
  await sw.evaluate((u) => chrome.history.deleteUrl({ url: u }), A("/y"));
  await tab2.close();
  await sleep(500);
  console.log("E2 before:", await closed(sw));
  await del(sw, ty, ty + 1);
  console.log("E2 after window (history row was already gone):", await closed(sw));

  // E3: a kept page visited in the same tab survives.
  await reset(sw);
  const tab3 = await browser.newPage();
  await tab3.goto(A("/kept"));
  await sleep(50);
  await tab3.goto(A("/hidden"));
  const [th] = await visitTimes(sw, A("/hidden"));
  await tab3.close();
  await sleep(500);
  console.log("E3 before:", await closed(sw));
  await del(sw, th, th + 1);
  console.log("E3 after window for /hidden only:", await closed(sw), "| /kept still in history:", await inHistory(sw, A("/kept")));

  // E4: the window misses by 5 ms → does it still clear? (how exact must it be)
  await reset(sw);
  const tab4 = await browser.newPage();
  await tab4.goto(A("/z"));
  const [tz] = await visitTimes(sw, A("/z"));
  await tab4.close();
  await sleep(500);
  await del(sw, tz + 5, tz + 6);
  console.log("E4 window 5 ms after the visit:", await closed(sw));
  await del(sw, tz, tz + 1);

  // E5: precision of visit times (fractional ms?)
  console.log("E5 visit time sample:", tz, Number.isInteger(tz));

  // E7: browsingData.removeHistory starting just before the tab closed (long after the visit).
  await reset(sw);
  const tab7 = await browser.newPage();
  await tab7.goto(A("/p"));
  await sw.evaluate((u) => chrome.history.deleteUrl({ url: u }), A("/p"));   // as Immediate mode does
  await sleep(2000);
  const tc = Date.now();
  await tab7.close();
  await sleep(500);
  console.log("E7 before:", await closed(sw));
  await sw.evaluate((since) => chrome.browsingData.removeHistory({ since }), tc - 200);
  console.log("E7 after removeHistory(since close - 200 ms):", await closed(sw));

  // E8: removeHistory since the visit time, history row already gone, a kept page visited meanwhile.
  await reset(sw);
  const t8 = Date.now();
  const tab8 = await browser.newPage();
  await tab8.goto(A("/q"));
  await sw.evaluate((u) => chrome.history.deleteUrl({ url: u }), A("/q"));
  const other = await browser.newPage();
  await other.goto(A("/kept-meanwhile"));
  await tab8.close();
  await sleep(500);
  await sw.evaluate((since) => chrome.browsingData.removeHistory({ since }), t8);
  console.log("E8 after removeHistory(since visit):", await closed(sw), "| kept page still in history:", await inHistory(sw, A("/kept-meanwhile")));
  await other.close();

  // E6: persistence across restart
  await reset(sw);
  await visitAndClose(browser, [A("/before-restart")]);
  console.log("E6 before restart:", await closed(sw));
} finally {
  await browser.close();
}
browser = await launch(profile);
try {
  const sw = await worker(browser);
  await sleep(1500);
  console.log("E6 after restart:", await closed(sw));
} finally {
  await browser.close();
  server.close();
}
