import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetFinnhubCache,
  FINNHUB_BUDGET_EXHAUSTED,
  fetchFinnhubQuote,
  finnhubProvider,
  getFinnhubStats,
  hasFinnhubApiKey,
} from "@/app/lib/market/providers/finnhub";
import { finnhubRestLimiter } from "@/app/lib/market/rate-limit";
import type { AssetMeta } from "@/app/lib/market/types";

const ORIGINAL_KEY = process.env.FINNHUB_API_KEY;

function stubFetch(body: unknown, ok = true) {
  const spy = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 429,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function asset(partial: Partial<AssetMeta> = {}): AssetMeta {
  return {
    id: "a1",
    name: "Apple",
    ticker: "AAPL",
    assetClass: "ACTIONS",
    priceProvider: "FINNHUB",
    providerSymbol: null,
    currency: "USD",
    ...partial,
  };
}

beforeEach(() => {
  process.env.FINNHUB_API_KEY = "test-key";
  __resetFinnhubCache();
  finnhubRestLimiter.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_KEY === undefined) delete process.env.FINNHUB_API_KEY;
  else process.env.FINNHUB_API_KEY = ORIGINAL_KEY;
});

describe("hasFinnhubApiKey", () => {
  it("rejette les valeurs de gabarit et les guillemets résiduels", () => {
    process.env.FINNHUB_API_KEY = "demo";
    expect(hasFinnhubApiKey()).toBe(false);
    process.env.FINNHUB_API_KEY = "votre-cle-finnhub";
    expect(hasFinnhubApiKey()).toBe(false);
    process.env.FINNHUB_API_KEY = "  ";
    expect(hasFinnhubApiKey()).toBe(false);
    process.env.FINNHUB_API_KEY = '"vraie-cle"';
    expect(hasFinnhubApiKey()).toBe(true);
  });
});

