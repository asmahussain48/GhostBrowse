import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createChrome, createState, browserRestart } from "./helpers/chrome-mock.js";
import { todayKey } from "../lib/settings.js";

let chrome;
const MIN = 60_000;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Loads background.js into a fresh "service worker" backed by the given state.
async function startWorker(state = createState()) {
  chrome = createChrome(state);
  globalThis.chrome = chrome;
  vi.resetModules();
  await import("../background.js");
  await flush();
  return chrome;
}

async function configure(patch) {
  await chrome.storage.local.set(patch);
  await flush();
}

const local = () => chrome._state.local;
const removedToday = () => local().stats?.today ?? 0;

// Simulates a tab navigating: Chrome updates the tab URL, then records the visit.
async function navigate(tabId, url, { incognito = false, time = Date.now() } = {}) {
  await chrome.tabs.onUpdated.dispatch(tabId, { url }, { id: tabId, url, incognito });
  if (!incognito) await chrome.history.visit(url, time, tabId);
  await flush();
}

async function closeTab(tabId) {
  await chrome.closeTab(tabId);
  await flush();
}

beforeEach(async () => {
  await startWorker();
  await configure({ lastCleanup: Date.now() - 10 * MIN });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Immediate mode", () => {
  beforeEach(() => configure({ mode: "immediate" }));

  it("removes a visited page right away and counts it (test 1)", async () => {
    await chrome.history.visit("https://example.com/");
    expect(chrome.history.has("https://example.com/")).toBe(false);
    expect(removedToday()).toBe(1);
    expect(local().stats.total).toBe(1);
  });

  it("keeps sites on the Keep list (test 3)", async () => {
    await configure({ keepList: ["github.com"] });
    await chrome.history.visit("https://github.com/explore");
    expect(chrome.history.has("https://github.com/explore")).toBe(true);
    expect(removedToday()).toBe(0);
  });

  it("keeps subdomains of a kept domain (test 4)", async () => {
    await configure({ keepList: ["google.com"] });
    await chrome.history.visit("https://mail.google.com/mail/u/0/");
    expect(chrome.history.has("https://mail.google.com/mail/u/0/")).toBe(true);
  });

  it("removes only Hide-listed sites in hideListed mode (test 5)", async () => {
    await configure({ ruleMode: "hideListed", hideList: ["youtube.com"] });
    await chrome.history.visit("https://www.youtube.com/watch?v=abc");
    await chrome.history.visit("https://en.wikipedia.org/wiki/Ghost");
    expect(chrome.history.urls()).toEqual(["https://en.wikipedia.org/wiki/Ghost"]);
  });

  it("removes pages matching a Hide keyword on any site", async () => {
    await configure({ ruleMode: "hideListed", hideList: [], keywords: ["salary"] });
    await chrome.history.visit("https://www.google.com/search?q=salary+negotiation");
    await chrome.history.visit("https://www.google.com/search?q=weather");
    expect(chrome.history.urls()).toEqual(["https://www.google.com/search?q=weather"]);
  });

  it("ignores chrome:// and file:// pages without errors (test 14)", async () => {
    await chrome.history.visit("chrome://settings/");
    await chrome.history.visit("file:///C:/notes.html");
    expect(chrome.history.has("chrome://settings/")).toBe(true);
    expect(chrome.history.has("file:///C:/notes.html")).toBe(true);
    expect(removedToday()).toBe(0);
  });

  it("keeps history while turned OFF (test 13)", async () => {
    await configure({ enabled: false });
    await chrome.history.visit("https://example.com/");
    expect(chrome.history.has("https://example.com/")).toBe(true);
  });
});

