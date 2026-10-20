import { DEFAULTS, getSettings, saveSettings, MODES, INTERVALS, statsForToday } from "../lib/settings.js";
import { parseDomainList, parseKeywordList } from "../lib/rules.js";
import { createBackup, backupFileName, readBackup } from "../lib/backup.js";
import { PIN_PATTERN, setPin, clearPin, tryUnlock, lockoutRemaining } from "../lib/pin.js";
import { relativeTime, formatDuration, formatTime, rulesSummary } from "../lib/format.js";
import { createProfile, switchProfile, renameProfile, deleteProfile } from "../lib/profiles.js";
import { normalizeSchedule, activeWindow, nextWindow } from "../lib/schedule.js";
import { initI18n, localizePage, language, locale, LANGUAGES, formatNumber, t, tn } from "../lib/i18n.js";

const $ = (id) => document.getElementById(id);

const MODE_HINTS = {
  immediate: "modeHintImmediate",
  onTabClose: "modeHintOnTabClose",
  interval: "modeHintInterval",
  onStartup: "modeHintOnStartup"
};
const LISTS = {
  keepList: { parse: parseDomainList, count: "countSites", added: "toastAddedSites", invalid: "invalidSites", sep: " " },
  hideList: { parse: parseDomainList, count: "countSites", added: "toastAddedSites", invalid: "invalidSites", sep: " " },
  keywords: { parse: parseKeywordList, count: "countKeywords", added: "toastAddedKeywords", invalid: "invalidKeywords", sep: ", " }
};
const LIST_NAMES = { keepList: "keepTitle", hideList: "hideTitle", keywords: "keywordsTitle" };
const EXTRAS = { cleanDownloads: "downloads", cleanCache: "browsingData", cleanRecentlyClosed: "browsingData" };
const EXTRA_NOTES = { cleanDownloads: "noteDownloadsOff", cleanCache: "noteCacheOff", cleanRecentlyClosed: "noteRecentOff" };
const WEEK = [1, 2, 3, 4, 5, 6, 0];   // Monday first

let settings = null;

const helpPage = () => (language() === "ur" ? "../help/help.ur.html" : "../help/help.html");
const weekday = (day, style = "short") =>
  new Intl.DateTimeFormat(locale(), { weekday: style }).format(new Date(2026, 9, 18 + day));   // 2026-10-18 is a Sunday

// ---------- Saving ----------
let toastTimer = 0;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

async function save(patch, message = t("saved")) {
  Object.assign(settings, patch);
  await saveSettings(patch);
  renderKeys(Object.keys(patch));
  toast(message);
}

function setMessage(el, text, kind = "") {
  el.textContent = text;
  el.className = "field-msg " + kind;
}

// ---------- Rendering ----------
function renderGeneral() {
  $("enabled").checked = settings.enabled;
  for (const input of document.querySelectorAll('input[name="mode"]')) {
    input.checked = input.value === settings.mode;
  }
  $("intervalField").hidden = settings.mode !== "interval";
  $("intervalMin").value = String(settings.intervalMin);
}

function renderRules() {
  for (const input of document.querySelectorAll('input[name="ruleMode"]')) {
    input.checked = input.value === settings.ruleMode;
  }
  for (const key of Object.keys(LISTS)) renderList(key);
  const active = settings.ruleMode === "hideListed";
  for (const [key, note] of Object.entries({ hideList: "hideSub", keywords: "keywordsSub" })) {
    const editor = document.querySelector(`[data-list="${key}"]`);
    editor.classList.toggle("inactive", !active);
    editor.querySelector("[data-note]").textContent = active ? t(note) : t("listInactive");
  }
  renderProfiles();
}

function renderList(key) {
  const editor = document.querySelector(`[data-list="${key}"]`);
  const items = settings[key];
  const ul = editor.querySelector("[data-items]");
  ul.replaceChildren(...items.map((value) => {
    const li = document.createElement("li");
    li.className = "chip";
    const label = document.createElement("span");
    label.textContent = value;
    label.title = value;
    if (key !== "keywords") label.dir = "ltr";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", t("removeFrom", value, t(LIST_NAMES[key])));
    remove.addEventListener("click", () =>
      save({ [key]: settings[key].filter((d) => d !== value) }, t("removedItem", value)));
    li.append(label, remove);
    return li;
  }));
  editor.querySelector("[data-count]").textContent = items.length ? tn(items.length, LISTS[key].count) : "";
  editor.querySelector("[data-empty]").hidden = items.length > 0;
}

