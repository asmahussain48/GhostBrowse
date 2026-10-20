// GhostBrowse service worker.
//
// MV3 service workers can be stopped at any time, so nothing important lives in
// global variables: settings and counters are in chrome.storage.local and the
// temporary tab -> URL map is in chrome.storage.session. Every listener is
// registered synchronously at the top level so Chrome can wake the worker for it.

import { getSettings, saveSettings, todayKey } from "./lib/settings.js";
import { isWebUrl, hostOf, normalizeDomain, matchesDomain, shouldHide, shouldHideDownload } from "./lib/rules.js";
import { cleanupSummary } from "./lib/format.js";
import { activeWindow, nextChange } from "./lib/schedule.js";
import { initI18n, t } from "./lib/i18n.js";

const ALARM = "ghost-clean";
const SCHEDULE_ALARM = "ghost-schedule";
const SEARCH_LIMIT = 100000;
const DELETE_BATCH = 50;
const TAB_URLS = "tabUrls";           // session: { [tabId]: [url, ...] }
const TAB_NAV = "tabNav";             // session: { [tabId]: { url, at } } current page and when it opened
const PENDING = "pendingVisits";      // session: URLs visited while in tab-close mode
const WINDOW_VISITS = 20;             // recent visits per URL deleted as 1 ms ranges
const WINDOW_DAYS = 30;
const NAV_MARGIN_MS = 2000;           // tab events arrive a little after the visit time

const BADGE = {
  on:    { text: "badgeOn",  color: "#2e7d32", title: "badgeOnTitle" },
  off:   { text: "badgeOff", color: "#757575", title: "badgeOffTitle" },
  ghost: { text: "badgeGhost", color: "#6a1b9a", title: "badgeGhostTitle" }
};
const ICONS = {
  on:  { 16: "icons/icon16.png", 32: "icons/icon32.png" },
  off: { 16: "icons/icon16-off.png", 32: "icons/icon32-off.png" }
};

// GhostBrowse's own Settings and Help pages are not browsing, but they are
// recorded in history and reveal that a privacy tool is in use, so they are
// always removed. They are not counted in the statistics.
const OWN_PAGES = chrome.runtime.getURL("");
const isOwnPage = (url) => typeof url === "string" && url.startsWith(OWN_PAGES);
// Tabs are followed for web pages and for GhostBrowse's own pages, which are
// removed from history (and from "Recently closed") when their tab closes.
const isTracked = (url) => isWebUrl(url) || isOwnPage(url);

// ---------- Helpers ----------

// Runs async jobs one at a time so read-modify-write updates cannot overwrite
// each other when several events arrive together.
function createLock() {
  let tail = Promise.resolve();
  return (job) => {
    const run = tail.then(job);
    tail = run.catch(() => {});
    return run;
  };
}
const withStats = createLock();
const withTabs = createLock();
const withCleanup = createLock();
const withSchedule = createLock();

// Translations for the badge tooltip and messages. Language changes reload them.
let i18nReady = initI18n();

function recordRemoved(count) {
  if (!count) return Promise.resolve();
  return withStats(async () => {
    const { stats } = await getSettings();
    const day = todayKey();
    const next = stats.day === day ? { ...stats } : { today: 0, total: stats.total, day };
    next.today += count;
    next.total += count;
    await saveSettings({ stats: next, lastActivity: Date.now() });   // counts only, never URLs
  });
}

// True if a page that must stay in history was visited within [t, t + 1 ms).
async function keptVisitAt(t, isTarget, s) {
  const items = await chrome.history.search({ text: "", startTime: t, endTime: t + 1, maxResults: 20 });
  return items.some((item) => !isTarget(item.url) && !isOwnPage(item.url) && !shouldHide(item.url, s));
}

