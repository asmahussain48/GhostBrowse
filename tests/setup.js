// Runs before every test file.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { setMessages } from "../lib/i18n.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

export function loadLocale(lang) {
  const raw = JSON.parse(readFileSync(`${ROOT}_locales/${lang}/messages.json`, "utf8"));
  return Object.fromEntries(Object.entries(raw).map(([key, { message }]) => [key, message]));
}

// Libraries imported directly by tests use English.
setMessages("en", loadLocale("en"));

// The extension loads its own files with fetch(chrome.runtime.getURL(...)).
// The chrome mock uses this origin, so serve those URLs from the project folder.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const prefix = "chrome-extension://ghostbrowse-test/";
  if (typeof url === "string" && url.startsWith(prefix)) {
    const text = readFileSync(ROOT + url.slice(prefix.length), "utf8");
    return new Response(text, { headers: { "content-type": "application/json" } });
  }
  return realFetch(url, init);
};
