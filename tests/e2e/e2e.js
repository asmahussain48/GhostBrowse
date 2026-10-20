// End-to-end checks: loads GhostBrowse into a real Chrome and drives it.
//
//   npm run test:e2e                      run all scenarios
//   npm run test:e2e -- --slow            also wait for a real 1-minute interval alarm
//   npm run test:e2e -- --shots <dir>     save screenshots of every page
//   npm run test:e2e -- core features     run only some scenarios
//
// Uses the installed Chrome (set CHROME_PATH to override). Headless, with a
// throwaway profile and a local test website, so nothing touches your own browser.

import puppeteer from "puppeteer-core";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "../../scripts/chrome-path.js";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const argv = process.argv.slice(2);
const SLOW = argv.includes("--slow");
const SHOTS = argv.includes("--shots") ? path.resolve(argv[argv.indexOf("--shots") + 1]) : null;
const ONLY = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--shots");
const EN = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(ROOT, "_locales/en/messages.json"), "utf8"))).map(([k, v]) => [k, v.message]));

const CHROME = findChrome();

// ---------- Reporting ----------
let failures = 0;
let passes = 0;
function check(name, ok, detail = "") {
  if (ok) passes++;
  else failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn().catch(() => undefined);
    if (last) return last;
    await sleep(150);
  }
  return last;
}
async function shot(page, name, element) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.bringToFront();
  await sleep(400);   // let CSS transitions settle
  const target = element ? await page.$(element) : page;
  await target.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: !element });
}

// ---------- Test website ----------
const server = http.createServer((req, res) => {
  const cookie = req.headers.cookie || "";
  if (req.url === "/login") {
    res.writeHead(200, { "content-type": "text/html", "set-cookie": "session=user42; Max-Age=86400; Path=/; HttpOnly" });
    return res.end(`<!doctype html><title>Login</title><script>localStorage.setItem("cart", "3 items")</script>Logged in`);
  }
  if (req.url === "/account") {
    res.writeHead(200, { "content-type": "text/html" });
    const who = /session=user42/.test(cookie) ? "user42" : "anonymous";
    return res.end(`<!doctype html><title>Account</title><p id="who">${who}</p><p id="cart"></p><script>document.getElementById("cart").textContent = localStorage.getItem("cart") || "empty"</script>`);
  }
  if (req.url.startsWith("/file")) {
    res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${req.url.slice(1)}.bin"` });
    return res.end(Buffer.alloc(2048, 7));
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>Page ${req.url}</title><h1>${req.url}</h1>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const A = (p) => `http://127.0.0.1:${PORT}${p}`;
const L = (p) => `http://localhost:${PORT}${p}`;

// ---------- Browser helpers ----------
const errors = [];

function watch(page, label) {
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`${label}: ${m.text()}`); });
  page.on("request", (r) => {
    if (!/^(chrome-extension|data|blob):/.test(r.url())) errors.push(`${label} made a network request: ${r.url()}`);
  });
  return page;
}