function renderProfiles() {
  const profiles = settings.profiles ?? [];
  const has = profiles.length > 0;
  const activeKnown = profiles.some((p) => p.id === settings.activeProfile);
  $("profilePicker").hidden = !has;
  $("profileRename").hidden = !activeKnown;
  $("profileDelete").hidden = !activeKnown;
  $("profileNew").disabled = profiles.length >= 10;
  if (has) {
    const options = profiles.map((p) => new Option(p.name, p.id));
    if (!activeKnown) {
      const unsaved = new Option(t("profileUnsaved"), "");
      unsaved.disabled = true;
      options.unshift(unsaved);
    }
    $("profileSelect").replaceChildren(...options);
    $("profileSelect").value = settings.activeProfile ?? "";
  }
  $("profileHint").textContent = has ? t("profileHintSome") : t("profileHintNone");
}

function renderSchedule() {
  const s = settings.ghostSchedule ?? DEFAULTS.ghostSchedule;
  $("schedEnabled").checked = s.enabled;
  $("schedFields").classList.toggle("inactive", !s.enabled);
  for (const box of document.querySelectorAll('#schedDays input')) box.checked = s.days.includes(Number(box.value));
  if (document.activeElement !== $("schedStart")) $("schedStart").value = s.start;
  if (document.activeElement !== $("schedEnd")) $("schedEnd").value = s.end;

  let status = t("schedOff");
  if (s.enabled) {
    const now = Date.now();
    const win = activeWindow(s, now);
    const next = nextWindow(s, now);
    if (win) status = t("schedActive", formatTime(win.end));
    else if (next) status = t("schedNext", weekday(new Date(next.start).getDay(), "long"), formatTime(next.start), formatTime(next.end));
    else status = t("schedNoDays");
  }
  $("schedStatus").textContent = status;
}

async function renderExtras() {
  for (const [key, permission] of Object.entries(EXTRAS)) {
    // A permission revoked in chrome://extensions shows the feature as off.
    const granted = await chrome.permissions.contains({ permissions: [permission] });
    $(key).checked = Boolean(settings[key]) && granted;
  }
}

function renderSecurity() {
  const set = Boolean(settings.pinHash);
  $("pinStatus").textContent = set ? t("pinIsSet") : t("pinNotSet");
  $("pinSetOpen").textContent = set ? t("pinChange") : t("pinSet");
  $("pinRemove").hidden = !set;
}

function renderStats() {
  const { today, total } = statsForToday(settings.stats);
  $("statToday").textContent = formatNumber(today);
  $("statTotal").textContent = formatNumber(total);
  $("statLast").textContent = relativeTime(Math.max(settings.lastActivity, settings.lastCleanup));
}

const SECTIONS = [
  [["enabled", "mode", "intervalMin"], renderGeneral],
  [["ruleMode", "keepList", "hideList", "keywords", "profiles", "activeProfile"], renderRules],
  [["ghostSchedule", "ghostSession"], renderSchedule],
  [["cleanDownloads", "cleanCache", "cleanRecentlyClosed"], renderExtras],
  [["pinHash"], renderSecurity],
  [["stats", "lastCleanup", "lastActivity"], renderStats]
];

function renderKeys(keys) {
  for (const [sectionKeys, render] of SECTIONS) {
    if (keys.some((k) => sectionKeys.includes(k))) render();
  }
}

function renderAll() {
  for (const [, render] of SECTIONS) render();
}

// ---------- Building (once, after unlock) ----------
function buildGeneral() {
  const fieldset = $("modeChoices");
  for (const [value, key] of Object.entries(MODES)) {
    const choice = document.createElement("label");
    choice.className = "choice";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "mode";
    input.value = value;
    input.addEventListener("change", () => save({ mode: value }));
    const text = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = t(key);
    const small = document.createElement("small");
    small.textContent = t(MODE_HINTS[value]);
    text.append(strong, small);
    choice.append(input, text);
    fieldset.append(choice);
  }

  const interval = $("intervalMin");
  for (const min of INTERVALS) interval.add(new Option(tn(min, "countMinutes"), String(min)));
  interval.addEventListener("change", () => save({ intervalMin: Number(interval.value) }));

  $("enabled").addEventListener("change", (e) =>
    save({ enabled: e.target.checked }, e.target.checked ? t("toastOn") : t("toastOff")));
}

