// In-memory stand-in for the chrome.* APIs GhostBrowse uses.
//
// All data lives in a separate `state` object. Passing the same state to a new
// createChrome() simulates a service-worker restart: storage, history, tabs and
// alarms survive, but every listener has to be registered again. A browser
// restart also empties session storage and closes the tabs (see browserRestart).

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

export function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener: (fn) => listeners.push(fn),
    removeListener: (fn) => {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    hasListener: (fn) => listeners.includes(fn),
    dispatch: (...args) => Promise.all(listeners.map((fn) => fn(...args)))
  };
}

export function createState() {
  return {
    local: {},
    session: {},
    history: new Map(),         // url -> { url, title, visits: [time, ...] }
    alarms: new Map(),
    tabs: [],
    downloads: [],
    granted: new Set(),
    cacheClears: [],
    tabNavs: {},                // tabId -> [{ url, time }] navigations of open tabs
    closed: [],                 // Chrome's "Recently closed" list: [{ navs: [{ url, time }] }]
    createdTabs: [],
    badge: {}
  };
}

function createStorageArea(data, areaName, onChanged) {
  return {
    async get(keys) {
      if (keys == null) return clone(data);
      if (typeof keys === "string") keys = [keys];
      const out = {};
      if (Array.isArray(keys)) {
        for (const k of keys) if (k in data) out[k] = clone(data[k]);
        return out;
      }
      for (const [k, fallback] of Object.entries(keys)) out[k] = k in data ? clone(data[k]) : clone(fallback);
      return out;
    },
    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: clone(data[k]), newValue: clone(v) };
        data[k] = clone(v);
      }
      queueMicrotask(() => onChanged.dispatch(changes, areaName));
    },
    async remove(keys) {
      const changes = {};
      for (const k of [].concat(keys)) {
        if (!(k in data)) continue;
        changes[k] = { oldValue: clone(data[k]) };
        delete data[k];
      }
      queueMicrotask(() => onChanged.dispatch(changes, areaName));
    },
    async clear() {
      for (const k of Object.keys(data)) delete data[k];
    }
  };
}

// Chrome's "Recently closed" list, as observed in real Chrome: a time-range
// deletion removes navigations in that range, but only if it actually deleted
// history; deleting by URL never touches it; an entry disappears when its
// current (last) navigation is removed.
function dropClosedNavs(state, start, end) {
  state.closed = state.closed.filter((entry) => {
    const last = entry.navs[entry.navs.length - 1];
    entry.navs = entry.navs.filter((n) => n.time < start || n.time >= end);
    return entry.navs.length > 0 && entry.navs.includes(last);
  });
}

function createHistory(state) {
  const onVisited = createEvent();
  const entries = state.history;
  return {
    onVisited,
    onVisitRemoved: createEvent(),

    // Visits in [startTime, endTime), newest first, one result per URL.
    async search({ startTime = 0, endTime = Infinity, maxResults = 100 }) {
      const out = [];
      for (const e of entries.values()) {
        if (!e.visits.some((t) => t >= startTime && t < endTime)) continue;
        out.push({ url: e.url, title: e.title, lastVisitTime: Math.max(...e.visits), visitCount: e.visits.length });
      }
      out.sort((a, b) => b.lastVisitTime - a.lastVisitTime);
      return out.slice(0, maxResults);
    },
    async getVisits({ url }) {
      return (entries.get(url)?.visits ?? []).map((visitTime) => ({ visitTime }));
    },
    async deleteUrl({ url }) {
      entries.delete(url);
    },
    async deleteRange({ startTime, endTime }) {
      let deleted = 0;
      for (const [url, e] of entries) {
        const before = e.visits.length;
        e.visits = e.visits.filter((t) => t < startTime || t >= endTime);
        deleted += before - e.visits.length;
        if (e.visits.length === 0) entries.delete(url);
      }
      if (deleted) dropClosedNavs(state, startTime, endTime);
    },
    async addUrl({ url }) {
      const time = Date.now();
      const e = this.record(url, time);
      await onVisited.dispatch({ url, lastVisitTime: time, visitCount: e.visits.length });
    },
    async deleteAll() {
      entries.clear();
    },

    // Test helpers
    record(url, time = Date.now()) {
      const e = entries.get(url) ?? { url, title: url, visits: [] };
      e.visits.push(time);
      entries.set(url, e);
      return e;
    },
    async visit(url, time = Date.now(), tabId) {
      const e = this.record(url, time);
      if (tabId !== undefined) (state.tabNavs[tabId] ??= []).push({ url, time });
      await onVisited.dispatch({ url, lastVisitTime: time, visitCount: e.visits.length });
    },
    has: (url) => entries.has(url),
    urls: () => [...entries.keys()]
  };
}