// Removes one URL from history. Its recent visits are first deleted as 1 ms
// time ranges: unlike deleteUrl, a time-range deletion also takes the page off
// Chrome's "Recently closed" list (History menu, Ctrl+Shift+T). A range is
// skipped if a page that must stay was visited in the same millisecond.
// Returns false if the URL was not in history.
async function deleteHistoryUrl(url, s, { windows = true, isTarget = (u) => u === url } = {}) {
  const visits = await chrome.history.getVisits({ url });
  if (windows) {
    // Only recent visits can still be in the list, which holds 25 entries.
    const recent = visits.map((v) => v.visitTime).filter((t) => t > Date.now() - WINDOW_DAYS * 86400_000)
      .sort((a, b) => a - b).slice(-WINDOW_VISITS);
    for (const t of recent) {
      if (!(await keptVisitAt(t, isTarget, s))) await chrome.history.deleteRange({ startTime: t, endTime: t + 1 });
    }
  }
  await chrome.history.deleteUrl({ url });
  return visits.length > 0;
}

// Deletes every URL that the rules say to hide. With verify, URLs that were no
// longer in history are not counted, so the counters stay accurate.
async function removeUrls(urls, s, { verify = true, windows = true } = {}) {
  const targets = [...new Set(urls)].filter((url) => shouldHide(url, s));
  const set = new Set(targets);
  let removed = 0;
  for (let i = 0; i < targets.length; i += DELETE_BATCH) {
    const done = await Promise.all(targets.slice(i, i + DELETE_BATCH).map(async (url) => {
      const existed = await deleteHistoryUrl(url, s, { windows, isTarget: (u) => set.has(u) });
      return existed || !verify ? 1 : 0;
    }));
    removed += done.reduce((a, b) => a + b, 0);
  }
  return removed;
}

// Immediate mode and Ghost Sessions delete pages while their tab is still open,
// so when the tab closes Chrome lists it under "Recently closed" with nothing
// left in history to delete. Chrome only clears that list together with all
// history since a time, so (when the user turned this on) the history since the
// tab's last page is cleared, and pages that must stay are added back first.
// Chrome cannot add a page back at its original time; it gets the time of now.
async function clearClosedTab(nav, s) {
  if (!s.cleanRecentlyClosed || !nav) return;
  if (!(s.ghostSession || (s.enabled && s.mode === "immediate"))) return;
  if (!shouldHide(nav.url, s) || !(await hasPermission("browsingData"))) return;
  const since = nav.at - NAV_MARGIN_MS;
  const items = await chrome.history.search({ text: "", startTime: since, maxResults: SEARCH_LIMIT });
  const restore = items.map((i) => i.url).filter((url) => !isOwnPage(url) && !shouldHide(url, s));
  await chrome.browsingData.removeHistory({ since });
  for (const url of restore) {
    try {
      await chrome.history.addUrl({ url });
    } catch (err) {
      console.warn("GhostBrowse: could not keep", err);
    }
  }
}

async function hasPermission(permission) {
  const api = permission === "downloads" ? chrome.downloads : chrome.browsingData;
  return Boolean(api) && chrome.permissions.contains({ permissions: [permission] });
}

async function eraseDownloads(startTime, s) {
  if (!(await hasPermission("downloads"))) return;
  const items = await chrome.downloads.search({ startedAfter: new Date(startTime).toISOString(), limit: 0 });
  for (const item of items) {
    // erase() removes the list entry only; the file stays on disk.
    if (item.state !== "in_progress" && shouldHideDownload(item, s)) {
      await chrome.downloads.erase({ id: item.id });
    }
  }
}

async function clearCache(startTime) {
  if (!(await hasPermission("browsingData"))) return;
  await chrome.browsingData.removeCache({ since: startTime });
}