function buildRules() {
  for (const input of document.querySelectorAll('input[name="ruleMode"]')) {
    input.addEventListener("change", () => save({ ruleMode: input.value }));
  }

  for (const [key, list] of Object.entries(LISTS)) {
    const editor = document.querySelector(`[data-list="${key}"]`);
    const form = editor.querySelector("[data-add]");
    const input = form.querySelector("input");
    const msg = editor.querySelector("[data-msg]");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const { valid, invalid } = list.parse(input.value);
      const current = settings[key];
      const added = valid.filter((d) => !current.includes(d));
      const notes = [];
      let kind = "ok";

      if (invalid.length) {
        notes.push(t(list.invalid, invalid.join(", ")));
        kind = "error";
      }
      const duplicates = valid.filter((d) => current.includes(d));
      if (duplicates.length) notes.push(t("alreadyListed", duplicates.join(", ")));
      if (key === "hideList") {
        const kept = added.filter((d) => settings.keepList.includes(d));
        if (kept.length) {
          notes.push(t("alsoKept", kept.join(", ")));
          if (kind !== "error") kind = "warn";
        }
      }

      if (added.length) {
        await save({ [key]: [...current, ...added].sort() }, tn(added.length, list.added));
        input.value = invalid.join(list.sep);
      }
      setMessage(msg, notes.join(" "), notes.length ? kind : "");
      input.focus();
    });
  }

  buildProfiles();
}

function buildProfiles() {
  const form = $("profileForm");
  const nameInput = $("profileName");
  const msg = $("profileMsg");
  let renaming = false;
  let deleteTimer = 0;

  const openForm = (rename) => {
    renaming = rename;
    form.hidden = false;
    nameInput.value = rename ? settings.profiles.find((p) => p.id === settings.activeProfile)?.name ?? "" : "";
    setMessage(msg, "");
    nameInput.focus();
  };
  const closeForm = () => {
    form.hidden = true;
    form.reset();
  };

  $("profileNew").addEventListener("click", () => openForm(false));
  $("profileRename").addEventListener("click", () => openForm(true));
  $("profileFormCancel").addEventListener("click", closeForm);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const name = nameInput.value;
      const patch = renaming ? renameProfile(settings, settings.activeProfile, name) : createProfile(settings, name);
      await save(patch, renaming ? t("profileRenamed") : t("profileCreated", name.trim()));
      closeForm();
    } catch (err) {
      setMessage(msg, t(err.message), "error");
    }
  });

  $("profileSelect").addEventListener("change", async (e) => {
    const id = e.target.value;
    const name = settings.profiles.find((p) => p.id === id)?.name ?? "";
    await save(switchProfile(settings, id), t("profileSwitched", name));
  });

  const deleteBtn = $("profileDelete");
  deleteBtn.addEventListener("click", async () => {
    if (!deleteBtn.classList.contains("confirm")) {
      deleteBtn.classList.add("confirm");
      deleteBtn.textContent = t("clickToConfirm");
      deleteTimer = setTimeout(() => {
        deleteBtn.classList.remove("confirm");
        deleteBtn.textContent = t("profileDelete");
      }, 4000);
      return;
    }
    clearTimeout(deleteTimer);
    deleteBtn.classList.remove("confirm");
    deleteBtn.textContent = t("profileDelete");
    const name = settings.profiles.find((p) => p.id === settings.activeProfile)?.name ?? "";
    await save(deleteProfile(settings, settings.activeProfile), t("profileDeleted", name));
  });
}

function buildSchedule() {
  const days = $("schedDays");
  for (const day of WEEK) {
    const label = document.createElement("label");
    label.className = "day-chip";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = String(day);
    const text = document.createElement("span");
    text.textContent = weekday(day);
    label.title = weekday(day, "long");
    label.append(box, text);
    days.append(label);
  }

  const msg = $("schedMsg");
  const read = () => ({
    enabled: $("schedEnabled").checked,
    days: [...days.querySelectorAll("input:checked")].map((b) => Number(b.value)),
    start: $("schedStart").value,
    end: $("schedEnd").value
  });
  const update = async () => {
    const schedule = normalizeSchedule(read());
    if (!schedule) {
      setMessage(msg, t("schedBadTimes"), "error");
      return;
    }
    setMessage(msg, schedule.enabled && schedule.days.length === 0 ? t("schedPickDay") : "", "warn");
    await save({ ghostSchedule: schedule });
  };
  $("schedEnabled").addEventListener("change", update);
  days.addEventListener("change", update);
  $("schedStart").addEventListener("change", update);
  $("schedEnd").addEventListener("change", update);
}

