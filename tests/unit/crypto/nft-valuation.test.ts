import { describe, expect, it } from "vitest";
import { d } from "@/app/lib/money/decimal";
import {
  applyOwnershipShare,
  chooseNftValuation,
  isLastSaleReliable,
  isNftValuationStale,
  NFT_STALE_VALUATION_HOURS,
} from "@/app/lib/crypto/nft-valuation";

describe("chooseNftValuation — ordre de priorité", () => {
  it("cas 16 : une expertise manuelle active prévaut sur tout le reste", () => {
    const choice = chooseNftValuation({
      spamStatus: "CLEAN",
      manualAppraisal: { amountEur: d(1000) },
      lastSale: { amountEur: d(50), isFresh: true },
      floorPrice: { amountEur: d(30), isReliable: true },
      acquisitionCostEur: d(20),
    });
    expect(choice.method).toBe("APPRAISAL");
    expect(choice.amountEur?.toNumber()).toBe(1000);
    expect(choice.fallbackReason).toBeNull();
  });

  it("l'expertise manuelle prévaut même sur un spam confirmé (surcharge explicite de l'utilisateur)", () => {
    const choice = chooseNftValuation({
      spamStatus: "CONFIRMED_SPAM",
      manualAppraisal: { amountEur: d(5) },
      lastSale: null,
      floorPrice: null,
      acquisitionCostEur: null,
    });
    expect(choice.method).toBe("APPRAISAL");
    expect(choice.amountEur?.toNumber()).toBe(5);
  });

  it("cas 9/54 : un spam confirmé sans surcharge retombe à ZERO, jamais une valeur positive", () => {
    const choice = chooseNftValuation({
      spamStatus: "CONFIRMED_SPAM",
      manualAppraisal: null,
      lastSale: { amountEur: d(50), isFresh: true },
      floorPrice: { amountEur: d(30), isReliable: true },
      acquisitionCostEur: d(20),
    });
    expect(choice.method).toBe("ZERO");
    expect(choice.amountEur?.toNumber()).toBe(0);
    expect(choice.fallbackReason).toMatch(/spam confirmé/i);
  });

  it("cas 14 : une dernière vente fraîche est retenue avant le floor", () => {
    const choice = chooseNftValuation({
      spamStatus: "CLEAN",
      manualAppraisal: null,
      lastSale: { amountEur: d(120), isFresh: true },
      floorPrice: { amountEur: d(90), isReliable: true },
      acquisitionCostEur: d(80),
    });
    expect(choice.method).toBe("LAST_SALE");
    expect(choice.amountEur?.toNumber()).toBe(120);
    expect(choice.fallbackReason).toBeNull();
  });

  it("cas 15 : une dernière vente non fraîche/fiable ne bloque pas le repli sur le floor", () => {
    const choice = chooseNftValuation({
      spamStatus: "CLEAN",
      manualAppraisal: null,
      lastSale: { amountEur: d(9999), isFresh: false },
      floorPrice: { amountEur: d(90), isReliable: true },
      acquisitionCostEur: d(80),
    });
    expect(choice.method).toBe("FLOOR_PRICE");
    expect(choice.amountEur?.toNumber()).toBe(90);
    expect(choice.fallbackReason).toMatch(/périmée|non fiable/i);
  });

  it("cas 13 : un floor fiable est retenu en l'absence de vente exploitable", () => {
    const choice = chooseNftValuation({
      spamStatus: "CLEAN",
      manualAppraisal: null,
      lastSale: null,
      floorPrice: { amountEur: d(75), isReliable: true },
      acquisitionCostEur: d(60),
    });
    expect(choice.method).toBe("FLOOR_PRICE");
    expect(choice.fallbackReason).toBeNull();
  });

  it("cas 9 : sans floor ni vente, repli sur le coût d'acquisition", () => {
    const choice = chooseNftValuation({
      spamStatus: "CLEAN",
      manualAppraisal: null,
      lastSale: null,
      floorPrice: null,
      acquisitionCostEur: d(42),
    });
    expect(choice.method).toBe("ACQUISITION_COST_FALLBACK");
    expect(choice.amountEur?.toNumber()).toBe(42);
    expect(choice.fallbackReason).toMatch(/coût d'acquisition/i);
  });

  it("un floor non fiable est ignoré, retombe aussi sur le coût d'acquisition", () => {
    const choice = chooseNftValuation({
      spamStatus: "CLEAN",
      manualAppraisal: null,
      lastSale: null,
      floorPrice: { amountEur: d(999), isReliable: false },
      acquisitionCostEur: d(42),
    });
    expect(choice.method).toBe("ACQUISITION_COST_FALLBACK");
  });

  it("cas 17 : sans aucune source, la valorisation est UNKNOWN — jamais inventée", () => {
    const choice = chooseNftValuation({
      spamStatus: "CLEAN",
      manualAppraisal: null,
      lastSale: null,
      floorPrice: null,
      acquisitionCostEur: null,
    });
    expect(choice.method).toBe("UNKNOWN");
    expect(choice.amountEur).toBeNull();
    expect(choice.confidenceScore).toBe(0);
    expect(choice.fallbackReason).toBeTruthy();
  });
});

describe("isLastSaleReliable — cas 15 (vente aberrante)", () => {
  it("rejette une vente à 0 ou négative", () => {
    expect(isLastSaleReliable(d(0), d(10))).toBe(false);
  });

  it("accepte une vente cohérente avec le floor", () => {
    expect(isLastSaleReliable(d(100), d(90))).toBe(true);
  });

  it("rejette une vente à 10x le floor (aberrante)", () => {
    expect(isLastSaleReliable(d(1000), d(90), 5)).toBe(false);
  });

  it("rejette une vente à 0.1x le floor (aberrante à la baisse)", () => {
    expect(isLastSaleReliable(d(5), d(90), 5)).toBe(false);
  });

  it("sans floor connu, une vente positive est acceptée faute de référence", () => {
    expect(isLastSaleReliable(d(50), null)).toBe(true);
  });
});

describe("isNftValuationStale", () => {
  it("sans date connue, est toujours périmée", () => {
    expect(isNftValuationStale(null)).toBe(true);
  });

  it("est fraîche sous le seuil (48h)", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    const recent = new Date("2026-01-01T12:00:00Z");
    expect(isNftValuationStale(recent, now)).toBe(false);
  });

  it("est périmée au-delà du seuil", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    const old = new Date("2026-01-01T00:00:00Z");
    expect(isNftValuationStale(old, now)).toBe(true);
  });

  it("respecte un seuil personnalisé", () => {
    const now = new Date("2026-01-01T10:00:00Z");
    const at = new Date("2026-01-01T00:00:00Z");
    expect(isNftValuationStale(at, now, 5)).toBe(true);
    expect(isNftValuationStale(at, now, 20)).toBe(false);
  });

  it("expose un seuil par défaut de 48h", () => {
    expect(NFT_STALE_VALUATION_HOURS).toBe(48);
  });
});

describe("applyOwnershipShare — cas 47 (quote-part)", () => {
  it("sharePct null équivaut à 100 %", () => {
    expect(applyOwnershipShare(d(1000), null).toNumber()).toBe(1000);
  });

  it("applique une quote-part partielle", () => {
    expect(applyOwnershipShare(d(1000), d(25)).toNumber()).toBe(250);
  });

  it("une quote-part de 100 laisse la valeur inchangée", () => {
    expect(applyOwnershipShare(d(400), d(100)).toNumber()).toBe(400);
  });
});