// Remove everything recorded since startTime, respecting the rules.
// Returns how many entries were removed, and how many were left and why:
// kept = web pages the rules keep, skipped = file:// and other browser pages.
export function cleanSince(startTime) {
  return withCleanup(async () => {
    const s = await getSettings();
    const endTime = Date.now();
    let removed = 0;
    const kept = new Set();
    const skipped = new Set();

    for (let round = 0; round < 20; round++) {
      const items = await chrome.history.search({ text: "", startTime, endTime, maxResults: SEARCH_LIMIT });
      const hidden = [];
      const own = [];
      for (const { url } of items) {
        if (isOwnPage(url)) own.push(url);
        else if (shouldHide(url, s)) hidden.push(url);
        else (isWebUrl(url) ? kept : skipped).add(url);
      }
      if (hidden.length + own.length === 0) break;
      if (hidden.length + own.length === items.length) {
        // Nothing in range needs to be kept, so one deleteRange call does the job.
        await chrome.history.deleteRange({ startTime, endTime });
      } else {
        await Promise.all(own.map((url) => deleteHistoryUrl(url, s)));
        await removeUrls(hidden, s, { verify: false });
      }
      removed += hidden.length;
      if (items.length < SEARCH_LIMIT) break;
    }

    try {
      if (s.cleanDownloads) await eraseDownloads(startTime, s);
      if (s.cleanCache) await clearCache(startTime);
    } catch (err) {
      console.warn("GhostBrowse: extra trace cleaning failed", err);
    }

    // Only move the cursor when this sweep covered everything since the last one,
    // otherwise a narrow "Clean last hour" would skip older unswept history.
    const patch = { lastActivity: Date.now() };
    if (startTime <= s.lastCleanup) patch.lastCleanup = endTime;
    await saveSettings(patch);
    await recordRemoved(removed);
    return { removed, kept: kept.size, skipped: skipped.size };
  });
}

// Sweep start for Clean Now / startup. A missing cursor never means "all time".
async function sweepStart(s) {
  if (s.lastCleanup) return s.ghostSession ? Math.min(s.lastCleanup, s.ghostSession.start) : s.lastCleanup;
  const now = Date.now();
  await saveSettings({ lastCleanup: now });
  return now;
}

// ---------- Immediate mode + Ghost Session ----------
chrome.history.onVisited.addListener(async (item) => {
  if (isOwnPage(item.url)) return;   // removed when its tab closes
  const s = await getSettings();
  if (s.ghostSession || (s.enabled && s.mode === "immediate")) {
    // The tab is still open, so there is no "Recently closed" entry to clear yet.
    await recordRemoved(await removeUrls([item.url], s, { verify: false, windows: false }));
  } else if (s.enabled && s.mode === "onTabClose" && isWebUrl(item.url)) {
    // Remembered so that redirect hops, which never show up as a tab URL,
    // are still removed when tabs close.
    await withTabs(async () => {
      const data = await chrome.storage.session.get({ [PENDING]: [] });
      if (data[PENDING].includes(item.url)) return;
      await chrome.storage.session.set({ [PENDING]: [...data[PENDING], item.url] });
    });
  }
});

// ---------- Tab-close mode ----------
function trackTab(tabId, url) {
  if (!isTracked(url)) return Promise.resolve();
  return withTabs(async () => {
    const data = await chrome.storage.session.get({ [TAB_URLS]: {}, [TAB_NAV]: {} });
    const tabs = data[TAB_URLS];
    const urls = tabs[tabId] || [];
    if (!urls.includes(url)) tabs[tabId] = [...urls, url];
    data[TAB_NAV][tabId] = { url, at: Date.now() };
    await chrome.storage.session.set({ [TAB_URLS]: tabs, [TAB_NAV]: data[TAB_NAV] });
  });
}

// Records the URLs of tabs that were open before the worker could see them
// (fresh install, browser startup).
async function seedTabs() {
  const open = await chrome.tabs.query({});
  await withTabs(async () => {
    const { [TAB_URLS]: tabs } = await chrome.storage.session.get({ [TAB_URLS]: {} });
    for (const tab of open) {
      const url = tab.url || tab.pendingUrl;
      if (tab.incognito || !isTracked(url)) continue;
      const urls = tabs[tab.id] || [];
      if (!urls.includes(url)) tabs[tab.id] = [...urls, url];
    }
    await chrome.storage.session.set({ [TAB_URLS]: tabs });
  });
}