function buildExtras() {
  for (const [key, permission] of Object.entries(EXTRAS)) {
    $(key).addEventListener("change", async (e) => {
      const on = e.target.checked;
      if (on) {
        // Must be the first await in the click handler so Chrome sees the user gesture.
        let granted = false;
        try {
          granted = await chrome.permissions.request({ permissions: [permission] });
        } catch {
          granted = false;
        }
        if (!granted) {
          e.target.checked = false;
          toast(t("permissionDenied"));
          return;
        }
      } else if (!Object.entries(EXTRAS).some(([other, p]) => other !== key && p === permission && settings[other])) {
        // Give the permission back unless another feature still uses it.
        try {
          await chrome.permissions.remove({ permissions: [permission] });
        } catch {
          // Already removed; nothing to do.
        }
      }
      await save({ [key]: on });
    });
  }
}

function buildSecurity() {
  const form = $("pinSetForm");
  const msg = $("pinMsg");
  let removeTimer = 0;

  $("pinSetOpen").addEventListener("click", () => {
    form.hidden = false;
    $("pinActions").hidden = true;
    setMessage(msg, "");
    $("pinNew").focus();
  });

  const closeForm = () => {
    form.reset();
    form.hidden = true;
    $("pinActions").hidden = false;
  };
  $("pinSetCancel").addEventListener("click", () => {
    closeForm();
    setMessage(msg, "");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = $("pinNew").value;
    if (!PIN_PATTERN.test(pin)) return setMessage(msg, t("pinInvalid"), "error");
    if (pin !== $("pinConfirm").value) return setMessage(msg, t("pinMismatch"), "error");
    await setPin(pin);
    closeForm();
    settings = await getSettings();
    renderSecurity();
    setMessage(msg, t("pinSaved"), "ok");
    toast(t("pinSavedToast"));
  });

  const removeBtn = $("pinRemove");
  removeBtn.addEventListener("click", async () => {
    if (!removeBtn.classList.contains("confirm")) {
      removeBtn.classList.add("confirm");
      removeBtn.textContent = t("clickToConfirm");
      removeTimer = setTimeout(() => {
        removeBtn.classList.remove("confirm");
        removeBtn.textContent = t("pinRemove");
      }, 4000);
      return;
    }
    clearTimeout(removeTimer);
    removeBtn.classList.remove("confirm");
    removeBtn.textContent = t("pinRemove");
    await clearPin();
    settings = await getSettings();
    renderSecurity();
    setMessage(msg, t("pinRemoved"), "ok");
    toast(t("pinRemovedToast"));
  });
}

async function renderShortcuts() {
  const names = { "clean-now": "cmdCleanNow", "toggle-ghost": "cmdToggleGhost" };
  const rows = (await chrome.commands.getAll()).filter((c) => names[c.name]).map(({ name, shortcut }) => {
    const row = document.createElement("div");
    const dt = document.createElement("dt");
    dt.textContent = t(names[name]);
    const dd = document.createElement("dd");
    if (shortcut) {
      const kbd = document.createElement("kbd");
      kbd.textContent = shortcut;
      kbd.dir = "ltr";
      dd.append(kbd);
    } else {
      dd.textContent = t("keysNotSet");
      dd.className = "unset";
    }
    row.append(dt, dd);
    return row;
  });
  $("shortcutList").replaceChildren(...rows);
}

function buildShortcuts() {
  $("editShortcuts").addEventListener("click", () => {
    // Firefox has its own page for this and cannot open chrome:// addresses.
    if (chrome.commands.openShortcutSettings) chrome.commands.openShortcutSettings();
    else chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
  });
  // Pick up changes made on chrome://extensions/shortcuts when the user comes back.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") renderShortcuts();
  });
  renderShortcuts();
}

