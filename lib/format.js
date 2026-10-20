// Display helpers shared by the popup, options page and service worker.

import { t, tn, formatNumber, locale } from "./i18n.js";

export function relativeTime(ts, now = Date.now()) {
  if (!ts) return t("timeNever");
  const sec = Math.round((now - ts) / 1000);
  if (sec < 45) return t("timeJustNow");
  const min = Math.round(sec / 60);
  if (min < 60) return tn(min, "timeMinutesAgo");
  const hours = Math.round(min / 60);
  if (hours < 24) return tn(hours, "timeHoursAgo");
  const days = Math.round(hours / 24);
  if (days === 1) return t("timeYesterday");
  if (days < 7) return tn(days, "timeDaysAgo");
  return new Date(ts).toLocaleDateString(locale());
}

export function formatTime(ts) {
  return new Date(ts).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
}

export function rulesSummary(s) {
  if (s.ruleMode === "hideListed") {
    const parts = [];
    if (s.hideList.length) parts.push(tn(s.hideList.length, "countSites"));
    if (s.keywords?.length) parts.push(tn(s.keywords.length, "countKeywords"));
    if (parts.length === 0) return t("rulesHideListEmpty");
    return t("rulesHideOnly", parts.length === 2 ? t("joinPlus", parts[0], parts[1]) : parts[0]);
  }
  return s.keepList.length ? t("rulesHideAllExcept", formatNumber(s.keepList.length)) : t("rulesHideEverything");
}

// Describes a cleanup result, including why anything was left in history,
// so "Nothing to remove" never looks like a failure.
export function cleanupSummary({ removed = 0, kept = 0, skipped = 0 }, s) {
  const parts = [];
  if (removed) {
    parts.push(tn(removed, "sumRemoved"));
  } else if (s.ghostSession || (s.enabled && s.mode === "immediate")) {
    parts.push(t("sumNothingAuto"));
  } else if (!kept && !skipped) {
    parts.push(t("sumNothingClean"));
  } else {
    parts.push(t("sumNothing"));
  }
  if (kept) parts.push(tn(kept, s.ruleMode === "hideListed" && !s.ghostSession ? "sumKeptHide" : "sumKeptKeep"));
  if (skipped) parts.push(tn(skipped, "sumSkipped"));
  return parts.join(" ");
}

export function formatDuration(ms) {
  const sec = Math.ceil(ms / 1000);
  return sec < 60 ? t("durSeconds", formatNumber(sec)) : t("durMinutes", formatNumber(Math.ceil(sec / 60)));
}
