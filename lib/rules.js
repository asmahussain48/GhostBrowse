// Site rules: decides which URLs GhostBrowse removes.
// Pure functions with no chrome.* calls, so they can be unit-tested in Node.

const WEB_PROTOCOLS = new Set(["http:", "https:"]);

// Returns a URL object for http(s) URLs, null for anything else (chrome://, file://, invalid).
function parseWebUrl(url) {
  if (typeof url !== "string" || url === "") return null;
  try {
    const u = new URL(url);
    return WEB_PROTOCOLS.has(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

function cleanHost(host) {
  return host.toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

export function isWebUrl(url) {
  return parseWebUrl(url) !== null;
}

// The site of a web URL without "www.", or "" for anything else.
export function hostOf(url) {
  const u = parseWebUrl(url);
  return u ? cleanHost(u.hostname) : "";
}

// Turns user input such as "https://www.Example.com:8080/page" into "example.com".
// Returns "" when the input is not a usable domain.
export function normalizeDomain(input) {
  if (typeof input !== "string") return "";
  let s = input.trim().toLowerCase().replace(/^\*?\.+/, "");
  if (!s) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = "http://" + s;

  const u = parseWebUrl(s);
  if (!u) return "";
  const host = cleanHost(u.hostname);
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");
  if (!host || (host !== "localhost" && !isIp && !host.includes("."))) return "";
  return host;
}

// Splits pasted text ("a.com, b.com\nc.com") into normalized domains.
export function parseDomainList(text) {
  const valid = [];
  const invalid = [];
  for (const part of String(text ?? "").split(/[\s,;]+/)) {
    if (!part) continue;
    const d = normalizeDomain(part);
    if (!d) invalid.push(part);
    else if (!valid.includes(d)) valid.push(d);
  }
  return { valid, invalid };
}

// Keywords are compared loosely: case, spaces, "+", "-" and "_" are all treated
// alike, so "job search" also matches "job-search", "job_search" and "job+search".
const SEPARATORS = /[\s+_-]+/g;
const MIN_KEYWORD = 3;
const MAX_KEYWORD = 60;

export function normalizeKeyword(input) {
  if (typeof input !== "string") return "";
  const k = input.toLowerCase().replace(SEPARATORS, " ").trim();
  return k.length >= MIN_KEYWORD && k.length <= MAX_KEYWORD ? k : "";
}

// Splits pasted text ("salary, medical\njob search") into keywords.
// Only commas, semicolons and new lines separate keywords, so phrases stay whole.
export function parseKeywordList(text) {
  const valid = [];
  const invalid = [];
  for (const part of String(text ?? "").split(/[,;\n]+/)) {
    if (!part.trim()) continue;
    const k = normalizeKeyword(part);
    if (!k) invalid.push(part.trim());
    else if (!valid.includes(k)) valid.push(k);
  }
  return { valid, invalid };
}

// The searchable text of a URL: host, path, query and fragment, percent-decoded.
function urlText(u) {
  const raw = (u.hostname + u.pathname + u.search + u.hash).replace(/\+/g, " ");
  let text = raw;
  try {
    text = decodeURIComponent(raw);
  } catch {
    // Malformed %-escapes: match against the raw text instead.
  }
  return text.toLowerCase().replace(SEPARATORS, " ");
}

// True when the page address contains any of the keywords.
export function matchesKeyword(url, keywords) {
  if (!Array.isArray(keywords) || keywords.length === 0) return false;
  const u = typeof url === "string" ? parseWebUrl(url) : url;
  if (!u) return false;
  const text = urlText(u);
  return keywords.some((entry) => {
    const k = normalizeKeyword(entry);
    return k !== "" && text.includes(k);
  });
}

// True when hostname is one of the listed domains or a subdomain of one.
// "mail.google.com" matches "google.com"; "notgoogle.com" does not.
export function matchesDomain(hostname, list) {
  if (!hostname || !Array.isArray(list) || list.length === 0) return false;
  const host = cleanHost(hostname);
  return list.some((entry) => {
    const d = typeof entry === "string" ? cleanHost(entry.trim()) : "";
    return d !== "" && (host === d || host.endsWith("." + d));
  });
}

export function shouldHide(url, s) {
  const u = parseWebUrl(url);
  if (!u) return false;
  if (matchesDomain(u.hostname, s.keepList)) return false;   // Keep always wins
  if (s.ghostSession) return true;                           // Ghost Session hides all
  if (s.ruleMode === "hideListed") {
    return matchesDomain(u.hostname, s.hideList) || matchesKeyword(u, s.keywords);
  }
  return true;                                               // hideAll
}

// Download entries are judged by every site involved: the file URL, where it
// finally came from, and the page that linked to it.
export function shouldHideDownload(item, s) {
  const urls = [item.finalUrl, item.url, item.referrer].map(parseWebUrl).filter(Boolean);
  if (urls.some((u) => matchesDomain(u.hostname, s.keepList))) return false;
  if (s.ghostSession) return true;
  if (s.ruleMode === "hideListed") {
    return urls.some((u) => matchesDomain(u.hostname, s.hideList) || matchesKeyword(u, s.keywords));
  }
  return true;
}