describe("Tab-close mode", () => {
  beforeEach(() => configure({ mode: "onTabClose" }));

  it("removes every page a tab visited when it closes (test 6)", async () => {
    await navigate(1, "https://a.com/");
    await navigate(1, "https://b.com/");
    await navigate(1, "https://c.com/");
    await navigate(2, "https://other.com/");
    expect(chrome.history.urls()).toHaveLength(4);

    await closeTab(1);
    expect(chrome.history.urls()).toEqual(["https://other.com/"]);
    expect(removedToday()).toBe(3);
  });

  it("still works after the service worker restarts (test 7)", async () => {
    await navigate(1, "https://a.com/");
    await navigate(1, "https://b.com/");

    await startWorker(chrome._state);   // worker was stopped while idle
    await closeTab(1);
    expect(chrome.history.urls()).toEqual([]);
  });

  it("does not lose URLs when many tab updates arrive at once", async () => {
    const urls = Array.from({ length: 25 }, (_, i) => `https://site${i}.com/`);
    await Promise.all(urls.map((url) => chrome.tabs.onUpdated.dispatch(7, { url }, { id: 7, url, incognito: false })));
    urls.forEach((url) => chrome.history.record(url));
    await flush();

    await closeTab(7);
    expect(chrome.history.urls()).toEqual([]);
    expect(removedToday()).toBe(25);
  });

  it("waits until the last tab showing a page closes", async () => {
    await navigate(1, "https://shared.com/");
    await navigate(2, "https://shared.com/");

    await closeTab(1);
    expect(chrome.history.has("https://shared.com/")).toBe(true);
    await closeTab(2);
    expect(chrome.history.has("https://shared.com/")).toBe(false);
  });

  it("removes redirect hops that never showed up as a tab URL", async () => {
    await chrome.history.visit("http://short.link/abc");   // redirect source
    await navigate(1, "https://target.com/article");

    await closeTab(1);
    expect(chrome.history.urls()).toEqual([]);
  });

  it("does not count pages that were already gone", async () => {
    await navigate(1, "https://a.com/");
    await chrome.history.deleteUrl({ url: "https://a.com/" });
    await closeTab(1);
    expect(removedToday()).toBe(0);
  });

  it("never deletes URLs seen in Incognito tabs", async () => {
    chrome.history.record("https://bank.com/");            // normal-profile history
    await navigate(5, "https://bank.com/", { incognito: true });
    await closeTab(5);
    expect(chrome.history.has("https://bank.com/")).toBe(true);
  });

  it("tracks tabs that were already open when GhostBrowse was installed", async () => {
    chrome._state.tabs = [{ id: 3, url: "https://before.com/", incognito: false }];
    chrome.history.record("https://before.com/");
    await chrome.runtime.onInstalled.dispatch({ reason: "install" });

    await closeTab(3);
    expect(chrome.history.has("https://before.com/")).toBe(false);
  });

  it("follows a tab that Chrome replaces (prerendering)", async () => {
    await navigate(1, "https://a.com/");
    await chrome.tabs.onReplaced.dispatch(10, 1);
    await flush();
    await closeTab(10);
    expect(chrome.history.has("https://a.com/")).toBe(false);
  });

  it("respects the Keep list", async () => {
    await configure({ keepList: ["university.edu"] });
    await navigate(1, "https://portal.university.edu/grades");
    await navigate(1, "https://games.com/");
    await closeTab(1);
    expect(chrome.history.urls()).toEqual(["https://portal.university.edu/grades"]);
  });

  it("keeps history while turned OFF (test 13)", async () => {
    await configure({ enabled: false });
    await navigate(1, "https://a.com/");
    await closeTab(1);
    expect(chrome.history.has("https://a.com/")).toBe(true);
  });

  it("does nothing on tab close in other modes", async () => {
    await configure({ mode: "interval" });
    await navigate(1, "https://a.com/");
    await closeTab(1);
    expect(chrome.history.has("https://a.com/")).toBe(true);
  });
});

describe("Interval mode (test 8)", () => {
  it("creates the alarm with the chosen period and clears it when leaving the mode", async () => {
    await configure({ mode: "interval", intervalMin: 5 });
    expect(chrome._state.alarms.get("ghost-clean")).toMatchObject({ periodInMinutes: 5 });

    await configure({ intervalMin: 1 });
    expect(chrome._state.alarms.get("ghost-clean")).toMatchObject({ periodInMinutes: 1 });

    await configure({ enabled: false });
    expect(chrome._state.alarms.has("ghost-clean")).toBe(false);

    await configure({ enabled: true, mode: "immediate" });
    expect(chrome._state.alarms.has("ghost-clean")).toBe(false);
  });

  it("removes history since the last cleanup and moves the cursor", async () => {
    await configure({ mode: "interval", intervalMin: 1, keepList: ["keep.com"] });
    const before = local().lastCleanup;
    chrome.history.record("https://old.com/", before - MIN);      // swept earlier, left alone
    chrome.history.record("https://a.com/", before + 1000);
    chrome.history.record("https://keep.com/", before + 2000);

    await chrome.alarms.onAlarm.dispatch({ name: "ghost-clean" });
    expect(chrome.history.urls().sort()).toEqual(["https://keep.com/", "https://old.com/"]);
    expect(local().lastCleanup).toBeGreaterThan(before);
    expect(removedToday()).toBe(1);
  });

  it("ignores the alarm if the mode changed in the meantime", async () => {
    await configure({ mode: "immediate" });
    chrome.history.record("https://a.com/", Date.now() - 1000);
    await chrome.alarms.onAlarm.dispatch({ name: "ghost-clean" });
    expect(chrome.history.has("https://a.com/")).toBe(true);
  });

  it("recreates a missing alarm when the worker starts", async () => {
    await configure({ mode: "interval", intervalMin: 10 });
    chrome._state.alarms.clear();
    await startWorker(chrome._state);
    expect(chrome._state.alarms.get("ghost-clean")).toMatchObject({ periodInMinutes: 10 });
  });
});

