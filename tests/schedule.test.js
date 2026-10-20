import { describe, it, expect } from "vitest";
import { parseTime, normalizeSchedule, activeWindow, nextWindow, nextChange } from "../lib/schedule.js";

// Local times, so the tests hold in any time zone.
const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime();
// 2026-10-19 is a Monday.
const MON = (h, min) => at(2026, 10, 19, h, min);
const work = { enabled: true, days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };

describe("parseTime", () => {
  it("reads HH:MM", () => {
    expect(parseTime("00:00")).toBe(0);
    expect(parseTime("09:30")).toBe(570);
    expect(parseTime("23:59")).toBe(1439);
  });
  it.each(["24:00", "9:30", "09:60", "", null, "ab:cd"])("rejects %j", (v) => {
    expect(parseTime(v)).toBeNull();
  });
});

describe("normalizeSchedule", () => {
  it("cleans days and keeps valid times", () => {
    expect(normalizeSchedule({ enabled: true, days: [5, 1, 1, 9, "2"], start: "09:00", end: "17:00" }))
      .toEqual({ enabled: true, days: [1, 5], start: "09:00", end: "17:00" });
  });
  it("rejects equal or invalid times", () => {
    expect(normalizeSchedule({ enabled: true, days: [1], start: "09:00", end: "09:00" })).toBeNull();
    expect(normalizeSchedule({ enabled: true, days: [1], start: "9", end: "17:00" })).toBeNull();
    expect(normalizeSchedule(null)).toBeNull();
  });
});

describe("activeWindow", () => {
  it("is active inside working hours on a working day", () => {
    expect(activeWindow(work, MON(10))).toEqual({ start: MON(9), end: MON(17) });
  });

  it("includes the start minute and excludes the end minute", () => {
    expect(activeWindow(work, MON(9))).not.toBeNull();
    expect(activeWindow(work, MON(17))).toBeNull();
  });

  it("is inactive outside hours, on other days, or when switched off", () => {
    expect(activeWindow(work, MON(8, 59))).toBeNull();
    expect(activeWindow(work, at(2026, 10, 18, 10))).toBeNull();          // Sunday
    expect(activeWindow({ ...work, enabled: false }, MON(10))).toBeNull();
    expect(activeWindow({ ...work, days: [] }, MON(10))).toBeNull();
  });

  it("handles overnight windows that run into the next day", () => {
    const night = { enabled: true, days: [1], start: "22:00", end: "06:00" };
    expect(activeWindow(night, MON(23))).toEqual({ start: MON(22), end: at(2026, 10, 20, 6) });
    expect(activeWindow(night, at(2026, 10, 20, 5))).toEqual({ start: MON(22), end: at(2026, 10, 20, 6) });
    expect(activeWindow(night, at(2026, 10, 20, 6))).toBeNull();
    expect(activeWindow(night, at(2026, 10, 20, 23))).toBeNull();          // Tuesday night not scheduled
  });
});

describe("nextWindow / nextChange", () => {
  it("finds the next start", () => {
    expect(nextWindow(work, MON(18))).toEqual({ start: at(2026, 10, 20, 9), end: at(2026, 10, 20, 17) });
  });

  it("skips the weekend", () => {
    const friEvening = at(2026, 10, 23, 18);
    expect(nextWindow(work, friEvening).start).toBe(at(2026, 10, 26, 9));   // Monday
  });

  it("next change is the end while active, the start while inactive", () => {
    expect(nextChange(work, MON(10))).toBe(MON(17));
    expect(nextChange(work, MON(7))).toBe(MON(9));
  });

  it("is null when the schedule is off", () => {
    expect(nextChange({ ...work, enabled: false }, MON(10))).toBeNull();
    expect(nextWindow({ ...work, days: [] }, MON(10))).toBeNull();
  });
});
