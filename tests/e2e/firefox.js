// End-to-end checks in Firefox, using the build from `npm run package` (dist/firefox/).
//
//   FIREFOX_PATH=/path/to/firefox npm run test:firefox
//
// A Firefox for testing can be downloaded with:
//   npx @puppeteer/browsers install firefox@stable

import puppeteer from "puppeteer-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GECKO_ID } from "../../scripts/package.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIST = path.join(ROOT, "dist", "firefox");
const FIREFOX = process.env.FIREFOX_PATH;
if (!FIREFOX) throw new Error("Set FIREFOX_PATH to a Firefox executable.");
if (!fs.existsSync(path.join(DIST, "manifest.json"))) throw new Error("Run `npm run package` first.");

// WebDriver BiDi will not navigate to moz-extension:// pages or show their
// contents. In a test-only copy, the pages are made reachable from a web page,
// which then navigates itself there. The shipped build is not changed.
const BUILD = fs.mkdtempSync(path.join(os.tmpdir(), "gb-ff-build-"));
fs.cpSync(DIST, BUILD, { recursive: true });
const testManifest = JSON.parse(fs.readFileSync(path.join(BUILD, "manifest.json"), "utf8"));
testManifest.web_accessible_resources = [{ resources: ["popup/*", "options/*"], matches: ["<all_urls>"] }];
fs.writeFileSync(path.join(BUILD, "manifest.json"), JSON.stringify(testManifest));

// Fixing the internal UUID lets the test open the extension's own pages.
const UUID = "3f2b8c1d-5e6a-4b7c-9d0e-1a2b3c4d5e6f";
const BASE = `moz-extension://${UUID}/`;

let passes = 0;
let failures = 0;
const errors = [];
function check(name, ok, detail = "") {
  ok ? passes++ : failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn().catch(() => undefined);
    if (last) return last;
    await sleep(200);
  }
  return last;
}

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>Page ${req.url}</title><h1>${req.url}</h1>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const A = (p) => `http://127.0.0.1:${server.address().port}${p}`;
const L = (p) => `http://localhost:${server.address().port}${p}`;

const browser = await puppeteer.launch({
  browser: "firefox",
  executablePath: FIREFOX,
  headless: true,
  args: ["-remote-allow-system-access"],   // needed to script extension pages
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "gb-ff-")),
  extraPrefsFirefox: { "extensions.webextensions.uuids": JSON.stringify({ [GECKO_ID]: UUID }) }
});

try {
  const id = await browser.installExtension(BUILD);
  check("Firefox accepts the add-on", id === GECKO_ID, id);

  // Opens an extension page by letting a web page navigate itself there.
  async function openExtensionPage(file) {
    const page = await browser.newPage();
    await page.goto(A("/launch"));
    await page.evaluate((url) => { location.href = url; }, BASE + file);
    await waitFor(() => page.evaluate(() => location.href).then((href) => href.startsWith(BASE)), 10000);
    page.on("pageerror", (e) => errors.push(file + ": " + e.message));
    return page;
  }
  const ext = await openExtensionPage("options/options.html");
  await ext.waitForSelector("#app:not([hidden])", { timeout: 10000 });
  check("settings page renders", (await ext.$eval("#h-rules", (e) => e.textContent)) === "Site rules");
  const call = (fn, arg) => ext.evaluate(fn, arg);
  const history = () => call(() => chrome.history.search({ text: "", startTime: 0, maxResults: 1000 }).then((r) => r.map((i) => i.url)));
  const inHistory = async (url) => (await history()).includes(url);

  // A freshly downloaded Firefox can take a while on its first start.
  check("background set the cleanup cursor on install", (await waitFor(() => call(() => chrome.storage.local.get("lastCleanup").then((s) => s.lastCleanup > 0)), 30000)) === true);

  // ---- Tab-close mode (default) ----
  const tab = await browser.newPage();
  await tab.goto(A("/one"));
  await tab.goto(A("/two"));
  await waitFor(() => inHistory(A("/two")));
  check("pages are recorded while the tab is open", (await inHistory(A("/one"))) && (await inHistory(A("/two"))));
  await tab.close();
  check("tab-close mode removes them when the tab closes",
    (await waitFor(async () => !(await inHistory(A("/one"))) && !(await inHistory(A("/two"))))) === true, JSON.stringify(await history()));

  // ---- Immediate mode + Keep list ----
  await call(() => chrome.storage.local.set({ mode: "immediate", keepList: ["localhost"] }));
  await sleep(300);
  const page = await browser.newPage();
  await page.goto(L("/kept"));
  await page.goto(A("/gone"));
  check("immediate mode removes pages right away", (await waitFor(async () => !(await inHistory(A("/gone"))))) === true);
  check("the Keep list is respected", await inHistory(L("/kept")));

  // ---- Popup and Clean Now ----
  await call(() => chrome.storage.local.set({ mode: "onStartup", keepList: [] }));
  await page.goto(A("/later"));
  await waitFor(() => inHistory(A("/later")));
  const popup = await openExtensionPage("popup/popup.html");
  await popup.waitForSelector("#mode option");
  await popup.click("#cleanNow");
  const result = await waitFor(() => popup.$eval("#result", (e) => (e.textContent.startsWith("Removed") ? e.textContent : "")));
  check("popup Clean Now works", Boolean(result) && !(await inHistory(A("/later"))), result);

  // ---- Ghost Session and badge ----
  await popup.click("#ghost");
  check("Ghost Session starts", (await waitFor(() => call(() => chrome.storage.local.get("ghostSession").then((s) => Boolean(s.ghostSession))))) === true);
  check("badge shows 👻", (await waitFor(() => call(() => chrome.action.getBadgeText({}).then((t) => t === "👻"))) === true));
  await page.goto(A("/ghosted"));
  check("Ghost Session removes visits right away", (await waitFor(async () => !(await inHistory(A("/ghosted"))))) === true);
  await popup.click("#ghost");
  check("ending it restores the ON badge", (await waitFor(() => call(() => chrome.action.getBadgeText({}).then((t) => t === "ON")))) === true);

  // ---- Urdu ----
  await ext.select("#language", "ur");
  // The page reloads itself; poll rather than waitForFunction, which loses the page on reload here.
  await waitFor(() => ext.evaluate(() => document.readyState === "complete" && document.documentElement.dir === "rtl"));
  check("Urdu, right to left", (await ext.$eval("#h-rules", (e) => e.textContent)) === "سائٹ کے اصول");
  check("badge tooltip in Urdu", (await waitFor(() => call(() => chrome.action.getTitle({}).then((t) => t === "GhostBrowse آن ہے")))) === true);

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (err) {
  check("Firefox run completed", false, err.stack);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
