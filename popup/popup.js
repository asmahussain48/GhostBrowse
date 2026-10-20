import { getSettings, saveSettings, MODES, statsForToday } from "../lib/settings.js";
import { tryUnlock } from "../lib/pin.js";
import { relativeTime, rulesSummary, formatDuration, cleanupSummary, formatTime } from "../lib/format.js";
import { hostOf, isWebUrl, matchesDomain, shouldHide } from "../lib/rules.js";
import { switchProfile } from "../lib/profiles.js";
import { initI18n, localizePage, language, formatNumber, t, tn } from "../lib/i18n.js";

const $ = (id) => document.getElementById(id);
const OWN_PAGES = chrome.runtime.getURL("");

let settings = null;
let unlocked = false;         // PIN entered during this popup's lifetime
let pendingChange = null;     // setting change waiting for the PIN
const confirmTimers = new Map();
let siteUrl = "";             // the page the popup was opened on, if it is a web page
let site = "";                // its host, without "www."

// ---------- Rendering ----------
function render() {
  const s = settings;
  const ghost = Boolean(s.ghostSession);

  $("enabled").checked = s.enabled;
  $("stateLabel").textContent = s.enabled ? t("stateOn") : t("stateOff");
  $("stateLabel").className = "state-label" + (s.enabled ? " on" : "");
  $("logo").src = s.enabled || ghost ? "../icons/icon32.png" : "../icons/icon32-off.png";

  renderProfiles();
  $("mode").value = s.mode;
  const rules = $("rules");
  rules.textContent = rulesSummary(s);
  rules.classList.toggle("warn", s.ruleMode === "hideListed" && s.hideList.length === 0 && s.keywords.length === 0);

  $("lastCleanup").textContent = relativeTime(Math.max(s.lastActivity, s.lastCleanup));
  const { today, total } = statsForToday(s.stats);
  $("today").textContent = formatNumber(today);
  $("total").textContent = t("popupTotal", formatNumber(total));

  $("ghostBanner").hidden = !ghost;
  if (ghost) {
    $("ghostText").textContent = s.ghostSession.scheduled && s.ghostSession.until
      ? t("popupGhostScheduled", formatTime(s.ghostSession.until))
      : t("popupGhostActive", relativeTime(s.ghostSession.start));
  }
  $("ghostLabel").textContent = ghost ? t("popupEndGhost") : t("popupStartGhost");
  $("ghost").classList.toggle("active", ghost);

  renderSite();
}

function renderProfiles() {
  const profiles = settings.profiles ?? [];
  const row = $("profileRow");
  row.hidden = profiles.length < 2;
  if (row.hidden) return;
  const select = $("profile");
  const options = profiles.map((p) => new Option(p.name, p.id));
  if (!profiles.some((p) => p.id === settings.activeProfile)) {
    const unsaved = new Option(t("profileUnsaved"), "");
    unsaved.disabled = true;
    options.unshift(unsaved);
  }
  select.replaceChildren(...options);
  select.value = settings.activeProfile ?? "";
}

function siteState(s) {
  const keptBy = s.keepList.filter((d) => matchesDomain(site, [d]));
  const hiddenBy = s.hideList.filter((d) => matchesDomain(site, [d]));
  let status;
  if (keptBy.length) status = t("siteKept", keptBy.join(", "));
  else if (s.ghostSession) status = t("siteGhost");
  else if (!s.enabled) status = t("siteOff");
  else if (!shouldHide(siteUrl, s)) status = t("siteStays");
  else if (s.mode === "interval") status = t("siteRemovedInterval", tn(s.intervalMin, "countMinutes"));
  else status = t({ immediate: "siteRemovedImmediate", onTabClose: "siteRemovedOnTabClose", onStartup: "siteRemovedOnStartup" }[s.mode]);
  return { keptBy, hiddenBy, status };
}

function renderSite() {
  $("site").hidden = !site;
  if (!site) return;
  const { keptBy, hiddenBy, status } = siteState(settings);
  $("siteHost").textContent = site;
  $("siteStatus").textContent = status;
  $("siteKeep").textContent = keptBy.length ? t("siteStopKeeping") : t("siteKeep");
  $("siteHide").hidden = settings.ruleMode !== "hideListed";
  $("siteHide").textContent = hiddenBy.length ? t("siteStopHiding") : t("siteHide");
}

// Shows the keyboard shortcuts actually assigned (the user can change or clear them).
async function showShortcuts() {
  for (const { name, shortcut } of await chrome.commands.getAll()) {
    const kbd = document.querySelector(`.kbd[data-command="${name}"]`);
    if (!kbd || !shortcut) continue;
    kbd.textContent = shortcut;
    kbd.hidden = false;
    const button = kbd.closest("button");
    button.classList.add("has-kbd");
    button.title = t("shortcutTitle", shortcut);
  }
}

function showResult(text, kind = "") {
  const el = $("result");
  el.textContent = text;
  el.className = "result" + (kind ? " " + kind : "");
}

// ---------- Messaging ----------
async function send(msg) {
  const res = await chrome.runtime.sendMessage(msg);
  if (res?.error) throw new Error(res.error);
  return res;
}

async function runAction(button, work) {
  button.disabled = true;
  showResult(t("working"));
  try {
    showResult(await work(), "ok");
  } catch (err) {
    showResult(err.message || t("errGeneric"), "error");
  } finally {
    button.disabled = false;
  }
}

function rangeStart(value, now = new Date()) {
  switch (value) {
    case "hour": return now.getTime() - 3600_000;
    case "today": return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    case "week": return now.getTime() - 7 * 86400_000;
    default: return 0;
  }
}

