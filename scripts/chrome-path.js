// Finds the installed Chrome for the end-to-end tests and store screenshots.
// Set CHROME_PATH to use a different browser.

import fs from "node:fs";
import { execSync } from "node:child_process";

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = {
    win32: [
      `${process.env.PROGRAMFILES}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
    ],
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
    linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"]
  }[process.platform] ?? [];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (found) return found;
  try {
    return execSync("which google-chrome chromium", { encoding: "utf8" }).split("\n")[0];
  } catch {
    throw new Error("Chrome not found. Set CHROME_PATH to the Chrome executable.");
  }
}
