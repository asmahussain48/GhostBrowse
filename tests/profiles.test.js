import { describe, it, expect } from "vitest";
import { createProfile, switchProfile, renameProfile, deleteProfile, normalizeProfileName, MAX_PROFILES } from "../lib/profiles.js";

const live = (patch = {}) => ({
  ruleMode: "hideAll",
  keepList: ["university.edu"],
  hideList: [],
  keywords: [],
  profiles: [],
  activeProfile: null,
  ...patch
});
const apply = (s, patch) => ({ ...s, ...patch });

describe("profiles", () => {
  it("saves the current rules as a new active profile", () => {
    const patch = createProfile(live(), "  Study  ", "p1");
    expect(patch).toEqual({
      activeProfile: "p1",
      profiles: [{ id: "p1", name: "Study", ruleMode: "hideAll", keepList: ["university.edu"], hideList: [], keywords: [] }]
    });
  });

  it("switching saves the edits made to the active profile and loads the other one", () => {
    let s = apply(live(), createProfile(live(), "Study", "study"));
    // Personal starts as a copy, then gets its own rules.
    s = apply(s, createProfile(s, "Personal", "personal"));
    s = apply(s, { keepList: [], ruleMode: "hideAll" });

    s = apply(s, switchProfile(s, "study"));
    expect(s.activeProfile).toBe("study");
    expect(s.keepList).toEqual(["university.edu"]);

    s = apply(s, switchProfile(s, "personal"));
    expect(s.keepList).toEqual([]);   // the edit made while Personal was active was kept
  });

  it("switching gives independent copies, not shared arrays", () => {
    let s = apply(live(), createProfile(live(), "Study", "study"));
    s = apply(s, switchProfile(s, "study"));
    s.keepList.push("changed.com");
    expect(s.profiles[0].keepList).toEqual(["university.edu"]);
  });

  it("rejects empty and duplicate names, ignoring case", () => {
    const s = apply(live(), createProfile(live(), "Study", "study"));
    expect(() => createProfile(s, "   ", "x")).toThrow("profileNameEmpty");
    expect(() => createProfile(s, "study", "x")).toThrow("profileNameTaken");
    expect(() => renameProfile(s, "study", "STUDY")).not.toThrow();   // its own name
  });

  it("limits the number of profiles", () => {
    let s = live();
    for (let i = 0; i < MAX_PROFILES; i++) s = apply(s, createProfile(s, `P${i}`, `p${i}`));
    expect(() => createProfile(s, "One more", "x")).toThrow("profileLimit");
  });

  it("renames", () => {
    const s = apply(live(), createProfile(live(), "Study", "study"));
    expect(renameProfile(s, "study", "Uni").profiles[0].name).toBe("Uni");
  });

  it("deleting the active profile keeps the live rules", () => {
    let s = apply(live(), createProfile(live(), "Study", "study"));
    s = apply(s, deleteProfile(s, "study"));
    expect(s.profiles).toEqual([]);
    expect(s.activeProfile).toBeNull();
    expect(s.keepList).toEqual(["university.edu"]);
  });

  it("refuses to switch to a missing profile", () => {
    expect(() => switchProfile(live(), "nope")).toThrow("profileMissing");
  });

  it("trims and caps names", () => {
    expect(normalizeProfileName("  Work   PC ")).toBe("Work PC");
    expect(normalizeProfileName("x".repeat(50))).toHaveLength(30);
    expect(normalizeProfileName(5)).toBe("");
  });
});
