import { describe, expect, it } from "vitest";
import { normalizeQuoteCurrency } from "@/app/lib/market/symbol";

/**
 * FX-02 — `normalizeQuoteCurrency`, brique pure.
 *
 * Testée jusqu'ici uniquement à travers `yahooProvider.fetchPrice` (GBp) et
 * `getAssetPriceHistory` (GBp) : ZAc et ILA, pourtant lus par la même
 * fonction et documentés dans son commentaire, n'étaient exercés par aucun
 * test. Ce fichier couvre les trois sous-unités et les cas de bord du
 * signal — la casse exacte du suffixe brut, jamais déduite du marché.
 */
describe("normalizeQuoteCurrency", () => {
  it("GBp (pence sterling) : GBP, divisée par 100", () => {
    expect(normalizeQuoteCurrency("GBp")).toEqual({ currency: "GBP", divisor: 100 });
  });

  it("GBX (alias pence, vu sur certains flux) : GBP, divisée par 100", () => {
    expect(normalizeQuoteCurrency("GBX")).toEqual({ currency: "GBP", divisor: 100 });
  });

  it("ZAc (cents rand) : ZAR, divisée par 100", () => {
    expect(normalizeQuoteCurrency("ZAc")).toEqual({ currency: "ZAR", divisor: 100 });
  });

  it("ILA (agorot) : ILS, divisée par 100", () => {
    expect(normalizeQuoteCurrency("ILA")).toEqual({ currency: "ILS", divisor: 100 });
  });

  it("GBP déjà unité principale : inchangée, divisor 1", () => {
    expect(normalizeQuoteCurrency("GBP")).toEqual({ currency: "GBP", divisor: 1 });
  });

  it("une casse différente de celle du signal n'est pas reconnue comme sous-unité", () => {
    // "GBP" en toutes capitales n'est pas "GBp" : le signal est la casse
    // exacte, pas la devise. Une variante mal cassée doit passer inchangée,
    // pas être traitée en sous-unité par accident.
    expect(normalizeQuoteCurrency("gbp")).toEqual({ currency: "GBP", divisor: 1 });
    expect(normalizeQuoteCurrency("ZAC")).toEqual({ currency: "ZAC", divisor: 1 });
    expect(normalizeQuoteCurrency("Ila")).toEqual({ currency: "ILA", divisor: 1 });
  });

  it("une devise ordinaire (USD, EUR) traverse sans changement", () => {
    expect(normalizeQuoteCurrency("USD")).toEqual({ currency: "USD", divisor: 1 });
    expect(normalizeQuoteCurrency("EUR")).toEqual({ currency: "EUR", divisor: 1 });
  });

  it("entrée vide ou espaces : rendue telle quelle, sans division", () => {
    expect(normalizeQuoteCurrency("")).toEqual({ currency: "", divisor: 1 });
    expect(normalizeQuoteCurrency("  ")).toEqual({ currency: "", divisor: 1 });
  });
});