chrome.tabs.onCreated.addListener((tab) => {
  if (!tab.incognito) trackTab(tab.id, tab.pendingUrl || tab.url);
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  // Incognito URLs must never be passed to deleteUrl: that would remove the
  // same URL from normal history.
  if (change.url && !tab?.incognito) trackTab(tabId, change.url);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  withTabs(async () => {
    const data = await chrome.storage.session.get({ [TAB_URLS]: {}, [TAB_NAV]: {} });
    const tabs = data[TAB_URLS];
    const nav = data[TAB_NAV];
    if (!tabs[removedTabId]) return;
    tabs[addedTabId] = [...new Set([...(tabs[addedTabId] || []), ...tabs[removedTabId]])];
    delete tabs[removedTabId];
    if (nav[removedTabId] && !nav[addedTabId]) nav[addedTabId] = nav[removedTabId];
    delete nav[removedTabId];
    await chrome.storage.session.set({ [TAB_URLS]: tabs, [TAB_NAV]: nav });
  });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const { closed, pending, stillOpen, nav } = await withTabs(async () => {
    const data = await chrome.storage.session.get({ [TAB_URLS]: {}, [TAB_NAV]: {}, [PENDING]: [] });
    const tabs = data[TAB_URLS];
    const closedUrls = tabs[tabId] || [];
    const closedNav = data[TAB_NAV][tabId];
    delete tabs[tabId];
    delete data[TAB_NAV][tabId];
    await chrome.storage.session.set({ [TAB_URLS]: tabs, [TAB_NAV]: data[TAB_NAV], [PENDING]: [] });
    return { closed: closedUrls, pending: data[PENDING], stillOpen: new Set(Object.values(tabs).flat()), nav: closedNav };
  });

  const s = await getSettings();
  for (const url of closed.filter((u) => isOwnPage(u) && !stillOpen.has(u))) {
    await deleteHistoryUrl(url, s);   // always, uncounted
  }
  if (s.enabled && s.mode === "onTabClose") {
    // A URL that another open tab also visited is removed when that tab closes.
    const urls = [...closed, ...pending].filter((url) => !stillOpen.has(url));
    await recordRemoved(await removeUrls(urls, s));
  }
  await withCleanup(() => clearClosedTab(nav, s));
});

// ---------- Interval mode ----------
async function syncAlarm() {
  const s = await getSettings();
  const existing = await chrome.alarms.get(ALARM);
  if (!(s.enabled && s.mode === "interval")) {
    if (existing) await chrome.alarms.clear(ALARM);
    return;
  }
  const period = Math.max(0.5, Number(s.intervalMin) || 10);   // Chrome's minimum is 30 s
  if (existing?.periodInMinutes === period) return;
  await chrome.alarms.create(ALARM, { delayInMinutes: period, periodInMinutes: period });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === SCHEDULE_ALARM) return syncSchedule();
  if (alarm.name !== ALARM) return;
  const s = await getSettings();
  if (!s.enabled || s.mode !== "interval") return;
  await cleanSince(await sweepStart(s));
});

// ---------- Ghost Sessions (manual and scheduled) ----------
async function endGhostSession() {
  const s = await getSettings();
  if (!s.ghostSession) return { ok: true, removed: 0, kept: 0, skipped: 0 };
  const result = await cleanSince(s.ghostSession.start);   // final sweep while still in session
  await saveSettings({ ghostSession: null });
  return { ok: true, ...result };
}

