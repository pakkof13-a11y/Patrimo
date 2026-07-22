import { describe, expect, it } from "vitest";
import {
  buildEconomicFingerprint,
  buildStrictFingerprint,
  classifyAgainstExisting,
  indexExistingTransactions,
  normalizeImportInstant,
  normalizeImportNumber,
} from "@/app/lib/import/dedupe";
import { toIsoLocal } from "@/app/lib/import/normalize";

describe("import dedupe fingerprints", () => {
  const base = {
    platformId: "plat-1",
    type: "ACHAT",
    occurredAt: "2024-03-10T12:00:00.000Z",
    ticker: "MC.PA",
    quantity: "8",
    unitPrice: "612.5",
    cashAmount: null as string | null,
    fees: "12.5",
    currency: "EUR",
  };

  it("strict fingerprint is stable for same second", () => {
    const a = buildStrictFingerprint(base);
    const b = buildStrictFingerprint({
      ...base,
      unitPrice: "612,5",
      quantity: "8.000",
      fees: "12.50",
    });
    expect(a).toBe(b);
  });

  it("strict differs when second changes; economic stays same", () => {
    const a = buildStrictFingerprint(base);
    const b = buildStrictFingerprint({
      ...base,
      occurredAt: "2024-03-10T12:00:45.123Z",
    });
    expect(a).not.toBe(b);
    expect(buildEconomicFingerprint(base)).toBe(
      buildEconomicFingerprint({
        ...base,
        occurredAt: "2024-03-10T12:00:45.123Z",
      })
    );
  });

  it("classifies near timestamps as suspect", () => {
    const existing = indexExistingTransactions("plat-1", [
      {
        id: "tx1",
        type: "ACHAT",
        occurredAt: new Date("2024-03-10T12:00:00.000Z"),
        quantity: "8",
        unitPrice: "612.5",
        fees: "12.5",
        currency: "EUR",
        ticker: "MC.PA",
      },
    ]);
    const match = classifyAgainstExisting(
      {
        ...base,
        occurredAt: "2024-03-10T12:02:00.000Z",
      },
      existing.byStrict,
      existing.byEconomic
    );
    expect(match?.kind).toBe("suspect");
    expect(match?.existing.id).toBe("tx1");
  });

  it("classifies exact second as strict", () => {
    const existing = indexExistingTransactions("plat-1", [
      {
        id: "tx1",
        type: "ACHAT",
        occurredAt: new Date("2024-03-10T12:00:00.000Z"),
        quantity: "8",
        unitPrice: "612.5",
        fees: "12.5",
        currency: "EUR",
        ticker: "MC.PA",
      },
    ]);
    const match = classifyAgainstExisting(
      base,
      existing.byStrict,
      existing.byEconomic
    );
    expect(match?.kind).toBe("strict");
  });

  it("differs when quantity changes", () => {
    const a = buildStrictFingerprint(base);
    const b = buildStrictFingerprint({ ...base, quantity: "9" });
    expect(a).not.toBe(b);
  });

  it("normalize helpers", () => {
    expect(normalizeImportNumber("1 234,50")).toBe("1234.5");
    expect(normalizeImportInstant("2024-06-01T15:30:59.999Z")).toBe(
      "2024-06-01T15:30"
    );
  });

  it("matches when existing has null ticker (legacy APPORT without asset)", () => {
    const existing = indexExistingTransactions("plat-1", [
      {
        id: "tx-orphan",
        type: "APPORT",
        occurredAt: new Date("2026-06-22T10:51:00.000Z"),
        quantity: "1.989245",
        unitPrice: "0.08",
        fees: "0",
        currency: "EUR",
        ticker: null,
      },
    ]);
    // Draft after fix: Réception → REWARD + ticker ALGO
    // occurredAt local naïf (comme produit par toIsoLocal côté import CSV) —
    // dérivé du même instant que l'existing pour rester indépendant du TZ d'exécution.
    const match = classifyAgainstExisting(
      {
        platformId: "plat-1",
        type: "REWARD",
        occurredAt: toIsoLocal(new Date("2026-06-22T10:51:00.000Z")),
        ticker: "ALGO",
        quantity: "1.989245",
        unitPrice: "0.08",
        cashAmount: null,
        fees: "0",
        currency: "EUR",
      },
      existing.byStrict,
      existing.byEconomic
    );
    expect(match?.kind).toBe("strict");
    expect(match?.existing.id).toBe("tx-orphan");
  });

  it("matches draft with ticker vs existing empty ticker same type", () => {
    const existing = indexExistingTransactions("plat-1", [
      {
        id: "tx-a",
        type: "APPORT",
        occurredAt: new Date("2026-06-22T10:51:00.000Z"),
        quantity: "1.989245",
        unitPrice: "0.08",
        fees: "0",
        currency: "EUR",
        ticker: null,
      },
    ]);
    const match = classifyAgainstExisting(
      {
        platformId: "plat-1",
        type: "APPORT",
        occurredAt: "2026-06-22T10:51:00.000Z",
        ticker: "ALGO",
        quantity: "1.989245",
        unitPrice: "0.08",
        cashAmount: "0.15",
        fees: "0",
        currency: "EUR",
      },
      existing.byStrict,
      existing.byEconomic
    );
    expect(match?.kind).toBe("strict");
  });
});