describe("Startup (test 9)", () => {
  it("removes history left over from the last session", async () => {
    await configure({ mode: "onStartup", keepList: ["gmail.com"] });
    chrome.history.record("https://a.com/", Date.now() - 5 * MIN);
    chrome.history.record("https://gmail.com/", Date.now() - 4 * MIN);

    await startWorker(browserRestart(chrome._state));   // Chrome restarted
    await chrome.runtime.onStartup.dispatch();
    expect(chrome.history.urls()).toEqual(["https://gmail.com/"]);
    expect(chrome._state.badge.text).toBe("ON");
  });

  it("does not sweep when turned OFF", async () => {
    await configure({ enabled: false });
    chrome.history.record("https://a.com/", Date.now() - MIN);
    await chrome.runtime.onStartup.dispatch();
    expect(chrome.history.has("https://a.com/")).toBe(true);
    expect(chrome._state.badge.text).toBe("OFF");
  });

  it("sweeps at the first wake-up after a restart, even if Chrome never sends onStartup", async () => {
    await configure({ mode: "onStartup" });
    chrome.history.record("https://a.com/", Date.now() - 5 * MIN);
    await startWorker(browserRestart(chrome._state));   // no onStartup dispatched
    expect(chrome.history.has("https://a.com/")).toBe(false);
    expect(chrome._state.badge.text).toBe("ON");
  });

  it("sweeps only once per browser session", async () => {
    await startWorker(browserRestart(chrome._state));
    const search = vi.spyOn(chrome.history, "search");
    await chrome.runtime.onStartup.dispatch();
    await startWorker(chrome._state);                   // worker restart, same browser session
    expect(search).not.toHaveBeenCalled();
    expect(chrome._state.session.sessionSwept).toBe(true);
  });

  it("does not sweep when the worker starts because of an update mid-session", async () => {
    await configure({ mode: "onStartup" });
    chrome.history.record("https://a.com/", Date.now() - 5 * MIN);
    chrome._state.version = "1.0.1";
    await startWorker(browserRestart(chrome._state));   // update also empties session storage
    await chrome.runtime.onInstalled.dispatch({ reason: "update", previousVersion: "1.0.0" });
    await startWorker(chrome._state);                   // later wake-up in the same session
    expect(chrome.history.has("https://a.com/")).toBe(true);
  });

  it("still sweeps when an update is applied at browser start", async () => {
    await configure({ mode: "onStartup" });
    chrome.history.record("https://a.com/", Date.now() - 5 * MIN);
    chrome._state.version = "1.0.1";
    await startWorker(browserRestart(chrome._state));
    await chrome.runtime.onStartup.dispatch();
    expect(chrome.history.has("https://a.com/")).toBe(false);
  });

  it("never treats a missing cursor as 'all time'", async () => {
    await configure({ lastCleanup: 0 });
    chrome.history.record("https://from-before-install.com/", Date.now() - 60 * MIN);
    await chrome.runtime.onStartup.dispatch();
    expect(chrome.history.has("https://from-before-install.com/")).toBe(true);
    expect(local().lastCleanup).toBeGreaterThan(0);
  });
});

describe("Ghost Session (test 10)", () => {
  it("removes everything immediately, sweeps at the end, and shows the badge", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const t0 = Date.now();
    await configure({ mode: "onTabClose", ruleMode: "hideListed", hideList: [] });
    const start = await chrome.send({ type: "startGhost" });
    await flush();
    expect(start).toEqual({ ok: true });
    expect(chrome._state.badge.text).toBe("👻");

    await chrome.history.visit("https://secret.com/");
    expect(chrome.history.has("https://secret.com/")).toBe(false);

    // Something recorded while the listener could not run (e.g. worker busy).
    chrome.history.record("https://missed.com/", t0 + 1000);
    vi.setSystemTime(t0 + 5000);
    const end = await chrome.send({ type: "endGhost" });
    vi.useRealTimers();
    await flush();
    expect(end).toEqual({ ok: true, removed: 1, kept: 0, skipped: 0 });
    expect(chrome.history.has("https://missed.com/")).toBe(false);
    expect(local().ghostSession).toBeNull();
    expect(chrome._state.badge.text).toBe("ON");
  });

  it("works while automatic removal is OFF", async () => {
    await configure({ enabled: false });
    await chrome.send({ type: "startGhost" });
    await flush();
    await chrome.history.visit("https://secret.com/");
    expect(chrome.history.has("https://secret.com/")).toBe(false);
  });

  it("still respects the Keep list", async () => {
    await configure({ keepList: ["gmail.com"] });
    await chrome.send({ type: "startGhost" });
    await flush();
    await chrome.history.visit("https://gmail.com/");
    expect(chrome.history.has("https://gmail.com/")).toBe(true);
  });

  it("final sweep leaves history from before the session alone", async () => {
    await configure({ mode: "onStartup" });
    chrome.history.record("https://before.com/", Date.now() - 5 * MIN);
    await chrome.send({ type: "startGhost" });
    await flush();
    await chrome.send({ type: "endGhost" });
    expect(chrome.history.has("https://before.com/")).toBe(true);
  });

  it("survives a browser restart and keeps its badge", async () => {
    await chrome.send({ type: "startGhost" });
    await flush();
    await startWorker(browserRestart(chrome._state));
    await chrome.runtime.onStartup.dispatch();
    expect(chrome._state.badge.text).toBe("👻");
    expect(local().ghostSession).not.toBeNull();
  });
});

