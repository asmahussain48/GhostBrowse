// Optional settings lock. The PIN is stored only as a salted SHA-256 hash.
// This deters casual snooping on a shared computer; it is not strong security,
// since anyone with DevTools access to the extension can clear its storage.

export const PIN_PATTERN = /^\d{4,6}$/;

const TRIES_PER_ROUND = 5;
const BASE_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 15 * 60_000;

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hashPin(salt, pin) {
  return sha256(salt + pin);
}

export async function hasPin() {
  const { pinHash } = await chrome.storage.local.get({ pinHash: null });
  return Boolean(pinHash);
}

export async function setPin(pin) {
  if (!PIN_PATTERN.test(pin)) throw new Error("pinInvalid");
  const salt = crypto.randomUUID();
  await chrome.storage.local.set({
    pinSalt: salt,
    pinHash: await hashPin(salt, pin),
    pinFails: 0,
    pinLockedUntil: 0
  });
}

export async function clearPin() {
  await chrome.storage.local.set({ pinSalt: null, pinHash: null, pinFails: 0, pinLockedUntil: 0 });
}

export async function checkPin(pin) {
  const { pinSalt, pinHash } = await chrome.storage.local.get({ pinSalt: null, pinHash: null });
  if (!pinHash) return true;
  return (await hashPin(pinSalt, String(pin))) === pinHash;
}

// Milliseconds until another attempt is allowed (0 when not locked out).
export async function lockoutRemaining(now = Date.now()) {
  const { pinLockedUntil } = await chrome.storage.local.get({ pinLockedUntil: 0 });
  return Math.max(0, pinLockedUntil - now);
}

// checkPin with throttling: every 5 wrong PINs locks input for 30 s, doubling
// each round up to 15 min. The counter is stored, so closing the page does not reset it.
export async function tryUnlock(pin, now = Date.now()) {
  const { pinFails, pinLockedUntil } = await chrome.storage.local.get({ pinFails: 0, pinLockedUntil: 0 });
  if (pinLockedUntil > now) return { ok: false, retryAfterMs: pinLockedUntil - now, triesLeft: 0 };

  if (await checkPin(pin)) {
    if (pinFails) await chrome.storage.local.set({ pinFails: 0, pinLockedUntil: 0 });
    return { ok: true, retryAfterMs: 0, triesLeft: TRIES_PER_ROUND };
  }

  const fails = pinFails + 1;
  let lockedUntil = 0;
  if (fails % TRIES_PER_ROUND === 0) {
    const round = fails / TRIES_PER_ROUND;
    lockedUntil = now + Math.min(BASE_LOCKOUT_MS * 2 ** (round - 1), MAX_LOCKOUT_MS);
  }
  await chrome.storage.local.set({ pinFails: fails, pinLockedUntil: lockedUntil });
  return {
    ok: false,
    retryAfterMs: lockedUntil ? lockedUntil - now : 0,
    triesLeft: lockedUntil ? 0 : TRIES_PER_ROUND - (fails % TRIES_PER_ROUND)
  };
}
