// Settings export/import. The file holds settings, lists, keywords, profiles and
// the schedule only: never the PIN hash, statistics, or anything about history.

import { MODES, INTERVALS } from "./settings.js";
import { normalizeDomain, normalizeKeyword } from "./rules.js";
import { normalizeSchedule } from "./schedule.js";
import { normalizeProfileName, rulesOf, MAX_PROFILES } from "./profiles.js";
import { LANGUAGES, t, tn } from "./i18n.js";

export const BACKUP_FORMAT = "ghostbrowse-settings";
export const BACKUP_VERSION = 1;
const MAX_FILE_BYTES = 1_000_000;

const EXPORTED = [
  "enabled", "mode", "intervalMin", "ruleMode", "keepList", "hideList", "keywords",
  "cleanDownloads", "cleanCache", "cleanRecentlyClosed", "ghostSchedule", "profiles", "activeProfile", "language"
];
const LISTS = {
  keepList: { normalize: normalizeDomain, note: "noteSkippedKeep" },
  hideList: { normalize: normalizeDomain, note: "noteSkippedHide" },
  keywords: { normalize: normalizeKeyword, note: "noteSkippedKeywords" }
};
const RULE_MODES = ["hideAll", "hideListed"];

export function createBackup(s, now = new Date()) {
  const settings = {};
  for (const key of EXPORTED) settings[key] = structuredClone(s[key]);
  // The active profile is saved with the rules as they are right now.
  settings.profiles = (settings.profiles ?? []).map((p) => (p.id === s.activeProfile ? { ...p, ...rulesOf(s) } : p));
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: now.toISOString(), settings };
}

export function backupFileName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `ghostbrowse-settings-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

// Normalizes one list; returns { values, skipped }.
function cleanList(list, normalize) {
  const values = [];
  let skipped = 0;
  for (const entry of Array.isArray(list) ? list : []) {
    const v = normalize(entry);
    if (!v) skipped++;
    else if (!values.includes(v)) values.push(v);
  }
  return { values: values.sort(), skipped };
}

function cleanProfiles(list) {
  const profiles = [];
  let skipped = 0;
  for (const p of Array.isArray(list) ? list : []) {
    const name = normalizeProfileName(p?.name);
    const taken = profiles.some((q) => q.name.toLowerCase() === name.toLowerCase());
    if (!name || taken || profiles.length >= MAX_PROFILES) {
      skipped++;
      continue;
    }
    const id = typeof p.id === "string" && /^[\w-]{1,64}$/.test(p.id) && !profiles.some((q) => q.id === p.id)
      ? p.id
      : crypto.randomUUID();
    profiles.push({
      id,
      name,
      ruleMode: RULE_MODES.includes(p.ruleMode) ? p.ruleMode : "hideAll",
      keepList: cleanList(p.keepList, normalizeDomain).values,
      hideList: cleanList(p.hideList, normalizeDomain).values,
      keywords: cleanList(p.keywords, normalizeKeyword).values
    });
  }
  return { profiles, skipped };
}

// Validates a settings file and returns { patch, notes }. Every value is checked
// and normalized; anything unusable is dropped with a note. Throws an Error with
// a message meant for the user when the file cannot be used at all.
export function readBackup(text) {
  if (typeof text !== "string" || text.length > MAX_FILE_BYTES) throw new Error(t("backupTooLarge"));
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t("backupNotJson"));
  }
  if (data?.format !== BACKUP_FORMAT || typeof data.settings !== "object" || data.settings === null) {
    throw new Error(t("backupNotOurs"));
  }
  if (!Number.isInteger(data.version) || data.version > BACKUP_VERSION) throw new Error(t("backupNewer"));

  const src = data.settings;
  const patch = {};
  const notes = [];

  for (const key of ["enabled", "cleanDownloads", "cleanCache", "cleanRecentlyClosed"]) {
    if (typeof src[key] === "boolean") patch[key] = src[key];
  }
  if (typeof src.mode === "string" && Object.hasOwn(MODES, src.mode)) patch.mode = src.mode;
  if (INTERVALS.includes(src.intervalMin)) patch.intervalMin = src.intervalMin;
  if (RULE_MODES.includes(src.ruleMode)) patch.ruleMode = src.ruleMode;
  if (src.language === "auto" || (typeof src.language === "string" && Object.hasOwn(LANGUAGES, src.language))) {
    patch.language = src.language;
  }

  for (const [key, { normalize, note }] of Object.entries(LISTS)) {
    if (!Array.isArray(src[key])) continue;
    const { values, skipped } = cleanList(src[key], normalize);
    patch[key] = values;
    if (skipped) notes.push(tn(skipped, note));
  }

  if ("ghostSchedule" in src) {
    const schedule = normalizeSchedule(src.ghostSchedule);
    if (schedule) patch.ghostSchedule = schedule;
    else notes.push(t("noteBadSchedule"));
  }

  if (Array.isArray(src.profiles)) {
    const { profiles, skipped } = cleanProfiles(src.profiles);
    patch.profiles = profiles;
    patch.activeProfile = profiles.some((p) => p.id === src.activeProfile) ? src.activeProfile : null;
    if (skipped) notes.push(tn(skipped, "noteSkippedProfiles"));
  }

  if (Object.keys(patch).length === 0) throw new Error(t("backupEmpty"));
  return { patch, notes };
}