describe("fetchFinnhubQuote — cache", () => {
  it("ne rappelle pas le réseau pour un symbole déjà en cache", async () => {
    const spy = stubFetch({ c: 190.5 });
    expect(await fetchFinnhubQuote("AAPL")).toEqual({ kind: "ok", price: 190.5 });
    expect(await fetchFinnhubQuote("AAPL")).toEqual({ kind: "ok", price: 190.5 });
    expect(await fetchFinnhubQuote("AAPL")).toEqual({ kind: "ok", price: 190.5 });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(getFinnhubStats().budgetUsed).toBe(1);
  });

  it("ne consomme qu'un seul jeton pour des appels concurrents sur le même symbole", async () => {
    const spy = stubFetch({ c: 12 });
    const out = await Promise.all([
      fetchFinnhubQuote("SAN.PA"),
      fetchFinnhubQuote("SAN.PA"),
      fetchFinnhubQuote("SAN.PA"),
      fetchFinnhubQuote("SAN.PA"),
    ]);
    expect(out).toEqual(Array(4).fill({ kind: "ok", price: 12 }));
    // Le premier appelant renseigne le cache ; les suivants le relisent après
    // avoir attendu leur tour dans le budget.
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("appelle le réseau une fois par symbole distinct", async () => {
    const spy = stubFetch({ c: 5 });
    await fetchFinnhubQuote("AAPL");
    await fetchFinnhubQuote("MSFT");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(getFinnhubStats().cacheSize).toBe(2);
  });

  it("expire l'entrée passé le TTL", async () => {
    const spy = stubFetch({ c: 7 });
    await fetchFinnhubQuote("AAPL", { now: 0 });
    // 31 s plus tard : au-delà du TTL de 30 s
    await fetchFinnhubQuote("AAPL", { now: 31_000 });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("fetchFinnhubQuote — réponses dégradées", () => {
  it("ne prend pas un cours nul pour un vrai prix", async () => {
    stubFetch({ c: 0 });
    expect(await fetchFinnhubQuote("INCONNU")).toEqual({ kind: "no-quote" });
  });

  it("ne met pas en cache une réponse sans cours", async () => {
    const spy = stubFetch({ c: 0 });
    await fetchFinnhubQuote("INCONNU");
    await fetchFinnhubQuote("INCONNU");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(getFinnhubStats().cacheSize).toBe(0);
  });

  it("remonte une erreur explicite sur HTTP non OK", async () => {
    stubFetch({}, false);
    await expect(fetchFinnhubQuote("AAPL")).rejects.toThrow(/429/);
  });

  it("signale l'absence de clé plutôt que d'appeler le réseau", async () => {
    process.env.FINNHUB_API_KEY = "demo";
    const spy = stubFetch({ c: 1 });
    expect(await fetchFinnhubQuote("AAPL")).toEqual({ kind: "no-key" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("finnhubProvider.supports", () => {
  it("ne prend jamais les cryptos — CoinGecko / Binance s'en chargent", () => {
    expect(finnhubProvider.supports(asset({ assetClass: "CRYPTO" }))).toBe(false);
  });

  it("prend les actions et tout actif explicitement marqué FINNHUB", () => {
    expect(finnhubProvider.supports(asset())).toBe(true);
    expect(
      finnhubProvider.supports(
        asset({ assetClass: "AUTRE", priceProvider: "FINNHUB" })
      )
    ).toBe(true);
  });
});

describe("finnhubProvider.fetchPrice", () => {
  it("échoue proprement sans clé, sans toucher au réseau", async () => {
    process.env.FINNHUB_API_KEY = "";
    const spy = stubFetch({ c: 1 });
    const out = await finnhubProvider.fetchPrice(asset());
    expect(out.status).toBe("ERROR");
    expect(out.priceEur).toBe("0");
    expect(spy).not.toHaveBeenCalled();
  });

  it("échoue proprement sans symbole exploitable", async () => {
    const out = await finnhubProvider.fetchPrice(
      asset({ ticker: null, providerSymbol: null })
    );
    expect(out.status).toBe("ERROR");
    expect(out.error).toMatch(/[Ss]ymbole/);
  });

  it("ne renvoie jamais un prix nul en statut OK", async () => {
    stubFetch({ c: 0 });
    const out = await finnhubProvider.fetchPrice(asset());
    expect(out.status).toBe("ERROR");
    expect(out.priceEur).toBe("0");
  });

  it("transforme une erreur réseau en résultat, pas en exception", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("socket hang up");
      })
    );
    const out = await finnhubProvider.fetchPrice(asset());
    expect(out.status).toBe("ERROR");
    expect(out.error).toContain("socket hang up");
  });
});

describe("budget épuisé — repli plutôt qu'attente", () => {
  it("rend la main immédiatement au lieu d'attendre la minute suivante", async () => {
    const spy = stubFetch({ c: 42 });
    // Consommer tout le budget de la minute
    while (finnhubRestLimiter.tryAcquire()) {
      /* vide le budget */
    }
    const started = Date.now();
    const out = await fetchFinnhubQuote("AAPL");
    expect(out).toEqual({ kind: "budget-exhausted" });
    // Aucun appel réseau, et surtout aucune attente
    expect(spy).not.toHaveBeenCalled();
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("sert quand même un cours encore en cache, budget ou pas", async () => {
    stubFetch({ c: 77 });
    await fetchFinnhubQuote("AAPL");
    while (finnhubRestLimiter.tryAcquire()) {
      /* vide le budget */
    }
    expect(await fetchFinnhubQuote("AAPL")).toEqual({ kind: "ok", price: 77 });
  });

  it("n'annonce pas un budget épuisé quand l'appelant accepte d'attendre", async () => {
    const spy = stubFetch({ c: 9 });
    const out = await fetchFinnhubQuote("AAPL", { waitForBudget: true });
    expect(out).toEqual({ kind: "ok", price: 9 });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("porte un message que le registry peut reconnaître pour basculer", async () => {
    stubFetch({ c: 42 });
    while (finnhubRestLimiter.tryAcquire()) {
      /* vide le budget */
    }
    const out = await finnhubProvider.fetchPrice(asset());
    expect(out.status).toBe("ERROR");
    expect(out.error).toBe(FINNHUB_BUDGET_EXHAUSTED);
  });
});
