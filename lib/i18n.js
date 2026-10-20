// Translations. Messages live in _locales/<lang>/messages.json, in Chrome's
// format so the manifest can use them too. The language follows Chrome's UI
// language unless the user picks one in Settings; chrome.i18n cannot switch
// languages at runtime, so the message files are loaded directly.
//
// In a message, $1…$9 are replaced by arguments. Messages with a count come in
// two forms, "<key>_one" and "<key>_other", and $1 is the formatted number.

export const LANGUAGES = { en: "English", ur: "اردو" };
const RTL = new Set(["ur"]);

let current = "en";
let messages = {};
let english = {};

export function resolveLanguage(pref, uiLanguage) {
  if (typeof pref === "string" && Object.hasOwn(LANGUAGES, pref)) return pref;
  const ui = String(uiLanguage || "en").toLowerCase().split(/[-_]/)[0];
  return Object.hasOwn(LANGUAGES, ui) ? ui : "en";
}

async function loadMessages(lang) {
  const res = await fetch(chrome.runtime.getURL(`_locales/${lang}/messages.json`));
  const raw = await res.json();
  return Object.fromEntries(Object.entries(raw).map(([key, { message }]) => [key, message]));
}

// Loads the user's language ("auto" or a code). Returns the language in use.
export async function initI18n(pref) {
  try {
    if (pref === undefined) ({ language: pref } = await chrome.storage.local.get({ language: "auto" }));
    const lang = resolveLanguage(pref, chrome.i18n?.getUILanguage?.());
    english = await loadMessages("en");
    messages = lang === "en" ? english : await loadMessages(lang);
    current = lang;
  } catch (err) {
    console.warn("GhostBrowse: could not load translations", err);
  }
  return current;
}

// Used by tests and tools that load the message files themselves.
export function setMessages(lang, dict, fallback = dict) {
  current = lang;
  messages = dict;
  english = fallback;
}

export const language = () => current;
export const isRtl = () => RTL.has(current);
export const locale = () => (current === "ur" ? "ur-PK" : "en");

export function t(key, ...args) {
  const message = messages[key] ?? english[key];
  if (message === undefined) return key;
  return message.replace(/\$(\d)/g, (_, n) => String(args[n - 1] ?? ""));
}

export function formatNumber(n) {
  return Number(n).toLocaleString(locale());
}

export function tn(count, key, ...args) {
  return t(`${key}_${count === 1 ? "one" : "other"}`, formatNumber(count), ...args);
}

// ---------- Pages ----------

// Fills text with a few safe inline tags (<code>, <strong>, <em>, <kbd>) without
// using innerHTML, so even a broken translation cannot inject markup.
export function setRichText(el, text) {
  const parts = String(text).split(/(<(code|strong|em|kbd)>.*?<\/\2>)/s);
  const nodes = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const tag = parts[i + 1];
    const match = tag && /^<(\w+)>(.*)<\/\1>$/s.exec(part);
    if (match) {
      const node = document.createElement(match[1]);
      node.textContent = match[2];
      nodes.push(node);
      i++;   // skip the captured tag name
    } else if (part) {
      nodes.push(document.createTextNode(part));
    }
  }
  el.replaceChildren(...nodes);
}

// Translates a page: data-i18n (text), data-i18n-rich (text with inline tags),
// and data-i18n-placeholder / -title / -aria-label (attributes).
export function localizePage(root = document) {
  document.documentElement.lang = current;
  document.documentElement.dir = isRtl() ? "rtl" : "ltr";
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-rich]")) setRichText(el, t(el.dataset.i18nRich));
  for (const attr of ["placeholder", "title", "aria-label"]) {
    const data = "i18n" + attr.replace(/(^|-)(\w)/g, (_, _d, c) => c.toUpperCase());
    for (const el of root.querySelectorAll(`[data-i18n-${attr}]`)) el.setAttribute(attr, t(el.dataset[data]));
  }
}