function createDownloads(state) {
  const matches = (item, q) =>
    (q.id === undefined || item.id === q.id) &&
    (q.startedAfter === undefined || item.startTime > q.startedAfter);
  return {
    onChanged: createEvent(),
    async search(query) {
      return clone(state.downloads.filter((d) => matches(d, query)));
    },
    async erase(query) {
      const erased = state.downloads.filter((d) => matches(d, query)).map((d) => d.id);
      state.downloads = state.downloads.filter((d) => !erased.includes(d.id));
      return erased;
    }
  };
}

// What survives when Chrome quits and starts again: local storage and history.
export function browserRestart(state) {
  for (const key of Object.keys(state.session)) delete state.session[key];
  state.tabs = [];
  return state;
}

export function createChrome(state = createState()) {
  const storageChanged = createEvent();
  const permissionsAdded = createEvent();
  const permissionsRemoved = createEvent();

  const chrome = {
    _state: state,
    storage: {
      local: createStorageArea(state.local, "local", storageChanged),
      session: createStorageArea(state.session, "session", storageChanged),
      onChanged: storageChanged
    },
    history: createHistory(state),
    tabs: {
      onCreated: createEvent(),
      onUpdated: createEvent(),
      onRemoved: createEvent(),
      onReplaced: createEvent(),
      async query() {
        return clone(state.tabs);
      },
      async create(props) {
        state.createdTabs.push(props);
        return { id: 9999, ...props };
      }
    },
    alarms: {
      onAlarm: createEvent(),
      async create(name, info) {
        const scheduledTime = info.when ?? Date.now() + (info.delayInMinutes ?? info.periodInMinutes ?? 0) * 60_000;
        state.alarms.set(name, { name, periodInMinutes: info.periodInMinutes, scheduledTime });
      },
      async get(name) {
        return clone(state.alarms.get(name));
      },
      async clear(name) {
        return state.alarms.delete(name);
      },
      async getAll() {
        return clone([...state.alarms.values()]);
      }
    },
    action: {
      setBadgeText: async ({ text }) => { state.badge.text = text; },
      setBadgeBackgroundColor: async ({ color }) => { state.badge.color = color; },
      setBadgeTextColor: async ({ color }) => { state.badge.textColor = color; },
      setTitle: async ({ title }) => { state.badge.title = title; },
      setIcon: async ({ path }) => { state.badge.icon = path; }
    },
    runtime: {
      id: "ghostbrowse-test",
      onStartup: createEvent(),
      onInstalled: createEvent(),
      onMessage: createEvent(),
      getURL: (path) => `chrome-extension://ghostbrowse-test/${path}`,
      getManifest: () => ({ version: state.version ?? "1.0.0" })
    },
    commands: {
      onCommand: createEvent(),
      async getAll() {
        return [
          { name: "clean-now", description: "Clean Now", shortcut: "Alt+Shift+D" },
          { name: "toggle-ghost", description: "Start or end a Ghost Session", shortcut: "Alt+Shift+G" }
        ];
      }
    },
    permissions: {
      onAdded: permissionsAdded,
      onRemoved: permissionsRemoved,
      async contains({ permissions }) {
        return permissions.every((p) => state.granted.has(p));
      }
    }
  };

  const attach = () => {
    if (state.granted.has("downloads")) chrome.downloads ??= createDownloads(state);
    if (state.granted.has("browsingData")) {
      chrome.browsingData ??= {
        async removeCache(options) {
          state.cacheClears.push(options);
        },
        async removeHistory({ since = 0 }) {
          for (const [url, e] of state.history) {
            e.visits = e.visits.filter((t) => t < since);
            if (e.visits.length === 0) state.history.delete(url);
          }
          dropClosedNavs(state, since, Infinity);
        }
      };
    }
  };
  attach();

  // Test helper: grant an optional permission the way chrome.permissions.request would.
  chrome.grant = async (permission) => {
    state.granted.add(permission);
    attach();
    await permissionsAdded.dispatch({ permissions: [permission] });
  };

  // Test helper: Chrome adds a closed tab to "Recently closed", then tells extensions.
  chrome.closeTab = async (tabId) => {
    const navs = state.tabNavs[tabId] ?? [];
    if (navs.length) state.closed.unshift({ navs: [...navs] });
    delete state.tabNavs[tabId];
    await chrome.tabs.onRemoved.dispatch(tabId, { windowId: 1, isWindowClosing: false });
  };
  chrome.recentlyClosed = () => state.closed.map((e) => e.navs[e.navs.length - 1].url);

  // Test helper: deliver a runtime message and wait for the async reply.
  chrome.send = (msg, sender = { id: chrome.runtime.id }) =>
    new Promise((resolve) => {
      const results = chrome.runtime.onMessage.listeners.map((fn) => fn(msg, sender, resolve));
      if (!results.includes(true)) resolve(undefined);
    });

  return chrome;
}
