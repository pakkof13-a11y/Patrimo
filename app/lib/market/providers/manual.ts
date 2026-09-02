import type { AssetMeta, MarketDataProvider, PriceQuoteResult } from "../types";
import { d, toFixed } from "../../money/decimal";
import { toEurAmount } from "../fx";

export const manualProvider: MarketDataProvider = {
  id: "manual",
  supports(asset) {
    return (
      asset.priceProvider === "MANUAL" ||
      ["IMMOBILIER", "OBLIGATIONS", "CASH", "AUTRE"].includes(asset.assetClass)
    );
  },
  async fetchPrice(asset: AssetMeta): Promise<PriceQuoteResult> {
    const raw = asset.manualPrice ?? asset.manualPriceEur;
    if (raw == null || raw === "") {
      return {
        priceEur: "0",
        currency: "EUR",
        source: "manual",
        status: "ERROR",
        error: "Aucune valorisation manuelle définie",
      };
    }
    const nativeCurrency = (asset.currency || "EUR").toUpperCase();
    const priceNative = d(raw);
    /*
      La conversion peut désormais échouer : une devise qu'aucune source ne
      fonde ne vaut plus « un euro par unité ». Yahoo et Finnhub convertissent
      déjà dans leur `try` et rendent une cotation en erreur ; ce fournisseur
      n'avait pas de garde, et l'exception serait sortie jusqu'au lot de
      rafraîchissement. On reprend l'idiome qu'il emploie déjà quelques lignes
      plus haut — une cotation `ERROR`, jamais un prix faux.
    */
    let priceEur: string;
    try {
      priceEur = await toEurAmount(priceNative, nativeCurrency);
    } catch (e) {
      return {
        priceEur: "0",
        currency: "EUR",
        source: "manual",
        status: "ERROR",
        error: e instanceof Error ? e.message : "Conversion impossible",
      };
    }
    return {
      priceEur,
      priceNative: toFixed(priceNative, 8),
      nativeCurrency,
      currency: "EUR",
      source: "manual",
      status: "OK",
    };
  },
};
