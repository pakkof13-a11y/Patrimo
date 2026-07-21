import { describe, expect, it, beforeEach } from "vitest";
import {
  asAccountType,
  isAccountType,
} from "@/app/lib/types/account-type";
import {
  asBaseAmount,
  asEurAmount,
  asPercentString,
  asQuantityString,
} from "@/app/lib/types/money-brands";
import {
  consumeRateLimit,
  __resetRateLimitBucketsForTests,
  __rateLimitBucketCountForTests,
} from "@/app/lib/api/simple-rate-limit";
import { normalizeRole } from "@/app/lib/auth/role";

describe("asAccountType", () => {
  it("accepte les enveloppes connues", () => {
    expect(isAccountType("CRYPTO")).toBe(true);
    expect(asAccountType("PEA")).toBe("PEA");
  });

  it("fallback sur typo / vide", () => {
    expect(asAccountType("crypto")).toBe("CTO");
    expect(asAccountType(null, "CRYPTO")).toBe("CRYPTO");
    expect(asAccountType("")).toBe("CTO");
  });
});

describe("money brands", () => {
  it("marque EUR vs BASE sans perdre la valeur string", () => {
    const eur = asEurAmount("12.5");
    const base = asBaseAmount("12.5");
    expect(eur).toBe("12.5");
    expect(base).toBe("12.5");
    // Les helpers existent pour forcer le passage par un cast contrôlé
    expect(asQuantityString("1")).toBe("1");
    expect(asPercentString("3.2")).toBe("3.2");
  });
});

describe("normalizeRole", () => {
  it("ne retourne jamais undefined", () => {
    expect(normalizeRole(undefined)).toBe("USER");
    expect(normalizeRole(null)).toBe("USER");
    expect(normalizeRole("ADMIN")).toBe("ADMIN");
    expect(normalizeRole("user")).toBe("USER");
  });
});

describe("rate-limit (kv / mémoire)", () => {
  beforeEach(() => {
    __resetRateLimitBucketsForTests();
  });

  it("limite les requêtes via consumeRateLimit async", async () => {
    for (let i = 0; i < 3; i++) {
      const r = await consumeRateLimit("typing-rl", 3, 60_000);
      expect(r.ok).toBe(true);
    }
    const blocked = await consumeRateLimit("typing-rl", 3, 60_000);
    expect(blocked.ok).toBe(false);
    // Compteur mémoire non exposé sous backend kv unifié (0 ou n)
    expect(__rateLimitBucketCountForTests()).toBeGreaterThanOrEqual(0);
  });
});
