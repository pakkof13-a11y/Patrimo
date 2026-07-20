import { describe, expect, it } from "vitest";
import {
  formatCurrencyPrecise,
  formatMicroCompact,
  formatQuantity,
  formatUnitPrice,
} from "@/app/lib/utils";
import { resolveCoingeckoId } from "@/app/lib/market/providers/coingecko";

describe("formatQuantity micro-crypto", () => {
  it("ne tronque pas 0.00000251 en 0", () => {
    expect(formatQuantity("0.00000251")).toBe("0,00000251");
    expect(formatQuantity("0.0026398")).toBe("0,0026398");
  });
});

describe("formatMicroCompact / formatUnitPrice", () => {
  it("affiche les micro-prix en décimales lisibles (pas 0,e…)", () => {
    expect(formatMicroCompact("0.00000251")).toBe("0,00000251");
    expect(formatUnitPrice("0.00000251", "EUR", { crypto: true })).toContain(
      "0,00000251"
    );
    // Ancienne notation illisible rejetée
    expect(formatMicroCompact("0.00000213044")).not.toMatch(/0,e/);
    expect(formatUnitPrice("0.00000213044", "EUR", { crypto: true })).not.toMatch(
      /0,e/
    );
  });

  it("laisse MON ~0.02 en notation classique", () => {
    expect(formatMicroCompact("0.01913537")).toBeNull();
    const s = formatUnitPrice("0.01913537", "EUR", { crypto: true });
    expect(s).toMatch(/0,019/);
  });
});

describe("formatCurrencyPrecise", () => {
  it("garde les micro-montants visibles", () => {
    expect(formatCurrencyPrecise("0.35", "EUR")).toMatch(/0,35/);
    const micro = formatCurrencyPrecise("0.00035", "EUR");
    expect(micro).not.toMatch(/^0,00\s*€/);
  });
});

describe("resolveCoingeckoId", () => {
  it("mappe MON / ALGO / FLR", () => {
    expect(resolveCoingeckoId("MON")).toBe("monad");
    expect(resolveCoingeckoId("ALGO")).toBe("algorand");
    expect(resolveCoingeckoId("FLR")).toBe("flare-networks");
    expect(resolveCoingeckoId("MON", "MON")).toBe("monad");
    expect(resolveCoingeckoId(null, "monad")).toBe("monad");
  });
});

describe("CoinGecko Demo client constants", () => {
  it("pointe vers l’API Demo (pas Pro)", async () => {
    const { COINGECKO_BASE_URL } = await import(
      "@/app/lib/market/providers/coingecko"
    );
    expect(COINGECKO_BASE_URL).toBe("https://api.coingecko.com/api/v3");
    expect(COINGECKO_BASE_URL).not.toContain("pro-api");
  });
});