// Launches Chrome with GhostBrowse. With viaFlag the extension is loaded on the
// command line, which (unlike installExtension) is still there after a restart.
async function launch({ extension = ROOT, profile = fs.mkdtempSync(path.join(os.tmpdir(), "gb-e2e-")), viaFlag = false, downloads } = {}) {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    pipe: true,
    protocolTimeout: 30000,
    userDataDir: profile,
    enableExtensions: viaFlag ? [extension] : true,
    args: viaFlag ? ["--disable-features=DisableLoadExtensionCommandLineSwitch"] : []
  });
  if (downloads) {
    const cdp = await browser.target().createCDPSession();
    await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
  }
  if (!viaFlag) await browser.installExtension(extension);
  const target = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/background.js"), { timeout: 15000 });
  const base = target.url().replace("background.js", "");
  const sw = await target.worker();
  sw.on("console", (m) => { if (m.type() === "error") errors.push("worker: " + m.text()); });

  const welcome = await browser.waitForTarget((t) => t.url().includes("#welcome"), { timeout: 4000 }).catch(() => null);
  if (welcome) await (await welcome.page())?.close();

  const x = {
    browser,
    base,
    sw,
    profile,
    get: () => sw.evaluate(() => chrome.storage.local.get(null)),
    set: (patch) => sw.evaluate((p) => chrome.storage.local.set(p), patch),
    history: () => sw.evaluate(() => chrome.history.search({ text: "", startTime: 0, maxResults: 1000 }).then((r) => r.map((i) => i.url))),
    inHistory: async (url) => (await x.history()).includes(url),
    badge: () => sw.evaluate(() => chrome.action.getBadgeText({})),
    async page(file, { width = 1000, height = 900 } = {}) {
      const page = watch(await browser.newPage(), file);
      await page.setViewport({ width, height });
      await page.goto(base + file);
      await page.bringToFront();
      return page;
    },
    async popup() {
      const page = await x.page("popup/popup.html", { width: 320, height: 600 });
      await page.waitForSelector("#mode option");
      return page;
    },
    async options() {
      const page = await x.page("options/options.html");
      await page.waitForSelector("#app:not([hidden]), #lock:not([hidden])");
      return page;
    },
    async visit(url) {
      const page = await browser.newPage();
      await page.goto(url).catch(() => {});
      return page;
    }
  };
  return x;
}

async function resultText(page) {
  return waitFor(() => page.$eval("#result", (e) => (e.textContent && e.textContent !== "Working…" ? e.textContent : "")));
}

