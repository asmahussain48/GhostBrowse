// Rule profiles: named sets of rules (rule mode, Keep/Hide lists, keywords),
// such as "Study" and "Personal", that can be switched from the popup.
//
// The live rules always stay in the usual top-level settings keys, so the rest
// of the extension never needs to know about profiles. The `profiles` array
// holds a snapshot of each profile; the active one is refreshed from the live
// rules whenever profiles are changed.

export const RULE_KEYS = ["ruleMode", "keepList", "hideList", "keywords"];
export const MAX_PROFILES = 10;
const MAX_NAME = 30;

export function normalizeProfileName(name) {
  return typeof name === "string" ? name.trim().replace(/\s+/g, " ").slice(0, MAX_NAME) : "";
}

export function rulesOf(s) {
  return {
    ruleMode: s.ruleMode,
    keepList: [...(s.keepList ?? [])],
    hideList: [...(s.hideList ?? [])],
    keywords: [...(s.keywords ?? [])]
  };
}

// Profiles with the active one updated to the current live rules.
function snapshot(s) {
  return (s.profiles ?? []).map((p) => (p.id === s.activeProfile ? { ...p, ...rulesOf(s) } : p));
}

function checkName(s, name, exceptId = null) {
  const clean = normalizeProfileName(name);
  if (!clean) throw new Error("profileNameEmpty");
  const taken = (s.profiles ?? []).some((p) => p.id !== exceptId && p.name.toLowerCase() === clean.toLowerCase());
  if (taken) throw new Error("profileNameTaken");
  return clean;
}

// Saves the current rules as a new profile and makes it active.
export function createProfile(s, name, id = crypto.randomUUID()) {
  const clean = checkName(s, name);
  if ((s.profiles ?? []).length >= MAX_PROFILES) throw new Error("profileLimit");
  return { profiles: [...snapshot(s), { id, name: clean, ...rulesOf(s) }], activeProfile: id };
}

// Switches the live rules to another profile, saving the current one first.
export function switchProfile(s, id) {
  const profiles = snapshot(s);
  const target = profiles.find((p) => p.id === id);
  if (!target) throw new Error("profileMissing");
  return { profiles, activeProfile: id, ...rulesOf(target) };
}

export function renameProfile(s, id, name) {
  const clean = checkName(s, name, id);
  return { profiles: snapshot(s).map((p) => (p.id === id ? { ...p, name: clean } : p)) };
}

// Deletes a profile. The live rules stay as they are; deleting the active
// profile just leaves them unassigned to any profile.
export function deleteProfile(s, id) {
  const profiles = snapshot(s).filter((p) => p.id !== id);
  return { profiles, activeProfile: s.activeProfile === id ? null : s.activeProfile };
}