function buildBackup() {
  const msg = $("backupMsg");
  let pending = null;   // validated import waiting for confirmation

  $("exportBtn").addEventListener("click", () => {
    const json = JSON.stringify(createBackup(settings), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: backupFileName() });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setMessage(msg, t("backupExported"), "ok");
  });

  const fileInput = $("importFile");
  $("importBtn").addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    fileInput.value = "";           // allow choosing the same file again
    if (!file) return;
    $("importPreview").hidden = true;
    pending = null;
    try {
      const { patch, notes } = readBackup(await file.text());

      // Optional permissions cannot be requested here (no click to approve them),
      // so those features are only turned on if Chrome already allows them.
      for (const [key, permission] of Object.entries(EXTRAS)) {
        if (patch[key] && !(await chrome.permissions.contains({ permissions: [permission] }))) {
          patch[key] = false;
          notes.push(t(EXTRA_NOTES[key]));
        }
      }

      const next = { ...settings, ...patch };
      const mode = t(MODES[next.mode]) + (next.mode === "interval" ? " " + t("everyInterval", tn(next.intervalMin, "countMinutes")) : "");
      const lines = [
        t(next.enabled ? "importSummaryOn" : "importSummaryOff", mode),
        t("importSummaryRules", rulesSummary(next)),
        t("importSummaryLists", tn(next.keepList.length, "countSites"), tn(next.hideList.length, "countSites"), tn(next.keywords.length, "countKeywords")),
        ...(next.profiles?.length ? [t("importSummaryProfiles", next.profiles.map((p) => p.name).join(", "))] : []),
        ...notes
      ];
      $("importSummary").replaceChildren(...lines.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
      $("importPreview").hidden = false;
      pending = patch;
      setMessage(msg, "");
    } catch (err) {
      setMessage(msg, err.message, "error");
    }
  });

  $("importApply").addEventListener("click", async () => {
    if (!pending) return;
    const patch = pending;
    pending = null;
    $("importPreview").hidden = true;
    await save(patch, t("importDone"));
    setMessage(msg, t("importDone"), "ok");
    if (patch.language && patch.language !== language()) location.reload();
  });

  $("importCancel").addEventListener("click", () => {
    pending = null;
    $("importPreview").hidden = true;
    setMessage(msg, t("importCancelled"));
  });
}

function buildStats() {
  $("resetStats").addEventListener("click", () =>
    save({ stats: { today: 0, total: 0, day: "" } }, t("statsResetDone")));
}

function openApp() {
  buildGeneral();
  buildRules();
  buildSchedule();
  buildExtras();
  buildSecurity();
  buildShortcuts();
  buildBackup();
  buildStats();
  renderAll();
  $("app").hidden = false;

  if (location.hash === "#welcome") {
    $("welcome").hidden = false;
    $("dismissWelcome").addEventListener("click", () => {
      $("welcome").hidden = true;
      history.replaceState(null, "", location.pathname);
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      settings[key] = newValue ?? DEFAULTS[key];
    }
    renderKeys(Object.keys(changes));
  });
  chrome.permissions.onAdded.addListener(renderExtras);
  chrome.permissions.onRemoved.addListener(renderExtras);
  setInterval(() => {
    renderStats();
    renderSchedule();
  }, 30_000);
}

// ---------- Language (works on the lock screen too) ----------
function buildLanguage() {
  const select = $("language");
  select.add(new Option(t("languageAuto"), "auto"));
  for (const [code, name] of Object.entries(LANGUAGES)) select.add(new Option(name, code));
  select.value = settings.language ?? "auto";
  select.addEventListener("change", async () => {
    await saveSettings({ language: select.value });
    location.reload();
  });
  for (const id of ["helpLink", "privacyLink", "limitsLink"]) {
    const link = $(id);
    link.href = helpPage() + (link.hash || "");
  }
}

// ---------- Lock screen ----------
let lockTimer = 0;

async function refreshLockout() {
  clearTimeout(lockTimer);
  const remaining = await lockoutRemaining();
  const locked = remaining > 0;
  $("lockPin").disabled = locked;
  $("lockSubmit").disabled = locked;
  if (locked) {
    $("lockError").textContent = t("pinLockedOut", formatDuration(remaining));
    lockTimer = setTimeout(refreshLockout, Math.min(remaining, 1000));
  } else if ($("lockError").dataset.lockout) {
    $("lockError").textContent = "";
    $("lockPin").focus();
  }
  $("lockError").dataset.lockout = locked ? "1" : "";
}

function showLock() {
  $("lock").hidden = false;
  $("lockPin").focus();
  refreshLockout();
  $("lockForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const result = await tryUnlock($("lockPin").value);
    $("lockPin").value = "";
    if (result.ok) {
      clearTimeout(lockTimer);
      $("lock").hidden = true;
      settings = await getSettings();
      openApp();
      return;
    }
    if (result.retryAfterMs) {
      refreshLockout();
    } else {
      $("lockError").textContent = tn(result.triesLeft, "pinWrong");
      $("lockPin").focus();
    }
  });
}

async function init() {
  settings = await getSettings();
  await initI18n(settings.language);
  localizePage();
  buildLanguage();
  if (settings.pinHash) showLock();
  else openApp();
}

init();
