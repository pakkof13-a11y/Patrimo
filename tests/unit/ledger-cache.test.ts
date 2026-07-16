import { describe, expect, it, beforeEach } from "vitest";
import {
  clearLedgerCacheAll,
  fingerprintKey,
  getCachedLedger,
  invalidateLedgerCache,
  ledgerCacheSize,
  ledgerCacheStats,
  setCachedLedger,
} from "@/app/lib/portfolio/ledger-cache";
import { createEmptyLedger } from "@/app/lib/accounting/ledger";

describe("ledger-cache", () => {
  beforeEach(() => {
    clearLedgerCacheAll();
  });

  it("fingerprintKey is stable", () => {
    expect(
      fingerprintKey({ count: 3, lastId: "abc", lastAt: "2024-01-01T00:00:00.000Z" })
    ).toBe("3|abc|2024-01-01T00:00:00.000Z");
  });

  it("miss then hit with same fingerprint", () => {
    const fp = { count: 1, lastId: "t1", lastAt: "2024-01-01T00:00:00.000Z" };
    const state = createEmptyLedger();
    expect(getCachedLedger("user-a", fp)).toBeNull();
    setCachedLedger("user-a", fp, state);
    expect(getCachedLedger("user-a", fp)).toBe(state);
    expect(ledgerCacheStats.hits).toBeGreaterThanOrEqual(1);
  });

  it("miss when fingerprint changes", () => {
    const fp1 = { count: 1, lastId: "t1", lastAt: "2024-01-01T00:00:00.000Z" };
    const fp2 = { count: 2, lastId: "t2", lastAt: "2024-01-02T00:00:00.000Z" };
    setCachedLedger("user-a", fp1, createEmptyLedger());
    expect(getCachedLedger("user-a", fp2)).toBeNull();
  });

  it("invalidate clears user entry", () => {
    const fp = { count: 0, lastId: null, lastAt: null };
    setCachedLedger("user-a", fp, createEmptyLedger());
    setCachedLedger("user-b", fp, createEmptyLedger());
    expect(ledgerCacheSize()).toBe(2);
    invalidateLedgerCache("user-a");
    expect(getCachedLedger("user-a", fp)).toBeNull();
    expect(getCachedLedger("user-b", fp)).not.toBeNull();
  });
});
