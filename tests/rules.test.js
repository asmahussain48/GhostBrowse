import { describe, it, expect } from "vitest";
import {
  normalizeDomain,
  parseDomainList,
  matchesDomain,
  shouldHide,
  shouldHideDownload,
  isWebUrl,
  normalizeKeyword,
  parseKeywordList,
  matchesKeyword
} from "../lib/rules.js";

const base = { keepList: [], hideList: [], ruleMode: "hideAll", ghostSession: null };
const rules = (patch) => ({ ...base, ...patch });

describe("normalizeDomain", () => {
  it.each([
    ["example.com", "example.com"],
    ["  Example.COM  ", "example.com"],
    ["www.example.com", "example.com"],
    ["https://www.example.com/some/page?q=1#top", "example.com"],
    ["http://example.com:8080", "example.com"],
    ["example.com:8080/path", "example.com"],
    ["mail.google.com", "mail.google.com"],
    ["*.reddit.com", "reddit.com"],
    [".reddit.com", "reddit.com"],
    ["example.com.", "example.com"],
    ["localhost", "localhost"],
    ["localhost:3000", "localhost"],
    ["192.168.1.10", "192.168.1.10"],
    ["münchen.de", "xn--mnchen-3ya.de"]
  ])("%s -> %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each(["", "   ", "youtube", "not a domain", "chrome://settings", "file:///C:/x.html", "ftp://example.com", null, 42])(
    "rejects %s",
    (input) => {
      expect(normalizeDomain(input)).toBe("");
    }
  );
});

describe("parseDomainList", () => {
  it("splits on commas, spaces and newlines, normalizes, and removes duplicates", () => {
    expect(parseDomainList("gmail.com, https://github.com/explore\nwww.gmail.com;bad")).toEqual({
      valid: ["gmail.com", "github.com"],
      invalid: ["bad"]
    });
  });

  it("handles empty input", () => {
    expect(parseDomainList("")).toEqual({ valid: [], invalid: [] });
    expect(parseDomainList(undefined)).toEqual({ valid: [], invalid: [] });
  });
});

describe("matchesDomain", () => {
  it("matches the exact domain", () => {
    expect(matchesDomain("google.com", ["google.com"])).toBe(true);
  });

  it("matches subdomains", () => {
    expect(matchesDomain("mail.google.com", ["google.com"])).toBe(true);
    expect(matchesDomain("a.b.google.com", ["google.com"])).toBe(true);
  });

  it("does not match look-alike domains", () => {
    expect(matchesDomain("notgoogle.com", ["google.com"])).toBe(false);
    expect(matchesDomain("google.com.evil.net", ["google.com"])).toBe(false);
    expect(matchesDomain("google.co", ["google.com"])).toBe(false);
  });

  it("does not match a parent of a listed subdomain", () => {
    expect(matchesDomain("google.com", ["mail.google.com"])).toBe(false);
  });

  it("ignores www. and letter case on both sides", () => {
    expect(matchesDomain("WWW.Google.COM", ["google.com"])).toBe(true);
    expect(matchesDomain("google.com", ["www.GOOGLE.com"])).toBe(true);
  });

  it("ignores a trailing dot", () => {
    expect(matchesDomain("google.com.", ["google.com"])).toBe(true);
  });

  it("never matches with an empty list or empty entries", () => {
    expect(matchesDomain("google.com", [])).toBe(false);
    expect(matchesDomain("google.com", ["", "  "])).toBe(false);
    expect(matchesDomain("google.com", undefined)).toBe(false);
    expect(matchesDomain("", ["google.com"])).toBe(false);
  });
});

describe("shouldHide", () => {
  it("hides everything in hideAll mode", () => {
    expect(shouldHide("https://example.com/", rules())).toBe(true);
  });

  it("keeps sites on the Keep list, including subdomains", () => {
    const s = rules({ keepList: ["github.com", "google.com"] });
    expect(shouldHide("https://github.com/explore", s)).toBe(false);
    expect(shouldHide("https://mail.google.com/mail/u/0/", s)).toBe(false);
    expect(shouldHide("https://notgoogle.com/", s)).toBe(true);
  });

  it("only hides the Hide list in hideListed mode", () => {
    const s = rules({ ruleMode: "hideListed", hideList: ["youtube.com"] });
    expect(shouldHide("https://www.youtube.com/watch?v=1", s)).toBe(true);
    expect(shouldHide("https://m.youtube.com/", s)).toBe(true);
    expect(shouldHide("https://en.wikipedia.org/wiki/Ghost", s)).toBe(false);
  });

  it("hides nothing in hideListed mode with an empty Hide list", () => {
    expect(shouldHide("https://youtube.com/", rules({ ruleMode: "hideListed" }))).toBe(false);
  });

  it("lets the Keep list win over the Hide list", () => {
    const s = rules({ ruleMode: "hideListed", hideList: ["google.com"], keepList: ["mail.google.com"] });
    expect(shouldHide("https://mail.google.com/", s)).toBe(false);
    expect(shouldHide("https://www.google.com/search?q=x", s)).toBe(true);
  });

  it("hides everything during a Ghost Session, except the Keep list", () => {
    const s = rules({ ruleMode: "hideListed", hideList: [], keepList: ["gmail.com"], ghostSession: { start: 1 } });
    expect(shouldHide("https://wikipedia.org/", s)).toBe(true);
    expect(shouldHide("https://gmail.com/", s)).toBe(false);
  });

  it("matches URLs with ports", () => {
    expect(shouldHide("http://example.com:8080/x", rules({ keepList: ["example.com"] }))).toBe(false);
  });

  it.each([
    "chrome://settings",
    "chrome-extension://abc/popup.html",
    "file:///C:/Users/me/doc.html",
    "about:blank",
    "data:text/html,hi",
    "not a url",
    "",
    undefined
  ])("ignores %s", (url) => {
    expect(shouldHide(url, rules())).toBe(false);
  });
});

