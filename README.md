# 👻 GhostBrowse

**Automatic history removal for Chrome, without logging you out.**

GhostBrowse is a Chrome extension (Manifest V3) that removes visited sites from your browser history while leaving cookies, logins, saved passwords, bookmarks, and settings untouched. You browse normally, stay signed in to Gmail, Facebook, or Amazon, and your history page stays clean.

> **Academic title:** *GhostBrowse: A Privacy-Focused Browser Extension for Automatic History Management Without Session Loss*

---

## Table of Contents

1. [The Problem](#1-the-problem)
2. [Features](#2-features)
3. [What GhostBrowse Removes and Keeps](#3-what-ghostbrowse-removes-and-keeps)
4. [What GhostBrowse Cannot Do (Honest Limitations)](#4-what-ghostbrowse-cannot-do-honest-limitations)
5. [How It Works](#5-how-it-works)
6. [Permissions and Why Each Is Needed](#6-permissions-and-why-each-is-needed)
7. [Project Structure](#7-project-structure)
8. [Core Code](#8-core-code)
9. [Installation](#9-installation)
10. [Usage](#10-usage)
11. [Privacy Policy](#11-privacy-policy)
12. [Testing](#12-testing)
13. [Development Timeline](#13-development-timeline)
14. [Roadmap](#14-roadmap)
15. [Academic Section](#15-academic-section)
16. [Responsible Use](#16-responsible-use)
17. [Contributing and License](#17-contributing-and-license)

---

## 1. The Problem

People share computers at home, in offices, in university labs, and in libraries. Chrome offers two privacy options, and both have drawbacks:

| Option | Problem |
|---|---|
| **Clear browsing data** | Clears history but usually cookies too, which logs you out of every site. Clearing only history is manual and easy to forget. |
| **Incognito mode** | You must log in again every session, and nothing is remembered: carts, preferences, 2FA "trust this device". |

**GhostBrowse fills the gap:** history disappears automatically, sessions stay alive.

---

## 2. Features

### 2.1 Automatic History Removal
Visited pages are removed from Chrome history based on the cleanup mode you choose.

| Mode | When history is removed |
|---|---|
| **Immediately** | As soon as a page is recorded in history |
| **When tab closes** | When the tab that visited the page is closed |
| **Interval** | Every 1, 5, 10, or 30 minutes |
| **On browser restart** | Next time Chrome starts (see [Section 4](#4-what-ghostbrowse-cannot-do-honest-limitations) for why not "on close") |

### 2.2 Login Sessions Preserved
GhostBrowse never touches cookies, local storage, authentication tokens, saved passwords, or autofill. It does not even request cookie permission.

### 2.3 Site Rules
Two rule modes:

- **Hide everything, except the Keep list** (default). Example Keep list: `gmail.com`, `github.com`, `university.edu`.
- **Hide only the Hide list.** Example Hide list: `youtube.com`, `instagram.com`, `reddit.com`.

Rules match the domain and all its subdomains, so `google.com` also matches `mail.google.com`. The Keep list always wins over the Hide list.

**Hide keywords** extend the Hide list: any page whose address contains one of the words or phrases is removed, on any site (for example `salary` hides `google.com/search?q=salary+negotiation`). Matching ignores case and treats spaces, `-`, `_` and `+` alike, so `job search` also matches `job-search`. Keywords need 3–60 characters and match the address only. The Keep list still wins.

### 2.4 Clean Now Button
One click removes all history recorded since the last cleanup (respecting your rules). A second option, **Clean range** (last hour / today / last 7 days / all time), covers history created before the extension was installed or enabled. The wider ranges ask for a second click to confirm.

### 2.5 Ghost Session
Click **Start Ghost Session** for a temporary period where everything is removed immediately, regardless of your normal mode. When you click **End Session**, a final sweep removes anything recorded between start and end. A badge (👻) on the toolbar icon shows the session is active.

### 2.6 Extra Trace Cleaning *(optional, off by default)*
Beyond page history, some other places also reveal where you have been. Each can be toggled separately:

- **Download history:** removes the entries from `chrome://downloads` (the downloaded files stay on disk).
- **Cache:** clears cached files, which can reveal visited sites, without touching cookies.

### 2.7 Settings Lock (PIN)
An optional 4–6 digit PIN protects the settings page and the Keep/Hide lists, since those lists themselves reveal which sites you use. The PIN is stored as a salted SHA-256 hash, never in plain text. This is a deterrent for casual users of a shared computer, not strong security.

### 2.8 Privacy-Safe Statistics
The popup shows counts only: entries removed today, total entries removed, and last cleanup time. **GhostBrowse never stores the URLs it removes.** A statistics feature that kept a list of removed sites would defeat the purpose of the extension.

### 2.9 Toolbar Badge
The icon shows the current state at a glance: a green **ON** badge, a grey **OFF** badge with a grey icon, and 👻 for an active Ghost Session.

### 2.10 Keyboard Shortcuts
| Keys | Action |
|---|---|
| **Alt+Shift+D** | Clean Now. The badge briefly shows how many entries were removed (✓ if none). |
| **Alt+Shift+G** | Start or end a Ghost Session. |

Change them at `chrome://extensions/shortcuts` (or from Settings → Keyboard shortcuts). Chrome silently leaves a default unset if it is already taken; Alt+Shift+C, W and X, for example, are reserved by Chrome 153 on Windows.

### 2.11 Settings Backup
**Settings → Back up settings** exports your settings, lists and keywords to a dated JSON file and imports them on another computer. Every imported value is validated and normalized, and a summary is shown before anything changes. The file never contains the PIN hash or statistics. Download and cache cleaning are only switched on by an import if Chrome already allows them, because the permission prompt needs a click.

### 2.12 This Site (popup)
The popup shows the site of the current tab and says what GhostBrowse will do with it, for example "Removed from history when its tab closes" or "Stays in history: on your Keep list". One click to **Keep** it, **Hide** it (in hide-listed mode), or **Forget** it: remove every history entry for the site and its subdomains, from all time, even if it is kept. Keep and Hide ask for the PIN when one is set; Forget only removes history, so it does not.

### 2.13 Rule Profiles
Named sets of rules (rule mode, Keep and Hide lists, keywords), such as **Study** (keep university sites) and **Personal** (hide everything). Create and manage them in Settings → Site rules; switch from the popup. Edits to the rules are saved to the selected profile.

### 2.14 Scheduled Ghost Sessions
A weekly window, for example weekdays 09:00–17:00 on an office PC, during which a Ghost Session runs automatically. Overnight windows (22:00–06:00) work. A session ended by hand stays off until the window closes; a session the user started is never ended by the schedule; a session whose window ended while Chrome was closed is ended, with its final sweep, at the next start.

### 2.15 Languages
English and Urdu (اردو), with right-to-left layout. GhostBrowse follows Chrome's language, and the language can also be chosen at the top of the Settings page, since many Urdu speakers run Chrome in English. The Help page exists in both languages.

---

## 3. What GhostBrowse Removes and Keeps

| ✅ Keeps | ❌ Removes |
|---|---|
| Login sessions and cookies | Visited URLs in `chrome://history` |
| Saved passwords | "Most visited" suggestions derived from history |
| Autofill and addresses | Address bar suggestions based on history |
| Bookmarks | Download list entries *(optional)* |
| Extensions and their data | Cached files *(optional)* |
| Site settings and permissions | |
| Local storage of websites | |

---

## 4. What GhostBrowse Cannot Do (Honest Limitations)

A privacy tool must be clear about what it does not protect. These limitations should appear in the extension's Help page and store listing.

| Limitation | Explanation |
|---|---|
| **Websites still know you visited** | You are logged in, so YouTube, Facebook, and Amazon record your activity in your account. GhostBrowse only cleans the local browser. |
| **Google account activity** | If "Web & App Activity" is on, Google may keep records at [myactivity.google.com](https://myactivity.google.com). This is server-side and outside the extension's reach. |
| **Network monitoring** | Employers, universities, ISPs, and routers can log traffic at the network level. |
| **"On browser close" is not reliable** | Manifest V3 service workers are not guaranteed to run while Chrome shuts down. GhostBrowse cleans on the **next startup** instead, plus periodic cleanup while running. If this matters, use Interval or Immediate mode. |
| **Recently closed tabs** | Chrome's "Recently closed" list (Ctrl+Shift+T) cannot be edited by extensions. It is cleared when Chrome restarts. |
| **Chrome Sync** | With Sync on, history is shared across devices. Deletions made through the History API normally sync too, but there can be a delay. |
| **Managed (work/school) Chrome** | Administrators can block extensions or force history saving through policy. GhostBrowse cannot and should not override this. |
| **Other browser profiles and OS traces** | Other Chrome profiles, other browsers, DNS cache, and OS-level logs are not affected. |
| **Incognito** | Extensions do not run in Incognito unless allowed, and Incognito does not save history anyway. |

---

## 5. How It Works

```
┌────────────────────────────────────────────────────────────┐
│                     Chrome Browser                         │
│                                                            │
│   User visits page ──► chrome.history records visit        │
│                                │                           │
│                                ▼                           │
│   ┌────────────────────────────────────────────────────┐   │
│   │        background.js  (MV3 service worker)         │   │
│   │                                                    │   │
│   │  history.onVisited ──► Immediate mode              │   │
│   │  tabs.onUpdated / onRemoved ──► Tab-close mode     │   │
│   │  alarms.onAlarm ──► Interval mode                  │   │
│   │  runtime.onStartup ──► Restart mode                │   │
│   │                                                    │   │
│   │  rules.js: shouldHide(url)?                        │   │
│   │     Keep list match ─► keep                        │   │
│   │     Hide list / hide-all ─► history.deleteUrl()    │   │
│   └────────────────────────────────────────────────────┘   │
│                                │                           │
│              chrome.storage.local (settings, counts)       │
│              chrome.storage.session (tab ↔ URL map)        │
│                                                            │
│   popup.html ◄──► messages ◄──► options.html               │
└────────────────────────────────────────────────────────────┘
```

**Key design decisions:**

- **The startup sweep does not rely on `runtime.onStartup` alone.** `chrome.storage.session` is empty after every browser restart, so the first time the worker runs in a new session also triggers the sweep, even if Chrome never delivers `onStartup`. A stored version number tells a browser restart apart from an install or update, which do not sweep.
- **Service workers can stop at any time** in Manifest V3. Temporary data (which tab visited which URL) is kept in `chrome.storage.session`, not in global variables, so it survives the worker restarting.
- **`chrome.alarms` is used for timers**, not `setInterval`, because intervals die when the worker sleeps. Chrome enforces a minimum alarm period of 30 seconds.
- **`history.deleteUrl()` removes every visit** to that exact URL, including older ones. For Ghost Sessions and "Clean last hour", `history.search()` with a time range finds URLs first, then rules are applied before deletion. `deleteRange()` is used only when no Keep list exists, because it cannot skip kept sites.
- **Only `http` and `https` URLs are handled.** Internal pages like `chrome://` and `file://` are ignored. The exception is GhostBrowse's own Settings and Help pages, which are always removed from history (uncounted), since they would reveal that a privacy tool is in use.
- **Cleanups explain themselves.** Clean Now and Clean range report how many entries were removed, how many your rules kept, and how many local or browser pages were left alone, so "Nothing to remove" is never a mystery.

---

## 6. Permissions and Why Each Is Needed

Asking for the fewest permissions builds user trust and speeds up Chrome Web Store review.

| Permission | Why | Required? |
|---|---|---|
| `history` | Read and delete history entries (core feature) | Yes |
| `storage` | Save settings, rules, and counters | Yes |
| `alarms` | Run interval cleanups and start and end Scheduled Ghost Sessions | Yes |
| `tabs` | Read tab URLs for "When tab closes" mode and show the current site in the popup | Yes |
| `downloads` | Erase download list entries | Optional |
| `browsingData` | Clear cache only | Optional |

**Not requested:** `cookies` and `<all_urls>` host permissions. The original idea listed `chrome.cookies` "for checking", but the extension never needs to read cookies. Leaving it out means GhostBrowse can prove it cannot access your sessions.

Optional permissions are requested at runtime with `chrome.permissions.request()` only when the user turns that feature on.

---

## 7. Project Structure

```
ghostbrowse/
├── manifest.json
├── background.js          # Service worker: listeners, cleanup logic
├── lib/
│   ├── rules.js           # Domain matching, shouldHide(), shouldHideDownload()
│   ├── settings.js        # Defaults, load/save helpers
│   ├── pin.js             # PIN hashing, verification, lockout
│   ├── format.js          # Display helpers shared by the pages
│   ├── backup.js          # Settings export/import and validation
│   ├── profiles.js        # Rule profiles (create, switch, rename, delete)
│   ├── schedule.js        # Scheduled Ghost Session windows
│   └── i18n.js            # Translations, plurals, right-to-left pages
├── _locales/
│   ├── en/messages.json   # English
│   └── ur/messages.json   # Urdu
├── styles/
│   └── theme.css          # Shared colors (light + dark) and controls
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── options/
│   ├── options.html       # Modes, rules, profiles, schedule, PIN, backup
│   ├── options.css
│   └── options.js
├── help/
│   ├── help.html          # Limitations and FAQ
│   ├── help.ur.html       # The same in Urdu
│   └── help.css
├── icons/
│   ├── icon16.png … icon128.png
│   └── icon16-off.png, icon32-off.png   # grey toolbar icon when OFF
├── scripts/
│   ├── generate-icons.js  # Draws the icons (no dependencies)
│   ├── package.js         # Builds the Chrome and Firefox packages
│   ├── store-assets.js    # Renders the store screenshots and promo tiles
│   ├── chrome-path.js     # Finds the installed Chrome
│   └── crc32.js
├── store/
│   ├── listing.md         # Store description, permission justifications, privacy answers
│   ├── screenshots/       # 1280×800
│   └── promo-*.png        # 440×280 and 1400×560 tiles
├── tests/
│   ├── rules.test.js      # Domain matching
│   ├── background.test.js # Service worker: modes, rules, Ghost Session, stats
│   ├── pin.test.js        # PIN hashing and lockout
│   ├── backup.test.js     # Export/import validation
│   ├── format.test.js
│   ├── profiles.test.js
│   ├── schedule.test.js
│   ├── i18n.test.js       # Every message key used exists, in both languages
│   ├── setup.js
│   ├── helpers/chrome-mock.js   # In-memory chrome.* APIs
│   └── e2e/
│       ├── e2e.js         # Real Chrome: modes, rules, logins, downloads, restart, features, Urdu
│       └── firefox.js     # Real Firefox
├── package.json           # Dev tooling only (tests, icons, packaging)
├── vitest.config.js
├── PRIVACY.md
├── LICENSE
└── README.md
```

---

## 8. Core Code

The listings below are simplified excerpts that show the core ideas. The source files are the full implementation, which adds:

- **Serialized updates.** Tab-map, counter, and cleanup updates run one at a time, so events that arrive together cannot overwrite each other.
- **Redirect hops.** In tab-close mode, redirect hops that never appear as a tab URL are also removed.
- **Incognito tabs are ignored.** Their URLs are never passed to `deleteUrl`.
- **A safe cursor.** Install sets the cleanup cursor only once, so updates keep it. A narrow "Clean last hour" does not move it past history that has not been swept yet.
- **Download-list rules.** Entries are erased right away in Immediate mode and during a Ghost Session, and site rules apply to them.
- **PIN lockout.** After too many wrong attempts, PIN entry is locked for a while.
- **Once-per-session startup sweep.** It runs from `onStartup`, or from the first worker start after a restart if `onStartup` never arrives.
- **Scheduled sessions use one-shot alarms** set to the next window boundary, and are re-checked on every worker start.
- **Translations are loaded from `_locales`** directly rather than through `chrome.i18n`, so the language can be changed inside the extension.

### 8.1 `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "GhostBrowse",
  "version": "1.0.0",
  "description": "Automatically removes browsing history while keeping you logged in.",
  "permissions": ["history", "storage", "alarms", "tabs"],
  "optional_permissions": ["downloads", "browsingData"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png"
    }
  },
  "options_page": "options/options.html",
  "commands": {
    "clean-now": { "suggested_key": { "default": "Alt+Shift+D" }, "description": "Clean Now" },
    "toggle-ghost": { "suggested_key": { "default": "Alt+Shift+G" }, "description": "Start or end a Ghost Session" }
  },
  "icons": {
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

### 8.2 `lib/settings.js`

```js
export const DEFAULTS = {
  enabled: true,
  mode: "onTabClose",        // "immediate" | "onTabClose" | "interval" | "onStartup"
  intervalMin: 10,
  ruleMode: "hideAll",       // "hideAll" | "hideListed"
  keepList: [],
  hideList: [],
  ghostSession: null,        // { start: timestamp } or null
  lastCleanup: 0,
  stats: { today: 0, total: 0, day: "" },
  cleanDownloads: false,
  cleanCache: false,
  pinHash: null,
  pinSalt: null
};

export async function getSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

export async function saveSettings(patch) {
  await chrome.storage.local.set(patch);
}
```

### 8.3 `lib/rules.js`

```js
export function normalizeDomain(input) {
  return input.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

export function matchesDomain(hostname, list) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return list.some(d => host === d || host.endsWith("." + d));
}

export function shouldHide(url, s) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;

  if (matchesDomain(u.hostname, s.keepList)) return false;   // Keep always wins
  if (s.ghostSession) return true;                           // Ghost Session hides all
  if (s.ruleMode === "hideListed") return matchesDomain(u.hostname, s.hideList);
  return true;                                               // hideAll
}
```

### 8.4 `background.js`

```js
import { getSettings, saveSettings } from "./lib/settings.js";
import { shouldHide } from "./lib/rules.js";

const ALARM = "ghost-clean";

// ---------- Helpers ----------
async function recordRemoved(count) {
  if (!count) return;
  const s = await getSettings();
  const today = new Date().toDateString();
  const stats = s.stats.day === today ? s.stats : { today: 0, total: s.stats.total, day: today };
  stats.today += count;
  stats.total += count;
  await saveSettings({ stats });     // counts only, never URLs
}

async function deleteIfHidden(url) {
  const s = await getSettings();
  if (!s.enabled || !shouldHide(url, s)) return 0;
  await chrome.history.deleteUrl({ url });
  return 1;
}

// Remove everything since a timestamp, respecting rules
export async function cleanSince(startTime) {
  const s = await getSettings();
  const items = await chrome.history.search({ text: "", startTime, maxResults: 100000 });
  let removed = 0;
  for (const item of items) {
    if (shouldHide(item.url, s)) {
      await chrome.history.deleteUrl({ url: item.url });
      removed++;
    }
  }
  if (s.cleanDownloads && await chrome.permissions.contains({ permissions: ["downloads"] })) {
    await chrome.downloads.erase({ startedAfter: new Date(startTime).toISOString() });
  }
  if (s.cleanCache && await chrome.permissions.contains({ permissions: ["browsingData"] })) {
    await chrome.browsingData.removeCache({ since: startTime });
  }
  await saveSettings({ lastCleanup: Date.now() });
  await recordRemoved(removed);
  return removed;
}

// ---------- Immediate mode + Ghost Session ----------
chrome.history.onVisited.addListener(async (item) => {
  const s = await getSettings();
  if (s.mode === "immediate" || s.ghostSession) {
    await recordRemoved(await deleteIfHidden(item.url));
  }
});

// ---------- Tab-close mode ----------
chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (!change.url) return;
  const key = "tab_" + tabId;
  const data = await chrome.storage.session.get(key);
  const urls = new Set(data[key] || []);
  urls.add(change.url);
  await chrome.storage.session.set({ [key]: [...urls] });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const key = "tab_" + tabId;
  const data = await chrome.storage.session.get(key);
  await chrome.storage.session.remove(key);
  const s = await getSettings();
  if (s.mode !== "onTabClose") return;
  let removed = 0;
  for (const url of data[key] || []) removed += await deleteIfHidden(url);
  await recordRemoved(removed);
});

// ---------- Interval mode ----------
async function setupAlarm() {
  const s = await getSettings();
  await chrome.alarms.clear(ALARM);
  if (s.enabled && s.mode === "interval") {
    chrome.alarms.create(ALARM, { periodInMinutes: Math.max(0.5, s.intervalMin) });
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  const s = await getSettings();
  await cleanSince(s.lastCleanup);
});

// ---------- Startup / install ----------
chrome.runtime.onStartup.addListener(async () => {
  const s = await getSettings();
  // Catches anything left from last session (browser close, crash, tab-close misses)
  if (s.enabled) await cleanSince(s.lastCleanup);
  await setupAlarm();
});

chrome.runtime.onInstalled.addListener(async () => {
  await saveSettings({ lastCleanup: Date.now() });
  await setupAlarm();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.mode || changes.intervalMin || changes.enabled) setupAlarm();
  if (changes.enabled || changes.ghostSession) updateBadge();
});

// ---------- Messages from popup ----------
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === "cleanNow") {
      const s = await getSettings();
      reply({ removed: await cleanSince(s.lastCleanup) });
    } else if (msg.type === "cleanRange") {
      reply({ removed: await cleanSince(Date.now() - msg.ms) });
    } else if (msg.type === "startGhost") {
      await saveSettings({ ghostSession: { start: Date.now() } });
      reply({ ok: true });
    } else if (msg.type === "endGhost") {
      const s = await getSettings();
      const start = s.ghostSession?.start ?? s.lastCleanup;
      await cleanSince(start);                     // final sweep while still in session
      await saveSettings({ ghostSession: null });
      reply({ ok: true });
    }
  })();
  return true; // keep channel open for async reply
});

// ---------- Badge ----------
async function updateBadge() {
  const s = await getSettings();
  const text = s.ghostSession ? "👻" : s.enabled ? "ON" : "";
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: s.enabled ? "#2e7d32" : "#757575" });
}
```

### 8.5 `lib/pin.js`

```js
async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function setPin(pin) {
  const salt = crypto.randomUUID();
  await chrome.storage.local.set({ pinSalt: salt, pinHash: await sha256(salt + pin) });
}

export async function checkPin(pin) {
  const { pinSalt, pinHash } = await chrome.storage.local.get(["pinSalt", "pinHash"]);
  if (!pinHash) return true;
  return (await sha256(pinSalt + pin)) === pinHash;
}
```

### 8.6 Popup Layout

```
┌─────────────────────────────┐
│ 👻 GhostBrowse        [ON ▣]│
├─────────────────────────────┤
│ Profile: Study           ▾  │
│ Mode:  When tab closes   ▾  │
│ Rules: Hide all except 3    │
│ Last cleanup: 2 min ago     │
│ Removed today: 27 · 1,432   │
├─────────────────────────────┤
│ This site    news.example   │
│ Removed when its tab closes │
│ [ Keep ]        [ Forget ]  │
├─────────────────────────────┤
│ [ 🧹 Clean Now ]            │
│ [ Clean last hour ▾ ]       │
│ [ 👻 Start Ghost Session ]  │
├─────────────────────────────┤
│ ⚙ Settings      ? Help      │
└─────────────────────────────┘
```

---

## 9. Installation

### From source (development)

1. Clone or download this repository.
   ```bash
   git clone https://github.com/<your-username>/ghostbrowse.git
   ```
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the `ghostbrowse` folder.
5. Pin GhostBrowse from the puzzle-piece menu so the icon stays visible.

### Firefox
1. Run `npm install` and `npm run package`.
2. Open `about:debugging#/runtime/this-firefox` and click **Load Temporary Add-on…**.
3. Select `dist/firefox/manifest.json`.

For addons.mozilla.org, upload `dist/ghostbrowse-<version>-firefox.zip`.

### After editing code
Click the ↻ reload button on the GhostBrowse card in `chrome://extensions`. To debug the background script, click **service worker** on the same card to open its DevTools.

### Development tools
The extension itself needs no build step. Node.js 22.12+ is only needed for the tooling:

```bash
npm install          # installs the test runner
npm test             # runs the unit tests
npm run icons        # redraws icons/*.png
npm run package      # builds the Chrome and Firefox zips in dist/
npm run test:e2e     # drives the real extension in your installed Chrome
npm run test:firefox # the same in Firefox (set FIREFOX_PATH)
npm run store-assets # renders store/ screenshots and promo tiles
```

### Browser support
Chrome 116+ and other Chromium browsers (Edge, Brave, Opera), and Firefox 128+. Brave and Edge may have their own history features that behave slightly differently. In Firefox, cache cleaning clears the whole cache, because Firefox cannot clear it by time.

---

## 10. Usage

1. **First run:** open Settings, pick a cleanup mode, and add sites you want to keep in history (for example, your university portal).
2. **Normal browsing:** nothing to do. History is removed according to your mode.
3. **Before handing the computer to someone:** click **Clean Now**.
4. **Sensitive browsing session:** click **Start Ghost Session**, then **End Session** when done.
5. **Existing history from before install:** use **Clean last hour / today / last 7 days**.
6. **Lock settings:** set a PIN in Settings → Settings lock.
7. **On a site you want to keep or forget:** open the popup and use **Keep** or **Forget**.
8. **Different rules for different situations:** save them as profiles and switch from the popup.
9. **Shared office PC:** schedule a Ghost Session for working hours.
10. **Urdu:** choose اردو at the top of the Settings page.

---

## 11. Privacy Policy

*(Required for Chrome Web Store publication. Keep a copy in `PRIVACY.md`.)*

- GhostBrowse **does not collect, transmit, or sell any data.** It makes no network requests.
- Settings and counters are stored locally in `chrome.storage.local` on your device.
- **Removed URLs are never stored**, logged, or displayed.
- The Keep and Hide lists, keywords, profiles and schedule stay on your device and can be protected with a PIN.
- GhostBrowse does not read, modify, or delete cookies, passwords, or form data.
- Uninstalling the extension deletes all its stored data.

---

## 12. Testing

### Manual test cases

| # | Test | Expected result |
|---|---|---|
| 1 | Immediate mode: visit `example.com` | Entry absent from `chrome://history` within seconds |
| 2 | Log in to Gmail, run Clean Now, reload Gmail | Still logged in |
| 3 | Add `github.com` to Keep list, visit `github.com/explore` | Entry stays in history |
| 4 | Keep `google.com`, visit `mail.google.com` | Kept (subdomain match) |
| 5 | Hide-listed mode, Hide list = `youtube.com`, visit YouTube and Wikipedia | Only YouTube removed |
| 6 | Tab-close mode: open 3 pages in one tab, close it | All 3 removed |
| 7 | Tab-close mode: wait 5+ min idle (worker sleeps), then close tab | Still removed (session storage) |
| 8 | Interval mode (1 min): browse, wait 1 min | Entries removed |
| 9 | Restart mode: browse, quit Chrome, reopen | Entries removed on startup |
| 10 | Ghost Session: start, browse, end | All session entries gone, badge cleared |
| 11 | Download a file with download cleaning on | Entry gone from `chrome://downloads`, file still on disk |
| 12 | Set PIN, reopen options | PIN prompt shown; wrong PIN rejected |
| 13 | Turn extension OFF, browse | History kept normally |
| 14 | Visit `chrome://settings` | Ignored, no errors |
| 15 | Check storage in DevTools | No URLs stored anywhere |
| 16 | Browse, then press Alt+Shift+D | Entries removed; badge briefly shows the count |
| 17 | Press Alt+Shift+G twice | Ghost Session starts (👻 badge), then ends |
| 18 | Hide-listed mode, keyword `salary`, search Google for "salary negotiation" | Search removed; other searches kept |
| 19 | Export settings, import the file on another profile | Preview shown; lists, keywords and mode restored; no PIN carried over |
| 20 | Import a file from another app | Rejected with a clear message; nothing changed |
| 21 | On a site, open the popup, click Keep | Site added to the Keep list; status says it stays |
| 22 | Click Forget twice | All history for that site and its subdomains removed |
| 23 | Create profiles Study and Personal, switch in the popup | Each profile's lists come back when selected |
| 24 | Schedule a Ghost Session covering now | 👻 badge; visits removed; ends when the window closes |
| 25 | End a scheduled session by hand | Stays off until the next window |
| 26 | Choose اردو in Settings | Popup, Settings and badge tooltip in Urdu, right to left |

### Unit tests
`tests/rules.test.js` covers `normalizeDomain`, `matchesDomain`, and `shouldHide` with edge cases: `www.` prefixes, uppercase domains, look-alike domains (`notgoogle.com` must **not** match `google.com`), ports, invalid URLs, and non-HTTP schemes.

`tests/background.test.js` runs the real service worker against an in-memory mock of the `chrome.*` APIs (`tests/helpers/chrome-mock.js`). It automates most of the manual test cases above, including a simulated service-worker restart for test 7. `tests/pin.test.js` checks PIN hashing and the lockout.

```bash
npm install
npm test
```

`tests/i18n.test.js` scans the source and fails if any page or script uses a message key that does not exist, or if the Urdu file is missing a key or an argument.

### End-to-end tests
`npm run test:e2e` loads the extension into your installed Chrome (headless, with a throwaway profile and a local test website) and checks the cleanup modes, rules, popup actions, PIN lock, that logins and site data survive cleanup, download and cache cleaning, cleanup after a real browser restart, the This site panel, profiles, Scheduled Ghost Sessions and the Urdu interface. It also fails on any page error, worker error or network request made by the extension. Add `--slow` to wait for a real interval alarm, or `--shots <dir>` to save screenshots. `npm run test:firefox` runs the core checks in Firefox.

---

## 13. Development Timeline

| Week | Work |
|---|---|
| 1 | Manifest, background worker, Immediate mode, Clean Now, basic popup |
| 2 | Tab-close, Interval, and Startup modes; settings storage; alarms |
| 3 | Keep/Hide rules, options page, Ghost Session, badge |
| 4 | PIN lock, statistics, optional download/cache cleaning, Help page, testing, report |

A basic working version (Weeks 1–2) is enough for a demo. Weeks 3–4 make it publishable.

---

## 14. Roadmap

Built from the original roadmap: keyboard shortcuts (2.10), keyword rules (2.3), settings import/export (2.11), rule profiles (2.13), Scheduled Ghost Sessions (2.14), English and Urdu (2.15), and the Firefox port (Section 9). The store listing, screenshots and promo tiles are ready in `store/`.

Not built, on purpose:

- **Hashed rule lists.** Domain names are easy to guess from a list of popular sites, and the salt would have to sit in the same storage, so hashes would give little real protection while making the lists impossible to review. The PIN lock covers the realistic case of someone opening the settings.

Remaining:

- **Publication** on the Chrome Web Store and addons.mozilla.org. This needs a publisher account; everything else is in `store/listing.md`.
- **More languages.** Add `_locales/<code>/messages.json` and a help page; `tests/i18n.test.js` checks the keys.

---

## 15. Academic Section

### Objectives
1. Design an extension that removes local browsing history automatically without ending authenticated sessions.
2. Give users fine-grained control through modes and site rules.
3. Follow privacy-by-design: minimal permissions, no data collection, no URL logging.
4. Work within Manifest V3 constraints (non-persistent service workers).

### Methodology
Requirements analysis → architecture design → iterative development (weekly milestones) → functional testing against the test table → evaluation with a small group of users on shared computers.

### Evaluation Criteria
- **Correctness:** all test cases in Section 12 pass.
- **Session preservation:** 0 logouts after cleanup across tested sites.
- **Performance:** cleanup of 1,000 entries completes in a few seconds with no visible browser slowdown.
- **Usability:** short user survey (for example, System Usability Scale).

### Comparison With Existing Solutions

| Solution | Removes history | Keeps logins | Automatic | Per-site rules |
|---|---|---|---|---|
| Chrome "Clear browsing data" | ✅ | ⚠️ only if cookies unchecked | ❌ | ❌ |
| Incognito mode | ✅ | ❌ | ✅ | ❌ |
| Chrome "Delete on exit" for cookies | ❌ | ❌ | ✅ | ✅ |
| **GhostBrowse** | ✅ | ✅ | ✅ | ✅ |

### Key Contribution
Separating *history* from *session data* in automated cleanup, which built-in browser tools treat as a manual, all-or-nothing choice.

---

## 16. Responsible Use

GhostBrowse is built for personal privacy on shared devices. It is **not** designed to bypass monitoring on devices you do not own or manage. On work or school computers, follow your organization's IT policies; administrators may disable extensions or history deletion, and GhostBrowse will not attempt to get around that.

---

## 17. Contributing and License

Contributions are welcome:

1. Fork the repository.
2. Create a branch: `git checkout -b feature/your-feature`.
3. Commit and push your changes.
4. Open a pull request describing what you changed and how you tested it.

Please keep the privacy rules intact: no network requests, no URL logging, no new permissions without discussion.

**License:** MIT. See `LICENSE`.

---

*Made with 👻 for people who share computers.*