// Starts or ends the scheduled Ghost Session to match the schedule, then sets an
// alarm for the next change. Runs on every worker start, so a session that should
// have ended while Chrome was closed is ended (with its final sweep) at startup.
function syncSchedule() {
  return withSchedule(async () => {
    const s = await getSettings();
    const now = Date.now();
    const win = activeWindow(s.ghostSchedule, now);
    if (win) {
      if (!s.ghostSession && !(s.ghostSkipUntil > now)) {
        await saveSettings({ ghostSession: { start: now, scheduled: true, until: win.end } });
      } else if (s.ghostSession?.scheduled && s.ghostSession.until !== win.end) {
        // The schedule was edited during a session: keep going until the new end.
        await saveSettings({ ghostSession: { ...s.ghostSession, until: win.end } });
      }
    } else if (s.ghostSession?.scheduled) {
      await endGhostSession();
    }
    const next = nextChange(s.ghostSchedule, now);
    if (next) await chrome.alarms.create(SCHEDULE_ALARM, { when: next });
    else await chrome.alarms.clear(SCHEDULE_ALARM);
  });
}

// ---------- Downloads (Immediate mode + Ghost Session) ----------
let downloadsHooked = false;

function hookDownloads() {
  if (downloadsHooked || !chrome.downloads?.onChanged) return;
  downloadsHooked = true;
  chrome.downloads.onChanged.addListener(async (delta) => {
    const state = delta.state?.current;
    if (state !== "complete" && state !== "interrupted") return;
    const s = await getSettings();
    if (!s.cleanDownloads || !(s.ghostSession || (s.enabled && s.mode === "immediate"))) return;
    const [item] = await chrome.downloads.search({ id: delta.id });
    if (item && shouldHideDownload(item, s)) await chrome.downloads.erase({ id: delta.id });
  });
}

chrome.permissions.onAdded.addListener(hookDownloads);

chrome.permissions.onRemoved.addListener(async ({ permissions = [] }) => {
  // Revoked from chrome://extensions: turn the matching feature off too.
  const patch = {};
  if (permissions.includes("downloads")) patch.cleanDownloads = false;
  if (permissions.includes("browsingData")) Object.assign(patch, { cleanCache: false, cleanRecentlyClosed: false });
  if (Object.keys(patch).length) await saveSettings(patch);
});

// ---------- Startup / install ----------
const withSession = createLock();

// Sweeps what the last browser session left behind (browser close, crash,
// tab-close misses). Runs once per browser session.
//
// runtime.onStartup is the normal trigger, but Chrome does not always deliver
// it, so the first time the worker runs in a new browser session also counts:
// storage.session is empty after every restart. Installs and updates also
// start with an empty storage.session; a changed version number tells those
// apart, and they do not trigger a sweep.
function startSession({ fromStartupEvent = false } = {}) {
  return withSession(async () => {
    const { sessionSeen, sessionSwept } = await chrome.storage.session.get({ sessionSeen: false, sessionSwept: false });
    if (sessionSwept || (sessionSeen && !fromStartupEvent)) return;
    await chrome.storage.session.set({ sessionSeen: true });

    const version = chrome.runtime.getManifest().version;
    const { seenVersion } = await chrome.storage.local.get({ seenVersion: null });
    if (seenVersion !== version) {
      await chrome.storage.local.set({ seenVersion: version });
      if (!fromStartupEvent) return;   // installed or updated, not a browser start
    }

    await chrome.storage.session.set({ sessionSwept: true });
    await seedTabs();
    const s = await getSettings();
    if (s.enabled || s.ghostSession) await cleanSince(await sweepStart(s));
    await syncAlarm();
    await syncSchedule();
    await updateBadge();
  });
}

chrome.runtime.onStartup.addListener(() => startSession({ fromStartupEvent: true }));

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const s = await getSettings();
  const firstRun = !s.lastCleanup;
  // Set the cursor only once, so updates do not skip history waiting to be swept.
  if (firstRun) await saveSettings({ lastCleanup: Date.now() });
  await seedTabs();
  await syncAlarm();
  await updateBadge();
  if (reason === "install" && firstRun) {
    await chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html#welcome") });
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.language) {
    i18nReady = initI18n(changes.language.newValue ?? "auto");
    updateBadge();
  }
  if (changes.ghostSchedule) syncSchedule();
  if (changes.mode || changes.intervalMin || changes.enabled) syncAlarm();
  if (changes.enabled || changes.ghostSession) updateBadge();
  if (changes.mode || changes.enabled) {
    withTabs(() => chrome.storage.session.set({ [PENDING]: [] }));
  }
});

