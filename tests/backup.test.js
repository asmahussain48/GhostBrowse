import { describe, it, expect } from "vitest";
import { createBackup, backupFileName, readBackup, BACKUP_FORMAT } from "../lib/backup.js";
import { DEFAULTS } from "../lib/settings.js";

const current = {
  ...DEFAULTS,
  mode: "interval",
  intervalMin: 5,
  ruleMode: "hideListed",
  keepList: ["github.com"],
  hideList: ["youtube.com"],
  keywords: ["salary"],
  pinHash: "a".repeat(64),
  pinSalt: "salt",
  stats: { today: 4, total: 99, day: "x" },
  lastCleanup: 123,
  ghostSession: { start: 1 }
};

const file = (settings, extra = {}) => JSON.stringify({ format: BACKUP_FORMAT, version: 1, settings, ...extra });

describe("createBackup", () => {
  it("includes settings, lists and keywords", () => {
    const backup = createBackup(current, new Date("2026-09-29T10:00:00Z"));
    expect(backup).toEqual({
      format: "ghostbrowse-settings",
      version: 1,
      exportedAt: "2026-09-29T10:00:00.000Z",
      settings: {
        enabled: true,
        mode: "interval",
        intervalMin: 5,
        ruleMode: "hideListed",
        keepList: ["github.com"],
        hideList: ["youtube.com"],
        keywords: ["salary"],
        cleanDownloads: false,
        cleanCache: false,
        ghostSchedule: DEFAULTS.ghostSchedule,
        profiles: [],
        activeProfile: null,
        language: "auto"
      }
    });
  });

  it("never includes the PIN, statistics, cursor or Ghost Session", () => {
    const text = JSON.stringify(createBackup(current));
    for (const secret of ["pinHash", "pinSalt", "aaaa", "stats", "lastCleanup", "ghostSession"]) {
      expect(text).not.toContain(secret);
    }
  });

  it("round-trips through readBackup", () => {
    const { patch, notes } = readBackup(JSON.stringify(createBackup(current)));
    expect(notes).toEqual([]);
    expect(patch).toEqual(createBackup(current).settings);
  });

  it("names files by date", () => {
    expect(backupFileName(new Date(2026, 8, 5))).toBe("ghostbrowse-settings-2026-09-05.json");
  });
});

describe("readBackup", () => {
  it.each([
    ["not JSON", "{oops", "not valid JSON"],
    ["another app's file", JSON.stringify({ format: "other", settings: {} }), "not a GhostBrowse settings file"],
    ["settings missing", JSON.stringify({ format: BACKUP_FORMAT, version: 1 }), "not a GhostBrowse settings file"],
    ["a newer version", file({ mode: "immediate" }, { version: 2 }), "newer version"],
    ["nothing usable", file({ mode: "sometimes", enabled: "yes" }), "does not contain any settings"],
    ["a huge file", "x".repeat(1_000_001), "too large"]
  ])("rejects %s", (_name, text, message) => {
    expect(() => readBackup(text)).toThrow(message);
  });

  it("normalizes lists and reports skipped entries", () => {
    const { patch, notes } = readBackup(file({
      keepList: ["https://www.GitHub.com/x", "gmail.com", "not a domain", 42, "gmail.com"],
      hideList: [],
      keywords: ["Job Search", "ab", "salary"]
    }));
    expect(patch).toEqual({ keepList: ["github.com", "gmail.com"], hideList: [], keywords: ["job search", "salary"] });
    expect(notes).toEqual([
      "Skipped 2 invalid sites from the Keep list.",
      "Skipped 1 invalid keyword from the keyword list."
    ]);
  });

  it("drops values of the wrong type or outside the allowed choices", () => {
    const { patch } = readBackup(file({
      enabled: false,
      mode: "toString",          // inherited object key, not a real mode
      intervalMin: 7,
      ruleMode: "hideListed",
      cleanDownloads: "true"
    }));
    expect(patch).toEqual({ enabled: false, ruleMode: "hideListed" });
  });

  it("saves the active profile with the current live rules", () => {
    const s = {
      ...current,
      keepList: ["edited.com"],
      profiles: [
        { id: "study", name: "Study", ruleMode: "hideAll", keepList: ["old.com"], hideList: [], keywords: [] },
        { id: "home", name: "Home", ruleMode: "hideAll", keepList: [], hideList: [], keywords: [] }
      ],
      activeProfile: "study"
    };
    const { settings } = createBackup(s);
    expect(settings.profiles[0].keepList).toEqual(["edited.com"]);
    expect(settings.profiles[1].keepList).toEqual([]);
  });

  it("validates profiles: names, duplicates, ids, rules and the active one", () => {
    const { patch, notes } = readBackup(file({
      profiles: [
        { id: "study", name: " Study ", ruleMode: "weird", keepList: ["https://www.Uni.edu", "bad entry"], keywords: ["ab", "exam"] },
        { id: "dup", name: "study" },                       // same name, ignoring case
        { id: "", name: "" },                               // no usable name
        { id: "<script>", name: "Home", ruleMode: "hideListed", hideList: ["youtube.com"] }
      ],
      activeProfile: "study"
    }));
    expect(patch.profiles).toHaveLength(2);
    expect(patch.profiles[0]).toEqual({ id: "study", name: "Study", ruleMode: "hideAll", keepList: ["uni.edu"], hideList: [], keywords: ["exam"] });
    expect(patch.profiles[1]).toMatchObject({ name: "Home", ruleMode: "hideListed", hideList: ["youtube.com"] });
    expect(patch.profiles[1].id).toMatch(/^[\w-]+$/);   // unsafe id replaced
    expect(patch.activeProfile).toBe("study");
    expect(notes).toEqual(["Skipped 2 profiles without a usable name."]);
  });

  it("drops an active profile that is not in the file", () => {
    const { patch } = readBackup(file({ profiles: [{ id: "a", name: "A" }], activeProfile: "missing" }));
    expect(patch.activeProfile).toBeNull();
  });

  it("imports a valid schedule and keeps the current one if it is broken", () => {
    expect(readBackup(file({ ghostSchedule: { enabled: true, days: [1, 2], start: "08:00", end: "12:00" } })).patch.ghostSchedule)
      .toEqual({ enabled: true, days: [1, 2], start: "08:00", end: "12:00" });
    const broken = readBackup(file({ mode: "immediate", ghostSchedule: { enabled: true, days: [1], start: "25:00", end: "12:00" } }));
    expect(broken.patch.ghostSchedule).toBeUndefined();
    expect(broken.notes).toEqual(["The schedule in the file was not valid, so your current schedule was kept."]);
  });

  it("imports the language setting only if it is known", () => {
    expect(readBackup(file({ language: "ur" })).patch.language).toBe("ur");
    expect(readBackup(file({ mode: "immediate", language: "xx" })).patch.language).toBeUndefined();
  });

  it("ignores unknown keys such as a PIN hash", () => {
    const { patch } = readBackup(file({ mode: "immediate", pinHash: "b".repeat(64), stats: { total: 1e9 } }));
    expect(patch).toEqual({ mode: "immediate" });
  });
});
