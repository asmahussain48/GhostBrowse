# Chrome Web Store listing

Everything the Chrome Web Store developer dashboard asks for, ready to paste.
Images are in this folder; regenerate them with `npm run store-assets`.

## Package

Upload `dist/ghostbrowse-<version>.zip`, built with `npm run package`.

## Store listing tab

**Name:** GhostBrowse

**Summary** (132 characters max):

> Automatically removes your browsing history while keeping you logged in. Keep lists, Ghost Sessions, no data collection.

**Category:** Privacy & Security

**Language:** English (the extension also includes Urdu)

**Description:**

> GhostBrowse removes the pages you visit from Chrome's history automatically, without signing you out of anything. You stay logged in to Gmail, Facebook, your bank or your university portal, and your history page stays clean.
>
> Built for shared computers at home, in offices, labs and libraries.
>
> HOW IT WORKS
> • Choose when history is removed: immediately, when the tab closes, every few minutes, or the next time Chrome starts.
> • Keep list: sites that always stay in history (for example your university portal).
> • Or hide only the sites and keywords you choose.
> • Ghost Session: everything you visit is removed right away, with a final sweep at the end. Schedule it, for example weekdays 9–5 on an office PC.
> • The toolbar popup shows what will happen to the site you are on, with one-click Keep, Hide and Forget.
> • Rule profiles such as Study and Personal.
> • Clean Now and Clean range (last hour, today, last 7 days, all time).
> • Optional: also clear the download list and the cache.
> • Keyboard shortcuts, settings backup, PIN lock for the settings, English and Urdu.
>
> WHAT IT KEEPS
> Cookies, logins, saved passwords, autofill, bookmarks and site data are never touched. GhostBrowse does not even ask for permission to read cookies.
>
> PRIVACY
> • No data collection, no network requests, no analytics.
> • Removed URLs are never stored; only counts are kept.
> • Everything stays on your device.
>
> HONEST LIMITS
> Websites you are logged in to still record your activity in your account, and network administrators can still see traffic. GhostBrowse cleans the local browser only. The Help page lists every limitation.

**Screenshots** (1280×800): `screenshots/1-popup.png` … `screenshots/5-urdu.png`

**Small promo tile** (440×280): `promo-small-440x280.png`

**Marquee promo tile** (1400×560, optional): `promo-marquee-1400x560.png`

**Store icon** (128×128): `../icons/icon128.png`

## Privacy practices tab

**Single purpose:**

> GhostBrowse automatically removes visited pages from the local browser history according to the user's rules, while leaving login sessions and other browser data untouched.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `history` | Core feature: reading and deleting entries in the browser history according to the user's rules. |
| `storage` | Saving the user's settings, site lists and removal counters on the device. |
| `alarms` | Running scheduled cleanups (Interval mode) and starting and ending Scheduled Ghost Sessions at set times. |
| `tabs` | "When tab closes" mode must know which pages each tab visited, and the popup shows the site of the current tab. |
| `downloads` (optional) | Only if the user turns on "Download history" cleaning: erasing entries from the download list. Files on disk are not touched. |
| `browsingData` (optional) | Only if the user turns on "Cache" or "Recently closed tabs" cleaning: clearing the cache, or clearing Chrome's list of recently closed tabs (which Chrome only clears together with recent history; kept pages are added back). Cookies and other data are not touched. |

**Remote code:** No, I am not using remote code. All code is included in the package.

**Data usage:** GhostBrowse does not collect or transmit any user data. Tick none of the data types. Certify that:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** publish `PRIVACY.md` somewhere public (for example the project's GitHub page) and paste its address.

## Before submitting

1. Bump `version` in `manifest.json` and `package.json`.
2. `npm test` and `npm run test:e2e` pass.
3. `npm run package` and upload the zip.
4. Developer account: one-time registration fee, paid by the publisher.
