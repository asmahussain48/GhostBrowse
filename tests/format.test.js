import { describe, it, expect } from "vitest";
import { relativeTime, rulesSummary, formatDuration, cleanupSummary } from "../lib/format.js";
import { tn } from "../lib/i18n.js";
import { statsForToday, todayKey } from "../lib/settings.js";

describe("format helpers", () => {
  it("pluralizes", () => {
    expect(tn(1, "countSites")).toBe("1 site");
    expect(tn(3, "countSites")).toBe("3 sites");
    expect(tn(2, "sumRemoved")).toBe("Removed 2 entries.");
  });

  it("shows relative times", () => {
    const now = Date.UTC(2026, 8, 28, 12, 0, 0);
    expect(relativeTime(0, now)).toBe("Never");
    expect(relativeTime(now - 10_000, now)).toBe("just now");
    expect(relativeTime(now - 2 * 60_000, now)).toBe("2 min ago");
    expect(relativeTime(now - 3 * 3600_000, now)).toBe("3 h ago");
    expect(relativeTime(now - 24 * 3600_000, now)).toBe("yesterday");
    expect(relativeTime(now - 3 * 86400_000, now)).toBe("3 days ago");
  });

  it("summarizes rules like the popup layout", () => {
    const s = { ruleMode: "hideAll", keepList: ["a.com", "b.com", "c.com"], hideList: [] };
    expect(rulesSummary(s)).toBe("Hide all except 3");
    expect(rulesSummary({ ...s, keepList: [] })).toBe("Hide everything");
    expect(rulesSummary({ ...s, ruleMode: "hideListed", hideList: ["y.com"] })).toBe("Hide only 1 site");
    expect(rulesSummary({ ...s, ruleMode: "hideListed" })).toBe("Hide list is empty");
    expect(rulesSummary({ ...s, ruleMode: "hideListed", hideList: ["y.com"], keywords: ["salary", "medical"] }))
      .toBe("Hide only 1 site + 2 keywords");
    expect(rulesSummary({ ...s, ruleMode: "hideListed", keywords: ["salary"] })).toBe("Hide only 1 keyword");
  });

  it("formats lockout durations", () => {
    expect(formatDuration(30_000)).toBe("30 s");
    expect(formatDuration(1_500)).toBe("2 s");
    expect(formatDuration(120_000)).toBe("2 min");
  });
});

describe("cleanupSummary", () => {
  const s = { enabled: true, mode: "onTabClose", ruleMode: "hideAll", ghostSession: null };

  it("reports removals and what stayed", () => {
    expect(cleanupSummary({ removed: 3, kept: 0, skipped: 0 }, s)).toBe("Removed 3 entries.");
    expect(cleanupSummary({ removed: 1, kept: 2, skipped: 0 }, s)).toBe("Removed 1 entry. 2 pages on your Keep list stay.");
  });

  it("explains an empty result in Immediate mode (the popup case)", () => {
    expect(cleanupSummary({ removed: 0, kept: 1, skipped: 0 }, { ...s, mode: "immediate" })).toBe(
      "Nothing to remove: pages are already removed as you visit them. 1 page on your Keep list stays."
    );
  });

  it("explains an empty result in other modes", () => {
    expect(cleanupSummary({ removed: 0, kept: 0, skipped: 0 }, s)).toBe("Nothing to remove: this time range is already clean.");
    expect(cleanupSummary({ removed: 0, kept: 3, skipped: 1 }, { ...s, ruleMode: "hideListed" })).toBe(
      "Nothing to remove. 3 pages not on your Hide list stay. 1 file or browser page is never removed."
    );
  });

  it("names the Keep list during a Ghost Session, whatever the rule mode", () => {
    expect(cleanupSummary({ removed: 0, kept: 1, skipped: 0 }, { ...s, ruleMode: "hideListed", ghostSession: { start: 1 } })).toBe(
      "Nothing to remove: pages are already removed as you visit them. 1 page on your Keep list stays."
    );
  });
});

describe("statsForToday", () => {
  it("returns today's count only when it is from today", () => {
    const today = new Date(2026, 8, 28);
    const yesterday = new Date(2026, 8, 27);
    expect(statsForToday({ today: 5, total: 50, day: todayKey(today) }, today)).toEqual({ today: 5, total: 50 });
    expect(statsForToday({ today: 5, total: 50, day: todayKey(yesterday) }, today)).toEqual({ today: 0, total: 50 });
  });
});