describe("Clean Now and Clean range", () => {
  it("Clean Now removes history since the last cleanup, respecting rules (test 2)", async () => {
    await configure({ mode: "onStartup", keepList: ["mail.google.com"] });
    chrome.history.record("https://mail.google.com/mail/", Date.now() - MIN);
    chrome.history.record("https://shopping.com/cart", Date.now() - MIN);

    const reply = await chrome.send({ type: "cleanNow" });
    expect(reply).toEqual({ removed: 1, kept: 1, skipped: 0 });
    expect(chrome.history.urls()).toEqual(["https://mail.google.com/mail/"]);
  });

  it("Clean Now works even when automatic removal is OFF", async () => {
    await configure({ enabled: false });
    chrome.history.record("https://a.com/", Date.now() - MIN);
    expect(await chrome.send({ type: "cleanNow" })).toEqual({ removed: 1, kept: 0, skipped: 0 });
  });

  it("uses one deleteRange call when nothing in range needs keeping", async () => {
    const spy = vi.spyOn(chrome.history, "deleteRange");
    const del = vi.spyOn(chrome.history, "deleteUrl");
    chrome.history.record("https://a.com/", Date.now() - MIN);
    chrome.history.record("https://b.com/", Date.now() - MIN);
    await chrome.send({ type: "cleanNow" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
    expect(chrome.history.urls()).toEqual([]);
  });

  it("deletes URL by URL when something in range must be kept", async () => {
    await configure({ keepList: ["keep.com"] });
    const spy = vi.spyOn(chrome.history, "deleteRange");
    chrome.history.record("https://a.com/", Date.now() - 3 * MIN);
    chrome.history.record("https://keep.com/", Date.now() - 2 * MIN);
    chrome.history.record("chrome://settings/", Date.now() - MIN);
    await chrome.send({ type: "cleanNow" });
    // Only 1 ms ranges around a.com's visit, never the whole sweep range.
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const [{ startTime, endTime }] of spy.mock.calls) expect(endTime - startTime).toBe(1);
    expect(chrome.history.urls().sort()).toEqual(["chrome://settings/", "https://keep.com/"]);
  });

  it("Clean range reaches history from before install", async () => {
    chrome.history.record("https://old.com/", Date.now() - 3 * 86400_000);
    const reply = await chrome.send({ type: "cleanRange", since: Date.now() - 7 * 86400_000 });
    expect(reply).toEqual({ removed: 1, kept: 0, skipped: 0 });
    expect(chrome.history.has("https://old.com/")).toBe(false);
  });

  it("a narrow range does not move the cursor past unswept history", async () => {
    await configure({ mode: "interval", lastCleanup: Date.now() - 3 * 60 * MIN });
    const cursor = local().lastCleanup;
    chrome.history.record("https://two-hours-ago.com/", Date.now() - 2 * 60 * MIN);

    await chrome.send({ type: "cleanRange", since: Date.now() - 60 * MIN });
    expect(local().lastCleanup).toBe(cursor);
    expect(chrome.history.has("https://two-hours-ago.com/")).toBe(true);

    await chrome.alarms.onAlarm.dispatch({ name: "ghost-clean" });
    expect(chrome.history.has("https://two-hours-ago.com/")).toBe(false);
  });

  it("reports what was left and why", async () => {
    await configure({ keepList: ["university.edu"] });
    chrome.history.record("https://portal.university.edu/", Date.now() - MIN);
    chrome.history.record("https://news.com/", Date.now() - MIN);
    chrome.history.record("file:///C:/notes.html", Date.now() - MIN);
    chrome.history.record("chrome-extension://other-extension/page.html", Date.now() - MIN);
    expect(await chrome.send({ type: "cleanRange", since: 0 })).toEqual({ removed: 1, kept: 1, skipped: 2 });
  });

  it("'All time' in Immediate mode finds nothing new, only the kept pages", async () => {
    await configure({ mode: "immediate", keepList: ["gmail.com"] });
    await chrome.history.visit("https://news.com/", Date.now() - 1000);         // removed on visit
    await chrome.history.visit("https://gmail.com/inbox", Date.now() - 1000);   // kept
    expect(await chrome.send({ type: "cleanRange", since: 0 })).toEqual({ removed: 0, kept: 1, skipped: 0 });
    expect(chrome.history.urls()).toEqual(["https://gmail.com/inbox"]);
  });

  it("rejects an invalid range", async () => {
    expect(await chrome.send({ type: "cleanRange", since: "soon" })).toEqual({ error: "Invalid time range." });
  });

  it("ignores messages from other extensions", async () => {
    chrome.history.record("https://a.com/", Date.now() - MIN);
    expect(await chrome.send({ type: "cleanNow" }, { id: "someone-else" })).toBeUndefined();
    expect(chrome.history.has("https://a.com/")).toBe(true);
  });
});

describe("Scheduled Ghost Sessions", () => {
  const at = (d, h, m = 0) => new Date(2026, 9, d, h, m).getTime();   // October 2026; the 19th is a Monday
  const work = { enabled: true, days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };
  const fireSchedule = async () => {
    await chrome.alarms.onAlarm.dispatch({ name: "ghost-schedule" });
    await flush();
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at(19, 10));
  });

  it("starts inside the window, removes visits right away, and ends with a final sweep", async () => {
    await configure({ mode: "onStartup", lastCleanup: at(19, 8), ghostSchedule: work });
    expect(local().ghostSession).toEqual({ start: at(19, 10), scheduled: true, until: at(19, 17) });
    expect(chrome._state.badge.text).toBe("👻");
    expect(chrome._state.alarms.get("ghost-schedule").scheduledTime).toBe(at(19, 17));

    await chrome.history.visit("https://private.example/", at(19, 10));
    expect(chrome.history.has("https://private.example/")).toBe(false);
    chrome.history.record("https://missed.example/", at(19, 12));   // e.g. visited while the worker was busy

    vi.setSystemTime(at(19, 17));
    await fireSchedule();
    expect(local().ghostSession).toBeNull();
    expect(chrome.history.has("https://missed.example/")).toBe(false);
    expect(chrome._state.alarms.get("ghost-schedule").scheduledTime).toBe(at(20, 9));   // Tuesday
  });

  it("does not start outside the window or on days off", async () => {
    vi.setSystemTime(at(18, 10));   // Sunday
    await configure({ ghostSchedule: work });
    expect(local().ghostSession ?? null).toBeNull();
    expect(chrome._state.alarms.get("ghost-schedule").scheduledTime).toBe(at(19, 9));
  });

  it("a scheduled session ended by hand stays off until the window is over", async () => {
    await configure({ ghostSchedule: work });
    await chrome.send({ type: "endGhost" });
    await flush();
    expect(local().ghostSession).toBeNull();

    vi.setSystemTime(at(19, 11));
    await fireSchedule();
    expect(local().ghostSession).toBeNull();

    vi.setSystemTime(at(20, 9));
    await fireSchedule();
    expect(local().ghostSession).toMatchObject({ scheduled: true, until: at(20, 17) });
  });

  it("a session left over from a closed browser ends at the next start", async () => {
    await configure({ ghostSchedule: work, lastCleanup: at(19, 8) });
    chrome.history.record("https://during-session.example/", at(19, 12));

    vi.setSystemTime(at(20, 8));   // Chrome was closed overnight
    await startWorker(browserRestart(chrome._state));
    expect(local().ghostSession).toBeNull();
    expect(chrome.history.has("https://during-session.example/")).toBe(false);
  });

  it("editing the window during a session moves its end", async () => {
    await configure({ ghostSchedule: work });
    await configure({ ghostSchedule: { ...work, end: "18:00" } });
    expect(local().ghostSession).toMatchObject({ scheduled: true, until: at(19, 18) });
  });

  it("turning the schedule off ends its session", async () => {
    await configure({ ghostSchedule: work });
    await configure({ ghostSchedule: { ...work, enabled: false } });
    expect(local().ghostSession).toBeNull();
    expect(chrome._state.alarms.has("ghost-schedule")).toBe(false);
  });

  it("never ends a session the user started by hand", async () => {
    vi.setSystemTime(at(19, 18));
    await configure({ ghostSchedule: work });
    await chrome.send({ type: "startGhost" });
    await fireSchedule();
    expect(local().ghostSession).toMatchObject({ start: at(19, 18) });
    expect(local().ghostSession.scheduled).toBeUndefined();
  });
});

