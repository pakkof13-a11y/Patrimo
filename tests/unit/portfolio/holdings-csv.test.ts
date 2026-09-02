import { describe, expect, it } from "vitest";
import { holdingsToCsv } from "@/app/lib/portfolio/holdings-csv";
import type { Holding } from "@/app/lib/types/ui";
import {
  asBaseAmount,
  asEurAmount,
  asPercentString,
  asPriceString,
  asQuantityString,
} from "@/app/lib/types/money-brands";

function makeHolding(overrides: Partial<Holding> = {}): Holding {
  return {
    assetId: "a1",
    name: "Apple Inc.",
    ticker: "AAPL",
    assetClass: "STOCK",
    accountType: "CTO",
    currency: "USD",
    platformId: "p1",
    platformName: "Interactive Brokers",
    platformLogoUrl: null,
    quantity: asQuantityString("10"),
    avgCostEur: asEurAmount("150"),
    costBasisEur: asEurAmount("1500"),
    currentPriceEur: asPriceString("180"),
    currentPriceNative: asPriceString("190"),
    marketValueEur: asEurAmount("1800"),
    marketValueBase: asBaseAmount("1800"),
    costBasisBase: asBaseAmount("1500"),
    unrealizedPnlEur: asEurAmount("300"),
    unrealizedPnlBase: asBaseAmount("300"),
    unrealizedPnlPct: asPercentString("20"),
    priceSource: "finnhub",
    priceStatus: "OK",
    lastUpdatedAt: null,
    ...overrides,
  };
}

describe("holdingsToCsv", () => {
  it("génère un en-tête et une ligne par position, délimiteur `;`", () => {
    const csv = holdingsToCsv(
      [makeHolding()],
      ["name", "quantity", "unrealizedPnlPct"],
      "EUR"
    );
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Actif;Quantité;Variation (%)");
    expect(lines[1]).toBe("Apple Inc.;10;20,00 %");
  });

  it("éclate la colonne Variation en deux champs calculables", () => {
    /*
      À l'écran, « Variation » empile le montant et le pourcentage. Dans un
      tableur, « +300,00 € / +20,00 % » dans une seule cellule ne s'additionne
      ni ne se trie : deux colonnes, deux nombres.
    */
    const csv = holdingsToCsv([makeHolding()], ["name", "unrealizedPnlBase"], "EUR");
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Actif;Variation (€);Variation (%)");
    // `Intl` sépare le montant du symbole par une espace insécable : l'écrire
    // en clair donnerait un test rouge pour un caractère invisible.
    expect(lines[1]).toBe("Apple Inc.;300,00 €;20,00 %");
  });

  it("n'écrit pas deux fois le pourcentage si sa colonne est aussi affichée", () => {
    const csv = holdingsToCsv(
      [makeHolding()],
      ["unrealizedPnlBase", "unrealizedPnlPct"],
      "EUR"
    );
    expect(csv.split("\r\n")[0]).toBe("Variation (€);Variation (%)");
  });

  it("ignore les colonnes inconnues sans planter", () => {
    const csv = holdingsToCsv([makeHolding()], ["name", "unknownCol"], "EUR");
    expect(csv.split("\r\n")[0]).toBe("Actif");
  });

  it("résout le libellé de l'enveloppe (code interne masqué)", () => {
    const csv = holdingsToCsv(
      [makeHolding({ accountType: "PEA" })],
      ["accountType"],
      "EUR"
    );
    expect(csv.split("\r\n")[1]).toBe("PEA");
    const csv2 = holdingsToCsv(
      [makeHolding({ accountType: "CTO" })],
      ["accountType"],
      "EUR"
    );
    expect(csv2.split("\r\n")[1]).toBe("Compte-Titres");
  });

  it("échappe les champs contenant le délimiteur ou des guillemets", () => {
    const csv = holdingsToCsv(
      [makeHolding({ name: 'Actif "spécial"; risqué' })],
      ["name"],
      "EUR"
    );
    expect(csv.split("\r\n")[1]).toBe('"Actif ""spécial""; risqué"');
  });

  it("une ligne par position sélectionnée, dans l'ordre donné", () => {
    const csv = holdingsToCsv(
      [
        makeHolding({ assetId: "a1", name: "Premier" }),
        makeHolding({ assetId: "a2", name: "Second" }),
      ],
      ["name"],
      "EUR"
    );
    const lines = csv.split("\r\n");
    expect(lines).toEqual(["Actif", "Premier", "Second"]);
  });
});
