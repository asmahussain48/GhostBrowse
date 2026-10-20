# GhostBrowse Privacy Policy

*Last updated: October 20, 2026*

GhostBrowse is a Chrome extension that removes visited pages from your local browser history while leaving your logins untouched. It is built to protect your privacy, so it is designed to know as little about you as possible.

## What GhostBrowse collects

**Nothing.** GhostBrowse does not collect, transmit, or sell any data. It makes no network requests of any kind.

## What GhostBrowse stores on your device

Everything below is saved with `chrome.storage.local` on your own computer and never leaves it:

- Your settings: cleanup mode, interval, rule mode, and the optional trace-cleaning switches.
- Your Keep list and Hide list (domain names you entered), your Hide keywords, and any rule profiles you saved.
- Your Ghost Session schedule and your language choice.
- Counters: how many history entries were removed today and in total, and when the last cleanup ran.
- If you set a PIN: a salted SHA-256 hash of it. The PIN itself is never stored.

**Removed URLs are never stored**, logged, or displayed.

While Chrome is running, GhostBrowse keeps a temporary list of the pages open in each tab in `chrome.storage.session`. This is needed for the "When tab closes" mode. It is held in memory only, never written to disk, and is cleared as tabs close and whenever Chrome exits.

## Settings backups

If you use **Export to file**, GhostBrowse creates a JSON file with your settings, lists, keywords, profiles and schedule and saves it through Chrome's normal download, to a location you control. It is never uploaded anywhere. The file does not include your PIN or statistics. Because it names the sites and words you chose, keep it private.

## What GhostBrowse does not touch

GhostBrowse does not read, modify, or delete cookies, passwords, form data, or website storage. It does not request the `cookies` permission or access to website content.

## Permissions

| Permission | Why it is needed |
|---|---|
| `history` | Read and delete history entries (the core feature) |
| `storage` | Save settings, lists, and counters on your device |
| `alarms` | Run interval cleanups and start and end Scheduled Ghost Sessions |
| `tabs` | Know which pages a tab visited, for "When tab closes" mode, and show the current site in the popup |
| `downloads` *(optional)* | Remove entries from the download list, only if you turn this on |
| `browsingData` *(optional)* | Clear the cache, only if you turn this on |

## Removing your data

Uninstalling GhostBrowse deletes all data it has stored.

## Contact

Questions about this policy can be raised on the project's issue tracker.