describe("Forget this site", () => {
  it("removes every entry for the site and its subdomains, even if it is kept", async () => {
    await configure({ keepList: ["github.com"] });
    for (const url of ["https://github.com/a", "https://gist.github.com/b", "https://notgithub.com/c", "https://google.com/d"]) {
      chrome.history.record(url, Date.now() - 30 * 86400_000);
    }
    expect(await chrome.send({ type: "forgetSite", host: "github.com" })).toEqual({ removed: 2, site: "github.com" });
    expect(chrome.history.urls().sort()).toEqual(["https://google.com/d", "https://notgithub.com/c"]);
    expect(removedToday()).toBe(2);
  });

  it("rejects something that is not a site", async () => {
    expect(await chrome.send({ type: "forgetSite", host: "not a site" })).toEqual({ error: "That is not a website GhostBrowse can forget." });
  });
});

describe("Language", () => {
  it("shows the badge tooltip in Urdu when Urdu is chosen", async () => {
    await configure({ language: "ur" });
    await vi.waitFor(() => expect(chrome._state.badge.title).toBe("GhostBrowse آن ہے"));
    expect(chrome._state.badge.text).toBe("آن");
  });
});

describe("Keyboard shortcuts", () => {
  it("Alt+Shift+D cleans and briefly shows the count on the badge", async () => {
    chrome.history.record("https://a.com/", Date.now() - MIN);
    chrome.history.record("https://b.com/", Date.now() - MIN);

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await chrome.commands.onCommand.dispatch("clean-now");
    expect(chrome.history.urls()).toEqual([]);
    expect(chrome._state.badge).toMatchObject({ text: "-2", title: "GhostBrowse: Removed 2 entries." });

    await vi.advanceTimersByTimeAsync(3000);
    vi.useRealTimers();
    await flush();
    expect(chrome._state.badge).toMatchObject({ text: "ON", title: "GhostBrowse is on" });
  });

  it("shows a check mark when there was nothing to remove", async () => {
    await chrome.commands.onCommand.dispatch("clean-now");
    expect(chrome._state.badge.text).toBe("✓");
  });

  it("Alt+Shift+G starts and ends a Ghost Session", async () => {
    await chrome.commands.onCommand.dispatch("toggle-ghost");
    await flush();
    expect(local().ghostSession).not.toBeNull();
    expect(chrome._state.badge.text).toBe("👻");

    await chrome.commands.onCommand.dispatch("toggle-ghost");
    await flush();
    expect(local().ghostSession).toBeNull();
    expect(chrome._state.badge.text).toBe("ON");
  });

  it("ignores unknown commands", async () => {
    chrome.history.record("https://a.com/", Date.now() - MIN);
    await chrome.commands.onCommand.dispatch("something-else");
    expect(chrome.history.has("https://a.com/")).toBe(true);
  });
});