// A destructive button asks for a second click within 4 seconds.
function needsConfirm(button, label) {
  if (button.classList.contains("confirm")) {
    resetConfirm(button, label);
    return false;
  }
  button.classList.add("confirm");
  button.textContent = t("clickToConfirm");
  confirmTimers.set(button, setTimeout(() => resetConfirm(button, label), 4000));
  return true;
}

function resetConfirm(button, label) {
  clearTimeout(confirmTimers.get(button));
  button.classList.remove("confirm");
  button.textContent = label;
}

// ---------- PIN guard ----------
// Clean Now, Forget and Ghost Session only remove history, so they never need
// the PIN. Turning GhostBrowse off, changing its mode, profile or lists does.
function guarded(apply) {
  if (unlocked) return apply();
  pendingChange = apply;
  $("pinForm").hidden = false;
  $("pinError").textContent = "";
  $("pinInput").value = "";
  $("pinInput").focus();
}

async function submitPin(event) {
  event.preventDefault();
  const result = await tryUnlock($("pinInput").value);
  if (result.ok) {
    unlocked = true;
    $("pinForm").hidden = true;
    const apply = pendingChange;
    pendingChange = null;
    await apply?.();
    return;
  }
  $("pinInput").value = "";
  $("pinError").textContent = result.retryAfterMs
    ? t("pinLockedOut", formatDuration(result.retryAfterMs))
    : tn(result.triesLeft, "pinWrong");
}

function cancelPin() {
  pendingChange = null;
  $("pinForm").hidden = true;
  render();
}

// The page the popup belongs to. If the popup page was opened in a tab of its
// own, the active tab of another window is used instead.
async function findSiteTab() {
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (current && !current.url?.startsWith(OWN_PAGES)) return current;
  const active = await chrome.tabs.query({ active: true });
  return active.find((tab) => isWebUrl(tab.url)) ?? null;
}

// ---------- Setup ----------
async function init() {
  await initI18n();
  localizePage();
  settings = await getSettings();
  unlocked = !settings.pinHash;

  const tab = await findSiteTab();
  if (tab && !tab.incognito && isWebUrl(tab.url)) {
    siteUrl = tab.url;
    site = hostOf(tab.url);
  }

  const modeSelect = $("mode");
  for (const [value, key] of Object.entries(MODES)) modeSelect.add(new Option(t(key), value));
  render();
  showShortcuts();

  $("enabled").addEventListener("change", (e) => {
    const value = e.target.checked;
    if (!unlocked) e.target.checked = !value;   // revert until the PIN is entered
    guarded(() => saveSettings({ enabled: value }));
  });

  modeSelect.addEventListener("change", (e) => {
    const value = e.target.value;
    if (!unlocked) e.target.value = settings.mode;
    guarded(() => saveSettings({ mode: value }));
  });

  $("profile").addEventListener("change", (e) => {
    const id = e.target.value;
    if (!unlocked) e.target.value = settings.activeProfile ?? "";
    guarded(async () => {
      const name = settings.profiles.find((p) => p.id === id)?.name ?? "";
      await saveSettings(switchProfile(settings, id));
      showResult(t("profileSwitched", name), "ok");
    });
  });

  $("siteKeep").addEventListener("click", () => guarded(async () => {
    const { keptBy } = siteState(settings);
    const keepList = keptBy.length
      ? settings.keepList.filter((d) => !keptBy.includes(d))
      : [...settings.keepList, site].sort();
    await saveSettings({ keepList });
    showResult(keptBy.length ? t("siteKeepRemoved", keptBy.join(", ")) : t("siteKeepAdded", site), "ok");
  }));

  $("siteHide").addEventListener("click", () => guarded(async () => {
    const { hiddenBy } = siteState(settings);
    const hideList = hiddenBy.length
      ? settings.hideList.filter((d) => !hiddenBy.includes(d))
      : [...settings.hideList, site].sort();
    await saveSettings({ hideList });
    showResult(hiddenBy.length ? t("siteHideRemoved", hiddenBy.join(", ")) : t("siteHideAdded", site), "ok");
  }));

  const forgetBtn = $("siteForget");
  forgetBtn.addEventListener("click", () => {
    if (needsConfirm(forgetBtn, t("siteForget"))) return;
    runAction(forgetBtn, async () => tn((await send({ type: "forgetSite", host: site })).removed, "siteForgotten", site));
  });

  $("pinForm").addEventListener("submit", submitPin);
  $("pinCancel").addEventListener("click", cancelPin);

  $("cleanNow").addEventListener("click", (e) =>
    runAction(e.currentTarget, async () => cleanupSummary(await send({ type: "cleanNow" }), settings)));

  const rangeBtn = $("cleanRange");
  $("range").addEventListener("change", () => resetConfirm(rangeBtn, t("popupCleanRange")));
  rangeBtn.addEventListener("click", () => {
    const value = $("range").value;
    // "All time" and "Last 7 days" take a second click to confirm.
    if ((value === "all" || value === "week") && needsConfirm(rangeBtn, t("popupCleanRange"))) return;
    resetConfirm(rangeBtn, t("popupCleanRange"));
    runAction(rangeBtn, async () =>
      cleanupSummary(await send({ type: "cleanRange", since: rangeStart(value) }), settings));
  });

  $("ghost").addEventListener("click", (e) =>
    runAction(e.currentTarget, async () => {
      if (settings.ghostSession) {
        const result = await send({ type: "endGhost" });
        return t("ghostEnded", cleanupSummary(result, settings));
      }
      await send({ type: "startGhost" });
      return t("ghostStarted");
    }));

  $("openSettings").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
    window.close();
  });
  $("openHelp").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL(language() === "ur" ? "help/help.ur.html" : "help/help.html") });
    window.close();
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    if (changes.language) return location.reload();
    settings = await getSettings();
    render();
  });
  setInterval(render, 20_000);   // keep "2 min ago" fresh
}

init();
