// Settings and counters, stored locally in chrome.storage.local.
// chrome.storage.local.get(DEFAULTS) fills in any value that has not been saved yet.

import { DEFAULT_SCHEDULE } from "./schedule.js";

export const DEFAULTS = {
  enabled: true,
  mode: "onTabClose",        // "immediate" | "onTabClose" | "interval" | "onStartup"
  intervalMin: 10,
  ruleMode: "hideAll",       // "hideAll" | "hideListed"
  keepList: [],
  hideList: [],
  keywords: [],              // hide any URL containing these (used with "hideListed")
  ghostSession: null,        // { start, scheduled?, until? } or null
  ghostSchedule: DEFAULT_SCHEDULE,
  ghostSkipUntil: 0,         // a scheduled session ended by hand stays off until then
  profiles: [],              // [{ id, name, ruleMode, keepList, hideList, keywords }]
  activeProfile: null,
  language: "auto",          // "auto" | "en" | "ur"
  lastCleanup: 0,            // cursor: history before this time has already been swept
  lastActivity: 0,           // shown as "Last cleanup" in the popup
  stats: { today: 0, total: 0, day: "" },
  cleanDownloads: false,
  cleanCache: false,
  cleanRecentlyClosed: false, // Immediate mode / Ghost Session: also clear Chrome's "Recently closed"
  pinHash: null,
  pinSalt: null
};

// Cleanup modes and the message keys for their names.
export const MODES = {
  immediate: "modeImmediate",
  onTabClose: "modeOnTabClose",
  interval: "modeInterval",
  onStartup: "modeOnStartup"
};

export const INTERVALS = [1, 5, 10, 30];

export async function getSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}

export function todayKey(date = new Date()) {
  return date.toDateString();
}

// Counters roll over at local midnight; a stale "today" value reads as 0.
export function statsForToday(stats, date = new Date()) {
  const s = stats || DEFAULTS.stats;
  return { today: s.day === todayKey(date) ? s.today : 0, total: s.total || 0 };
}