describe("GhostBrowse's own pages", () => {
  const settingsPage = "chrome-extension://ghostbrowse-test/options/options.html#welcome";
  const helpPage = "chrome-extension://ghostbrowse-test/help/help.html";

  it("removes its Settings page from history and Recently closed when its tab closes, uncounted", async () => {
    await configure({ mode: "immediate" });
    await navigate(4, settingsPage);
    await closeTab(4);
    expect(chrome.history.has(settingsPage)).toBe(false);
    expect(chrome.recentlyClosed()).toEqual([]);
    expect(removedToday()).toBe(0);
  });

  it("does so even while automatic removal is OFF", async () => {
    await configure({ enabled: false });
    await navigate(4, helpPage);
    await closeTab(4);
    expect(chrome.history.has(helpPage)).toBe(false);
    expect(chrome.recentlyClosed()).toEqual([]);
  });

  it("sweeps leftover own pages during a cleanup without counting them", async () => {
    await configure({ keepList: ["keep.com"] });
    chrome.history.record(helpPage, Date.now() - MIN);
    chrome.history.record("https://keep.com/", Date.now() - MIN);
    expect(await chrome.send({ type: "cleanNow" })).toEqual({ removed: 0, kept: 1, skipped: 0 });
    expect(chrome.history.urls()).toEqual(["https://keep.com/"]);
  });

  it("still uses the single deleteRange call when only own and hidden pages are in range", async () => {
    const spy = vi.spyOn(chrome.history, "deleteRange");
    chrome.history.record(helpPage, Date.now() - MIN);
    chrome.history.record("https://a.com/", Date.now() - MIN);
    expect(await chrome.send({ type: "cleanNow" })).toEqual({ removed: 1, kept: 0, skipped: 0 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(chrome.history.urls()).toEqual([]);
  });
});

describe("Chrome's Recently closed list", () => {
  it("tab-close mode removes the closed tab from the list too", async () => {
    await configure({ mode: "onTabClose" });
    await navigate(1, "https://a.com/", { time: Date.now() - 2000 });
    await navigate(1, "https://b.com/", { time: Date.now() - 1000 });
    expect(chrome.history.urls()).toHaveLength(2);
    await closeTab(1);
    expect(chrome.history.urls()).toEqual([]);
    expect(chrome.recentlyClosed()).toEqual([]);
  });

  it("keeps a kept page in history while clearing the closed tab", async () => {
    await configure({ mode: "onTabClose", keepList: ["kept.com"] });
    await navigate(1, "https://kept.com/", { time: Date.now() - 2000 });
    await navigate(1, "https://hidden.com/", { time: Date.now() - 1000 });
    await closeTab(1);
    expect(chrome.history.urls()).toEqual(["https://kept.com/"]);
    expect(chrome.recentlyClosed()).toEqual([]);
  });

  it("never deletes a kept page visited in the same millisecond", async () => {
    await configure({ mode: "onTabClose", keepList: ["kept.com"] });
    const t = Date.now() - 1000;
    chrome.history.record("https://kept.com/", t);
    await navigate(1, "https://hidden.com/", { time: t });
    await closeTab(1);
    expect(chrome.history.urls()).toEqual(["https://kept.com/"]);
  });

  it("interval sweeps clear tabs closed since the last sweep", async () => {
    await configure({ mode: "interval", intervalMin: 1, keepList: ["kept.com"] });
    chrome.history.record("https://kept.com/", Date.now() - 3000);
    await navigate(2, "https://later.com/", { time: Date.now() - 2000 });
    await closeTab(2);
    expect(chrome.recentlyClosed()).toEqual(["https://later.com/"]);   // nothing removed yet
    await chrome.alarms.onAlarm.dispatch({ name: "ghost-clean" });
    expect(chrome.recentlyClosed()).toEqual([]);
    expect(chrome.history.urls()).toEqual(["https://kept.com/"]);
  });

  it("Forget this site also clears its closed tabs", async () => {
    await configure({ mode: "onStartup" });
    await navigate(3, "https://forget.me/page", { time: Date.now() - 1000 });
    await closeTab(3);
    await chrome.send({ type: "forgetSite", host: "forget.me" });
    expect(chrome.recentlyClosed()).toEqual([]);
  });

  it("a page cleaned while its tab was open needs the option once the tab closes", async () => {
    await configure({ mode: "onStartup", keepList: ["kept.com"] });
    await navigate(1, "https://open.com/", { time: Date.now() - 2000 });
    await chrome.send({ type: "cleanNow" });              // removed while the tab is still open
    await closeTab(1);
    expect(chrome.recentlyClosed()).toEqual(["https://open.com/"]);

    await chrome.grant("browsingData");
    await configure({ cleanRecentlyClosed: true });
    chrome.history.record("https://kept.com/", Date.now() - 500);
    await navigate(2, "https://open2.com/", { time: Date.now() - 1000 });
    await chrome.send({ type: "cleanRange", since: 0 });   // covers both visits; kept.com forces URL-by-URL
    await closeTab(2);
    expect(chrome.recentlyClosed()).toEqual(["https://open.com/"]);   // only the new one was cleared
    expect(chrome.history.has("https://kept.com/")).toBe(true);
  });

  it("an open Settings page survives a sweep and is removed when its tab closes", async () => {
    const page = "chrome-extension://ghostbrowse-test/options/options.html";
    await navigate(5, page, { time: Date.now() - 1000 });
    await chrome.send({ type: "cleanNow" });
    expect(chrome.history.has(page)).toBe(true);
    await closeTab(5);
    expect(chrome.history.has(page)).toBe(false);
    expect(chrome.recentlyClosed()).toEqual([]);
  });

  describe("Immediate mode", () => {
    it("without the option, the closed tab stays in the list (history is already gone)", async () => {
      await configure({ mode: "immediate" });
      await navigate(1, "https://a.com/", { time: Date.now() - 1000 });
      expect(chrome.history.has("https://a.com/")).toBe(false);
      await closeTab(1);
      expect(chrome.recentlyClosed()).toEqual(["https://a.com/"]);
    });

    it("with the option, clears it and adds kept pages back", async () => {
      await chrome.grant("browsingData");
      await configure({ mode: "immediate", keepList: ["mail.com"], cleanRecentlyClosed: true });
      await navigate(1, "https://a.com/", { time: Date.now() - 1000 });
      await navigate(2, "https://mail.com/inbox", { time: Date.now() - 500 });   // another tab, kept
      await closeTab(1);
      expect(chrome.recentlyClosed()).toEqual([]);
      expect(chrome.history.urls()).toEqual(["https://mail.com/inbox"]);
    });

    it("leaves the list alone when the tab ended on a kept page", async () => {
      await chrome.grant("browsingData");
      await configure({ mode: "immediate", keepList: ["mail.com"], cleanRecentlyClosed: true });
      const spy = vi.spyOn(chrome.browsingData, "removeHistory");
      await navigate(1, "https://mail.com/inbox", { time: Date.now() - 1000 });
      await closeTab(1);
      expect(spy).not.toHaveBeenCalled();
      expect(chrome.history.has("https://mail.com/inbox")).toBe(true);
    });

    it("also works during a Ghost Session in another mode", async () => {
      await chrome.grant("browsingData");
      await configure({ mode: "onTabClose", cleanRecentlyClosed: true });
      await chrome.send({ type: "startGhost" });
      await flush();
      await navigate(1, "https://secret.com/", { time: Date.now() - 1000 });
      await closeTab(1);
      expect(chrome.recentlyClosed()).toEqual([]);
    });

    it("does nothing without the permission", async () => {
      await configure({ mode: "immediate", cleanRecentlyClosed: true });
      await navigate(1, "https://a.com/", { time: Date.now() - 1000 });
      await closeTab(1);
      expect(chrome.recentlyClosed()).toEqual(["https://a.com/"]);
    });

    it("turns off when the permission is revoked", async () => {
      await chrome.grant("browsingData");
      await configure({ cleanRecentlyClosed: true, cleanCache: true });
      await chrome.permissions.onRemoved.dispatch({ permissions: ["browsingData"] });
      expect(local()).toMatchObject({ cleanRecentlyClosed: false, cleanCache: false });
    });
  });
});

describe("Extra trace cleaning (test 11)", () => {
  const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();

  beforeEach(() => {
    chrome._state.downloads = [
      { id: 1, url: "https://files.com/a.zip", referrer: "", state: "complete", startTime: iso(MIN) },
      { id: 2, url: "https://files.com/big.iso", referrer: "", state: "in_progress", startTime: iso(MIN) },
      { id: 3, url: "https://cdn.net/x.pdf", referrer: "https://github.com/repo", state: "complete", startTime: iso(MIN) },
      { id: 4, url: "https://files.com/old.zip", referrer: "", state: "complete", startTime: iso(60 * MIN) }
    ];
  });

  it("does nothing without the optional permission", async () => {
    await configure({ cleanDownloads: true, cleanCache: true });
    await chrome.send({ type: "cleanNow" });
    expect(chrome._state.downloads).toHaveLength(4);
    expect(chrome._state.cacheClears).toHaveLength(0);
  });

  it("erases finished download entries in range, skipping kept sites and running downloads", async () => {
    await chrome.grant("downloads");
    await configure({ cleanDownloads: true, keepList: ["github.com"] });
    await chrome.send({ type: "cleanNow" });
    expect(chrome._state.downloads.map((d) => d.id)).toEqual([2, 3, 4]);
  });

  it("clears the cache since the sweep start", async () => {
    await chrome.grant("browsingData");
    await configure({ cleanCache: true });
    const cursor = local().lastCleanup;
    await chrome.send({ type: "cleanNow" });
    expect(chrome._state.cacheClears).toEqual([{ since: cursor }]);
  });

  it("erases a download as soon as it finishes in Immediate mode", async () => {
    await chrome.grant("downloads");
    await configure({ cleanDownloads: true, mode: "immediate" });
    await chrome.downloads.onChanged.dispatch({ id: 1, state: { previous: "in_progress", current: "complete" } });
    expect(chrome._state.downloads.map((d) => d.id)).toEqual([2, 3, 4]);
  });

  it("turns the feature off when the permission is revoked", async () => {
    await chrome.grant("downloads");
    await configure({ cleanDownloads: true });
    await chrome.permissions.onRemoved.dispatch({ permissions: ["downloads"] });
    expect(local().cleanDownloads).toBe(false);
  });
});

describe("Install, update and badge", () => {
  it("first install sets the cursor and opens the welcome page", async () => {
    await startWorker();   // brand-new profile
    await chrome.runtime.onInstalled.dispatch({ reason: "install" });
    expect(local().lastCleanup).toBeGreaterThan(0);
    expect(chrome._state.createdTabs).toEqual([
      { url: "chrome-extension://ghostbrowse-test/options/options.html#welcome" }
    ]);
    expect(chrome._state.badge).toMatchObject({ text: "ON", color: "#2e7d32" });
  });

  it("does not reopen the welcome page when settings already exist", async () => {
    await chrome.runtime.onInstalled.dispatch({ reason: "install" });
    expect(chrome._state.createdTabs).toEqual([]);
  });

  it("an update keeps the cursor so unswept history is not skipped", async () => {
    const cursor = local().lastCleanup;
    await chrome.runtime.onInstalled.dispatch({ reason: "update" });
    expect(local().lastCleanup).toBe(cursor);
    expect(chrome._state.createdTabs).toEqual([]);
  });

  it("shows a grey OFF badge and icon when turned off", async () => {
    await configure({ enabled: false });
    expect(chrome._state.badge).toMatchObject({ text: "OFF", color: "#757575" });
    expect(chrome._state.badge.icon[16]).toBe("icons/icon16-off.png");
  });
});

describe("Statistics and privacy (test 15)", () => {
  it("starts a new 'today' count on a new day but keeps the total", async () => {
    await configure({ mode: "immediate", stats: { today: 9, total: 40, day: "Mon Jan 01 2001" } });
    await chrome.history.visit("https://a.com/");
    expect(local().stats).toEqual({ today: 1, total: 41, day: todayKey() });
  });

  it("never stores a visited URL", async () => {
    await configure({ mode: "onTabClose" });
    await navigate(1, "https://secret-site.com/private");
    await chrome.history.visit("http://redirect.secret-site.com/");
    await closeTab(1);
    await chrome.send({ type: "cleanNow" });
    await configure({ mode: "immediate" });
    await chrome.history.visit("https://another-secret.org/");

    expect(JSON.stringify(chrome._state.local)).not.toMatch(/secret|https?:/);
    // The temporary tab map in session storage is emptied as tabs close.
    expect(JSON.stringify(chrome._state.session)).not.toMatch(/secret|https?:/);
  });
});