describe("keywords", () => {
  it("normalizes case and separators", () => {
    expect(normalizeKeyword("  Job   Search ")).toBe("job search");
    expect(normalizeKeyword("job-search")).toBe("job search");
    expect(normalizeKeyword("job_search")).toBe("job search");
  });

  it("rejects keywords that are too short or too long", () => {
    expect(normalizeKeyword("ab")).toBe("");
    expect(normalizeKeyword("   ")).toBe("");
    expect(normalizeKeyword("x".repeat(61))).toBe("");
    expect(normalizeKeyword(42)).toBe("");
  });

  it("splits only on commas, semicolons and new lines, keeping phrases whole", () => {
    expect(parseKeywordList("salary, Job Search;medical\nab, salary")).toEqual({
      valid: ["salary", "job search", "medical"],
      invalid: ["ab"]
    });
  });

  it.each([
    ["https://www.google.com/search?q=salary+negotiation", "salary"],
    ["https://www.google.com/search?q=job+search+tips", "job search"],
    ["https://example.com/job-search/london", "job search"],
    ["https://example.com/job_search", "job search"],
    ["https://example.com/a?q=job%20search", "job search"],
    ["https://example.com/Medical-Records", "medical"],
    ["https://medical.example.org/", "medical"],
    ["https://example.com/page#salary", "salary"],
    ["https://example.com/%E2%9C%93-salary", "salary"]
  ])("%s contains %j", (url, keyword) => {
    expect(matchesKeyword(url, [keyword])).toBe(true);
  });

  it("does not match unrelated pages", () => {
    expect(matchesKeyword("https://example.com/weather", ["salary", "medical"])).toBe(false);
    expect(matchesKeyword("https://example.com/jobs", ["job search"])).toBe(false);
  });

  it("survives malformed percent-escapes", () => {
    expect(matchesKeyword("https://example.com/%E0%A4%A-salary", ["salary"])).toBe(true);
  });

  it("ignores non-web URLs, empty lists and invalid entries", () => {
    expect(matchesKeyword("file:///C:/salary.pdf", ["salary"])).toBe(false);
    expect(matchesKeyword("https://example.com/salary", [])).toBe(false);
    expect(matchesKeyword("https://example.com/salary", undefined)).toBe(false);
    expect(matchesKeyword("https://example.com/salary", ["", "ab"])).toBe(false);
  });

  it("hide keywords in hideListed mode, on any site", () => {
    const s = rules({ ruleMode: "hideListed", hideList: ["youtube.com"], keywords: ["salary"] });
    expect(shouldHide("https://www.google.com/search?q=salary", s)).toBe(true);
    expect(shouldHide("https://www.youtube.com/", s)).toBe(true);
    expect(shouldHide("https://www.google.com/search?q=weather", s)).toBe(false);
  });

  it("the Keep list still wins over keywords", () => {
    const s = rules({ ruleMode: "hideListed", keepList: ["intranet.example.com"], keywords: ["salary"] });
    expect(shouldHide("https://intranet.example.com/salary-review", s)).toBe(false);
  });

  it("apply to downloads by file URL or linking page", () => {
    const s = rules({ ruleMode: "hideListed", keywords: ["payslip"] });
    expect(shouldHideDownload({ url: "https://hr.example.com/files/payslip-march.pdf" }, s)).toBe(true);
    expect(shouldHideDownload({ url: "https://cdn.example.com/f.pdf", referrer: "https://hr.example.com/payslip" }, s)).toBe(true);
    expect(shouldHideDownload({ url: "https://cdn.example.com/f.pdf" }, s)).toBe(false);
  });
});

describe("isWebUrl", () => {
  it("accepts only http and https", () => {
    expect(isWebUrl("https://a.com")).toBe(true);
    expect(isWebUrl("http://a.com")).toBe(true);
    expect(isWebUrl("chrome://newtab")).toBe(false);
    expect(isWebUrl("ftp://a.com")).toBe(false);
    expect(isWebUrl(null)).toBe(false);
  });
});

describe("shouldHideDownload", () => {
  const download = (patch) => ({ url: "https://cdn.example.net/file.zip", finalUrl: "", referrer: "", ...patch });

  it("hides downloads in hideAll mode", () => {
    expect(shouldHideDownload(download(), rules())).toBe(true);
  });

  it("keeps a download when the file or the linking page is on the Keep list", () => {
    const s = rules({ keepList: ["github.com"] });
    expect(shouldHideDownload(download({ url: "https://github.com/x.zip" }), s)).toBe(false);
    expect(shouldHideDownload(download({ referrer: "https://github.com/releases" }), s)).toBe(false);
  });

  it("in hideListed mode, hides only downloads linked to a hidden site", () => {
    const s = rules({ ruleMode: "hideListed", hideList: ["example.org"] });
    expect(shouldHideDownload(download({ referrer: "https://example.org/page" }), s)).toBe(true);
    expect(shouldHideDownload(download(), s)).toBe(false);
  });

  it("hides blob: and data: downloads in hideAll mode", () => {
    expect(shouldHideDownload(download({ url: "blob:https://a.com/123" }), rules())).toBe(true);
  });
});
