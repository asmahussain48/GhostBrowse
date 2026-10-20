import { describe, it, expect, beforeEach } from "vitest";
import { createChrome } from "./helpers/chrome-mock.js";
import { setPin, clearPin, checkPin, hasPin, tryUnlock, lockoutRemaining, hashPin } from "../lib/pin.js";

let chrome;

beforeEach(() => {
  chrome = createChrome();
  globalThis.chrome = chrome;
});

describe("PIN lock", () => {
  it("allows everything when no PIN is set", async () => {
    expect(await hasPin()).toBe(false);
    expect(await checkPin("anything")).toBe(true);
  });

  it("stores a salted hash, never the PIN itself", async () => {
    await setPin("4821");
    const stored = JSON.stringify(chrome._state.local);
    expect(stored).not.toContain("4821");
    const { pinSalt, pinHash } = chrome._state.local;
    expect(pinHash).toMatch(/^[0-9a-f]{64}$/);
    expect(pinHash).toBe(await hashPin(pinSalt, "4821"));
  });

  it("uses a new salt each time, so equal PINs give different hashes", async () => {
    await setPin("4821");
    const first = chrome._state.local.pinHash;
    await setPin("4821");
    expect(chrome._state.local.pinHash).not.toBe(first);
  });

  it("accepts the right PIN and rejects a wrong one", async () => {
    await setPin("123456");
    expect(await hasPin()).toBe(true);
    expect(await checkPin("123456")).toBe(true);
    expect(await checkPin("123457")).toBe(false);
    expect(await checkPin("")).toBe(false);
  });

  it.each(["123", "1234567", "12a4", "", "12 34"])("rejects invalid PIN %j", async (pin) => {
    await expect(setPin(pin)).rejects.toThrow();
  });

  it("removes the PIN", async () => {
    await setPin("1234");
    await clearPin();
    expect(await hasPin()).toBe(false);
    expect(await checkPin("0000")).toBe(true);
  });
});

describe("tryUnlock throttling", () => {
  beforeEach(() => setPin("2468"));

  it("unlocks with the right PIN", async () => {
    expect(await tryUnlock("2468")).toMatchObject({ ok: true });
  });

  it("counts down tries, then locks out for 30 seconds", async () => {
    const now = 1_000_000;
    for (let i = 1; i <= 4; i++) {
      expect(await tryUnlock("0000", now)).toEqual({ ok: false, retryAfterMs: 0, triesLeft: 5 - i });
    }
    expect(await tryUnlock("0000", now)).toEqual({ ok: false, retryAfterMs: 30_000, triesLeft: 0 });

    // Even the right PIN is refused while locked out.
    expect(await tryUnlock("2468", now + 10_000)).toMatchObject({ ok: false, retryAfterMs: 20_000 });
    expect(await lockoutRemaining(now + 10_000)).toBe(20_000);

    // After the lockout the right PIN works and resets the counter.
    expect(await tryUnlock("2468", now + 30_001)).toMatchObject({ ok: true });
    expect(chrome._state.local.pinFails).toBe(0);
  });

  it("doubles the lockout each round", async () => {
    let now = 1_000_000;
    for (let i = 0; i < 5; i++) await tryUnlock("0000", now);
    now += 30_001;
    for (let i = 0; i < 4; i++) await tryUnlock("0000", now);
    expect(await tryUnlock("0000", now)).toMatchObject({ retryAfterMs: 60_000 });
  });
});
