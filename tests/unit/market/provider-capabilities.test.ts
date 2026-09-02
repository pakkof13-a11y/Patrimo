import { describe, expect, it } from "vitest";
import {
  canServeHistory,
  honoursInterval,
  PROVIDER_CAPABILITIES,
} from "@/app/lib/market/provider-capabilities";

/**
 * Les capacités déclarées doivent décrire le dépôt, pas les brochures.
 *
 * Le piège que ces tests ferment : supposer qu'un fournisseur sait rendre de
 * l'intra-journalier historique parce qu'il sait rendre un prix courant. Ce
 * sont deux capacités distinctes, et les confondre ferait lire une absence de
 * branchement comme une absence de données.
 */

describe("historique réellement exploité", () => {
  it("seuls Yahoo et CoinGecko servent des barres historiques", () => {
    const avecHistorique = Object.values(PROVIDER_CAPABILITIES)
      .filter((c) => c.history !== "none")
      .map((c) => c.id)
      .sort();
    expect(avecHistorique).toEqual(["coingecko", "yahoo"]);
  });

  it("un prix courant n'implique pas un historique", () => {
    expect(PROVIDER_CAPABILITIES.finnhub!.currentPrice).toBe(true);
    expect(PROVIDER_CAPABILITIES.finnhub!.history).toBe("none");
    expect(canServeHistory("finnhub", "daily")).toBe(false);
    expect(canServeHistory("binance", "intraday")).toBe(false);
  });

  it("un fournisseur inconnu ne sait rien faire", () => {
    expect(canServeHistory("kraken", "daily")).toBe(false);
    expect(honoursInterval("kraken", "1h")).toBe(false);
  });
});

describe("intervalles réellement honorés", () => {
  it("CoinGecko n'honore aucune granularité demandée", () => {
    /*
      `/coins/{id}/ohlc` choisit sa finesse selon `days`, et le code ramène
      15m/1h/4h à 1h. Annoncer « barres de 15 minutes » serait faux.
    */
    expect(PROVIDER_CAPABILITIES.coingecko!.honouredIntervals).toEqual([]);
    expect(honoursInterval("coingecko", "15m")).toBe(false);
    expect(honoursInterval("coingecko", "1h")).toBe(false);
  });

  it("Yahoo honore 15m et 1h, mais pas 4h", () => {
    // 4h est reconstruit depuis 1h par agrégation : ce n'est pas une barre
    // native, et le déclarer comme telle masquerait l'agrégation.
    expect(honoursInterval("yahoo", "15m")).toBe(true);
    expect(honoursInterval("yahoo", "1h")).toBe(true);
    expect(honoursInterval("yahoo", "4h")).toBe(false);
  });
});

describe("limitations documentées", () => {
  it("chaque fournisseur en déclare au moins une", () => {
    for (const c of Object.values(PROVIDER_CAPABILITIES)) {
      expect(c.limitations.length, `${c.id} sans limitation déclarée`).toBeGreaterThan(0);
    }
  });

  it("un fournisseur sans historique le dit explicitement", () => {
    for (const c of Object.values(PROVIDER_CAPABILITIES)) {
      if (c.history !== "none") continue;
      expect(c.honouredIntervals).toEqual([]);
    }
  });
});