// ======================================================================
const scenarios = {
  // Modes, rules, popup actions, settings page and PIN lock.
  async core() {
    const x = await launch();
    try {
      check("badge shows ON after install", (await waitFor(async () => (await x.badge()) === "ON")) === true);

      const tab = await x.browser.newPage();
      await tab.goto(A("/one"));
      await tab.goto(A("/two"));
      await waitFor(() => x.inHistory(A("/two")));
      await tab.close();
      check("tab-close mode: pages removed when the tab closes",
        (await waitFor(async () => !(await x.inHistory(A("/one"))) && !(await x.inHistory(A("/two"))))) === true);

      await x.set({ mode: "immediate" });
      await x.visit(A("/immediate"));
      check("immediate mode: page removed within seconds", (await waitFor(async () => !(await x.inHistory(A("/immediate"))))) === true);

      await x.set({ keepList: ["localhost"] });
      await x.visit(L("/kept"));
      await x.visit(A("/gone"));
      await waitFor(async () => !(await x.inHistory(A("/gone"))));
      await sleep(600);
      check("Keep list: kept site stays, others removed", (await x.inHistory(L("/kept"))) && !(await x.inHistory(A("/gone"))));

      await x.set({ keepList: [], ruleMode: "hideListed", hideList: ["127.0.0.1"] });
      await x.visit(L("/stays"));
      await x.visit(A("/listed"));
      await waitFor(async () => !(await x.inHistory(A("/listed"))));
      await sleep(600);
      check("Hide list: only listed site removed", (await x.inHistory(L("/stays"))) && !(await x.inHistory(A("/listed"))));

      await x.set({ ruleMode: "hideAll", hideList: [], mode: "onStartup" });
      await x.visit(A("/c1"));
      await waitFor(() => x.inHistory(A("/c1")));
      const popup = await x.popup();
      await popup.click("#cleanNow");
      const cleaned = await resultText(popup);
      check("popup Clean Now removes history", cleaned?.startsWith("Removed") && !(await x.inHistory(A("/c1"))), cleaned);

      await popup.click("#ghost");
      check("Ghost Session: badge shows 👻", (await waitFor(async () => (await x.badge()) === "👻")) === true);
      await x.visit(A("/ghosted"));
      check("Ghost Session: visits removed immediately", (await waitFor(async () => !(await x.inHistory(A("/ghosted"))))) === true);
      await popup.bringToFront();
      await shot(popup, "popup-ghost", "body");
      await popup.click("#ghost");
      check("Ghost Session: ending restores the ON badge", (await waitFor(async () => (await x.badge()) === "ON")) === true);

      await x.set({ mode: "interval", intervalMin: 1 });
      const alarm = await waitFor(async () => {
        const a = await x.sw.evaluate(() => chrome.alarms.get("ghost-clean"));
        return a?.periodInMinutes === 1 ? a : null;
      });
      check("interval mode creates a 1-minute alarm", Boolean(alarm));
      if (SLOW) {
        await x.visit(A("/interval"));
        await waitFor(() => x.inHistory(A("/interval")));
        console.log("        waiting up to 75 s for the alarm…");
        check("interval alarm removes history", (await waitFor(async () => !(await x.inHistory(A("/interval"))), 75_000)) === true);
      }

      const opt = await x.options();
      await opt.type('[data-list="keepList"] input', "https://www.GitHub.com/explore, gmail.com, bogus");
      await opt.click('[data-list="keepList"] button[type="submit"]');
      const keep = await waitFor(async () => { const s = await x.get(); return s.keepList?.length === 2 ? s.keepList : null; });
      check("settings: domains normalized and saved", JSON.stringify(keep) === '["github.com","gmail.com"]', JSON.stringify(keep));
      const msg = await opt.$eval('[data-list="keepList"] [data-msg]', (e) => e.textContent);
      check("settings: invalid entry reported", msg.includes("bogus"), msg);
      await shot(opt, "options");

      await opt.click("#pinSetOpen");
      await opt.type("#pinNew", "4821");
      await opt.type("#pinConfirm", "4821");
      await opt.click('#pinSetForm button[type="submit"]');
      await waitFor(async () => Boolean((await x.get()).pinHash));
      check("PIN stored only as a hash", !JSON.stringify(await x.get()).includes("4821"));
      await opt.reload();
      await opt.waitForSelector("#lock:not([hidden])");
      check("locked settings page does not render the lists", await opt.$eval("#app", (e) => e.hidden && !e.textContent.includes("github.com")));
      await shot(opt, "options-locked");
      await opt.type("#lockPin", "0000");
      await opt.click("#lockSubmit");
      const wrong = await waitFor(() => opt.$eval("#lockError", (e) => e.textContent));
      check("wrong PIN rejected", wrong?.startsWith("Wrong PIN"), wrong);
      await opt.type("#lockPin", "4821");
      await opt.click("#lockSubmit");
      check("right PIN unlocks", Boolean(await opt.waitForSelector("#app:not([hidden])", { timeout: 4000 }).catch(() => null)));

      const guarded = await x.popup();
      await guarded.click(".head .switch");
      await guarded.waitForSelector("#pinForm:not([hidden])");
      check("popup asks for the PIN before turning off", (await x.get()).enabled !== false);
      await guarded.type("#pinInput", "4821");
      await guarded.click('#pinForm button[type="submit"]');
      check("popup turns off after the PIN", (await waitFor(async () => (await x.get()).enabled === false)) === true);
      check("badge shows OFF", (await waitFor(async () => (await x.badge()) === "OFF")) === true);
    } finally {
      await x.browser.close();
    }
  },

  // Logins survive cleanups; download list and cache cleaning.
  async realWorld() {
    // Headless Chrome cannot click a permission prompt, so this copy has the
    // optional permissions granted up front. The code under test is the same.
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), "gb-perms-"));
    for (const item of ["manifest.json", "background.js", "lib", "popup", "options", "help", "styles", "icons", "_locales"]) {
      fs.cpSync(path.join(ROOT, item), path.join(copy, item), { recursive: true });
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(copy, "manifest.json"), "utf8"));
    manifest.permissions.push(...manifest.optional_permissions);
    delete manifest.optional_permissions;
    fs.writeFileSync(path.join(copy, "manifest.json"), JSON.stringify(manifest));

    const downloads = fs.mkdtempSync(path.join(os.tmpdir(), "gb-dl-"));
    const onDisk = (name) => fs.existsSync(path.join(downloads, `${name}.bin`));
    const listed = async (x, name) => (await x.sw.evaluate(() => chrome.downloads.search({}))).some((d) => d.filename.endsWith(`${name}.bin`));
    const x = await launch({ extension: copy, downloads });
    try {
      await x.set({ mode: "immediate", cleanDownloads: true, cleanCache: true });
      const page = await x.browser.newPage();
      await page.goto(A("/login"));
      await page.goto(A("/account"));
      const popup = await x.popup();
      await popup.select("#range", "all");
      await popup.click("#cleanRange");
      await popup.click("#cleanRange");
      await resultText(popup);
      check("Clean range (all time) removed the site's history", !(await x.history()).some((u) => u.includes(`127.0.0.1:${PORT}`)));

      await page.bringToFront();
      await page.reload();
      check("still logged in after cleanup with cache clearing", (await page.$eval("#who", (e) => e.textContent)) === "user42");
      check("website localStorage kept", (await page.$eval("#cart", (e) => e.textContent)) === "3 items");

      await page.goto(A("/file1")).catch(() => {});
      check("Immediate mode: finished download erased from the list, file kept",
        (await waitFor(async () => onDisk("file1") && !(await listed(x, "file1")))) === true);

      await x.set({ mode: "onStartup", lastCleanup: Date.now() - 60_000 });
      await page.goto(A("/file2")).catch(() => {});
      await waitFor(() => listed(x, "file2"));
      await popup.bringToFront();
      await popup.evaluate(() => chrome.runtime.sendMessage({ type: "cleanNow" }));
      check("Clean Now erased the download entry, file kept", !(await listed(x, "file2")) && onDisk("file2"));

      await x.set({ mode: "immediate", keepList: ["localhost"] });
      await page.goto(L("/file3")).catch(() => {});
      await waitFor(async () => onDisk("file3"));
      await sleep(1500);
      check("Keep list applies to downloads", await listed(x, "file3"));
      check("login cookie survived everything", (await x.browser.cookies()).some((c) => c.name === "session"));
    } finally {
      await x.browser.close();
    }
  },

  // README test 9: history removed the next time Chrome starts.
  async restart() {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "gb-restart-"));
    let x = await launch({ profile, viaFlag: true });
    try {
      await waitFor(async () => (await x.get()).lastCleanup > 0);
      await x.set({ mode: "onStartup", keepList: ["localhost"] });
      const page = await x.browser.newPage();
      for (const p of ["/r1", "/r2"]) await page.goto(A(p));
      await page.goto(L("/kept"));
      await page.goto(A("/open-at-exit"));
      await waitFor(() => x.inHistory(A("/open-at-exit")));
      await sleep(1000);
    } finally {
      await x.browser.close();
    }
    x = await launch({ profile, viaFlag: true });
    try {
      const gone = await waitFor(async () => {
        const h = await x.history();
        return [A("/r1"), A("/r2"), A("/open-at-exit")].every((u) => !h.includes(u));
      }, 10000);
      check("history removed at the next start", gone === true, JSON.stringify(await x.history()));
      check("Keep list site still in history", await x.inHistory(L("/kept")));
      check("badge restored after restart", (await waitFor(async () => (await x.badge()) === "ON")) === true);
    } finally {
      await x.browser.close();
    }
  },

  // This site, profiles, scheduled Ghost Sessions.
  async features() {
    const x = await launch();
    try {
      // ---- This site ----
      const site = await x.browser.newPage();
      await site.goto(A("/article"));
      await waitFor(() => x.inHistory(A("/article")));
      // Open the popup in a window of its own, so the page above is the site it describes.
      const cdp = await x.browser.target().createCDPSession();
      await cdp.send("Target.createTarget", { url: x.base + "popup/popup.html", newWindow: true });
      const popup = watch(await (await x.browser.waitForTarget((t) => t.url().endsWith("popup/popup.html"))).page(), "popup");
      await popup.setViewport({ width: 320, height: 640 });
      await popup.bringToFront();
      await popup.waitForSelector("#site:not([hidden])");
      check("popup shows the current site", (await popup.$eval("#siteHost", (e) => e.textContent)) === "127.0.0.1");
      check("popup explains what happens to it", (await popup.$eval("#siteStatus", (e) => e.textContent)) === EN.siteRemovedOnTabClose);
      await shot(popup, "popup-site", "body");

      await popup.click("#siteKeep");
      await waitFor(async () => (await x.get()).keepList?.includes("127.0.0.1"));
      const keptStatus = await waitFor(() => popup.$eval("#siteStatus", (e) => (e.textContent.includes("Keep list") ? e.textContent : "")));
      check("Keep adds the site and the status updates", Boolean(keptStatus), keptStatus);
      await popup.click("#siteKeep");
      check("Stop keeping removes it again", (await waitFor(async () => (await x.get()).keepList.length === 0)) === true);

      await site.goto(A("/f1"));
      await site.goto(A("/f2"));
      await waitFor(() => x.inHistory(A("/f2")));
      await popup.bringToFront();
      await popup.click("#siteForget");
      await popup.click("#siteForget");
      const forgot = await resultText(popup);
      check("Forget removes the site's whole history", forgot === "Removed 3 entries for 127.0.0.1." && !(await x.history()).some((u) => u.includes("127.0.0.1")), forgot);

      // ---- Profiles ----
      const opt = await x.options();
      const newProfile = async (name) => {
        await opt.click("#profileNew");
        await opt.type("#profileName", name);
        await opt.click('#profileForm button[type="submit"]');
        await waitFor(async () => (await x.get()).profiles?.some((p) => p.name === name));
      };
      await newProfile("Study");
      await opt.type('[data-list="keepList"] input', "university.edu");
      await opt.click('[data-list="keepList"] button[type="submit"]');
      await waitFor(async () => (await x.get()).keepList?.includes("university.edu"));
      await newProfile("Personal");
      await opt.click('[data-list="keepList"] .chip button');
      await waitFor(async () => (await x.get()).keepList.length === 0);
      const s1 = await x.get();
      check("two profiles saved, Personal active", s1.profiles.length === 2 && s1.profiles.find((p) => p.id === s1.activeProfile)?.name === "Personal");
      await shot(opt, "options-profiles", 'section[aria-labelledby="h-rules"]');

      await popup.reload();
      await popup.waitForSelector("#profileRow:not([hidden])");
      const studyId = s1.profiles.find((p) => p.name === "Study").id;
      await popup.select("#profile", studyId);
      check("popup switches to Study and loads its rules",
        (await waitFor(async () => (await x.get()).keepList?.includes("university.edu"))) === true);
      await popup.select("#profile", s1.activeProfile);
      check("switching back restores Personal's rules", (await waitFor(async () => (await x.get()).keepList?.length === 0)) === true);

      // ---- Scheduled Ghost Session ----
      const hhmm = (offsetMin) => {
        const d = new Date(Date.now() + offsetMin * 60_000);
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      };
      const setTimes = (start, end) => opt.evaluate((s, e) => {
        for (const [id, v] of [["schedStart", s], ["schedEnd", e]]) {
          const input = document.getElementById(id);
          input.value = v;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, start, end);
      await opt.bringToFront();
      for (const box of await opt.$$("#schedDays input")) if (!(await box.evaluate((b) => b.checked))) await box.click();
      await setTimes(hhmm(-60), hhmm(60));
      await opt.click("#schedEnabled");
      const session = await waitFor(async () => (await x.get()).ghostSession);
      check("a schedule covering now starts a scheduled Ghost Session", session?.scheduled === true, JSON.stringify(session));
      check("…and the badge shows 👻", (await waitFor(async () => (await x.badge()) === "👻")) === true);
      const status = await opt.$eval("#schedStatus", (e) => e.textContent);
      check("settings say the session is running", status.startsWith("A scheduled Ghost Session is running now"), status);
      await shot(opt, "options-schedule", 'section[aria-labelledby="h-schedule"]');
      await popup.reload();
      const banner = await popup.$eval("#ghostText", (e) => e.textContent);
      check("popup banner shows the scheduled end time", banner.startsWith("Scheduled Ghost Session · until"), banner);

      await setTimes(hhmm(120), hhmm(180));
      check("moving the window later ends the session", (await waitFor(async () => (await x.get()).ghostSession === null)) === true);
      check("…and the badge returns to ON", (await waitFor(async () => (await x.badge()) === "ON")) === true);
      const next = await waitFor(() => opt.$eval("#schedStatus", (e) => (e.textContent.startsWith("Next session") ? e.textContent : "")));
      check("settings show the next session", Boolean(next), next);
    } finally {
      await x.browser.close();
    }
  },

  // Urdu: right-to-left pages, translated text, badge tooltip, help page.
  async language() {
    const x = await launch();
    const enKeys = Object.keys(EN).filter((k) => /[A-Z]/.test(k));
    const untranslated = (text) => enKeys.filter((k) => text.includes(k));
    try {
      const opt = await x.options();
      await opt.select("#language", "ur");
      await opt.waitForFunction(() => document.documentElement.dir === "rtl", { timeout: 8000 });
      await opt.waitForSelector("#app:not([hidden])");
      const optText = await opt.evaluate(() => document.body.innerText);
      check("settings page switches to Urdu, right to left", optText.includes("سائٹ کے اصول") && optText.includes("طے شدہ گھوسٹ سیشن"));
      check("settings page has no untranslated message keys", untranslated(optText).length === 0, untranslated(optText).join(", "));
      await shot(opt, "options-ur");

      const popup = await x.popup();
      const popupText = await popup.evaluate(() => ({ dir: document.documentElement.dir, text: document.body.innerText }));
      check("popup is in Urdu, right to left", popupText.dir === "rtl" && popupText.text.includes("ابھی صاف کریں"));
      check("popup has no untranslated message keys", untranslated(popupText.text).length === 0, untranslated(popupText.text).join(", "));
      await popup.click("#cleanNow");
      const result = await resultText(popup);
      check("results are in Urdu", /[؀-ۿ]/.test(result ?? ""), result);
      await shot(popup, "popup-ur", "body");

      const title = await waitFor(async () => {
        const t = await x.sw.evaluate(() => chrome.action.getTitle({}));
        return t === "GhostBrowse آن ہے" ? t : null;
      });
      check("badge tooltip in Urdu", Boolean(title));

      const help = await x.page("help/help.ur.html");
      const helpInfo = await help.evaluate(() => ({ dir: document.documentElement.dir, h1: document.querySelector("h1").textContent }));
      check("Urdu help page loads", helpInfo.dir === "rtl" && helpInfo.h1 === "GhostBrowse مدد");
      await shot(help, "help-ur");

      await opt.bringToFront();
      await opt.select("#language", "en");
      await opt.waitForFunction(() => document.documentElement.dir === "ltr", { timeout: 8000 });
      check("switching back to English works", (await opt.evaluate(() => document.body.innerText)).includes("Site rules"));
      const helpEn = await x.page("help/help.html");
      await shot(helpEn, "help");
    } finally {
      await x.browser.close();
    }
  }
};

const selected = ONLY.length ? ONLY : Object.keys(scenarios);
try {
  for (const name of selected) {
    if (!scenarios[name]) throw new Error(`Unknown scenario "${name}". Choose from: ${Object.keys(scenarios).join(", ")}`);
    console.log(`\n${name}`);
    try {
      await scenarios[name]();
    } catch (err) {
      check(`${name} completed without crashing`, false, err.stack);
    }
  }
  console.log("\nall");
  check("no page errors, worker errors or network requests", errors.length === 0, errors.join(" | "));
} finally {
  server.close();
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