// ---------- Messages from popup ----------
const handlers = {
  async cleanNow() {
    const s = await getSettings();
    return cleanSince(await sweepStart(s));
  },
  async cleanRange({ since }) {
    const start = Number(since);
    if (!Number.isFinite(start) || start < 0) throw new Error(await errorText("errInvalidRange"));
    return cleanSince(start);
  },
  async startGhost() {
    const s = await getSettings();
    if (!s.ghostSession) await saveSettings({ ghostSession: { start: Date.now() } });
    return { ok: true };
  },
  async endGhost() {
    const s = await getSettings();
    // Ending a scheduled session by hand keeps it off until its window is over.
    const win = s.ghostSession?.scheduled && activeWindow(s.ghostSchedule);
    if (win) await saveSettings({ ghostSkipUntil: win.end });
    return endGhostSession();
  },
  // "Forget this site": removes every history entry for a site and its
  // subdomains, whatever the rules say, because the user asked for it directly.
  async forgetSite({ host }) {
    const site = normalizeDomain(String(host ?? ""));
    if (!site) throw new Error(await errorText("errInvalidSite"));
    return withCleanup(async () => {
      const items = await chrome.history.search({ text: "", startTime: 0, maxResults: SEARCH_LIMIT });
      const isTarget = (url) => matchesDomain(hostOf(url), [site]);
      const urls = items.map((i) => i.url).filter(isTarget);
      const s = await getSettings();
      for (let i = 0; i < urls.length; i += DELETE_BATCH) {
        await Promise.all(urls.slice(i, i + DELETE_BATCH).map((url) => deleteHistoryUrl(url, s, { isTarget })));
      }
      await recordRemoved(urls.length);
      return { removed: urls.length, site };
    });
  }
};

async function errorText(key) {
  await i18nReady;
  return t(key);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const handler = handlers[msg?.type];
  if (!handler || sender.id !== chrome.runtime.id) return false;
  handler(msg).then(reply, (err) => reply({ error: String(err?.message || err) }));
  return true; // keep channel open for async reply
});

// ---------- Keyboard shortcuts ----------
const FLASH_MS = 2500;
let flashTimer = 0;

// No popup is open when a shortcut is used, so the badge briefly shows the result.
async function flashBadge(text, title) {
  await i18nReady;
  clearTimeout(flashTimer);
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: "#1565c0" });
  await chrome.action.setTitle({ title });
  flashTimer = setTimeout(updateBadge, FLASH_MS);
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "clean-now") {
    const result = await handlers.cleanNow();
    const s = await getSettings();
    await i18nReady;
    await flashBadge(result.removed ? `-${Math.min(result.removed, 999)}` : "✓", t("flashTitle", cleanupSummary(result, s)));
  } else if (command === "toggle-ghost") {
    // The 👻 badge appearing or disappearing is the feedback.
    const s = await getSettings();
    await (s.ghostSession ? handlers.endGhost() : handlers.startGhost());
  }
});

// ---------- Badge ----------
async function updateBadge() {
  await i18nReady;
  const s = await getSettings();
  const state = s.ghostSession ? "ghost" : s.enabled ? "on" : "off";
  const badge = BADGE[state];
  await chrome.action.setBadgeText({ text: t(badge.text) });
  await chrome.action.setBadgeBackgroundColor({ color: badge.color });
  await chrome.action.setBadgeTextColor({ color: "#ffffff" });
  await chrome.action.setTitle({ title: t(badge.title) });
  await chrome.action.setIcon({ path: state === "off" ? ICONS.off : ICONS.on });
}

// ---------- Every worker start ----------
hookDownloads();
syncAlarm();
syncSchedule();
startSession();
