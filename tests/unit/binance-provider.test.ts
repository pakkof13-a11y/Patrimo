import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  binanceProvider,
  resolveBinancePlan,
  isBinanceSupported,
  isBinanceEnabled,
  getBinancePrices,
  __resetBinanceCache,
  BINANCE_UNSUPPORTED,
} from "@/app/lib/market/providers/binance-ws";
import type { AssetMeta } from "@/app/lib/market/types";

function cryptoAsset(ticker: string | null, extra?: Partial<AssetMeta>): AssetMeta {
  return {
    id: "a1",
    name: ticker ?? "x",
    ticker,
    assetClass: "CRYPTO",
    priceProvider: "COINGECKO",
    providerSymbol: null,
    ...extra,
  };
}

/** Mock de l'endpoint Binance ticker/price. Renvoie les prix fournis. */
function mockBinance(priceBySymbol: Record<string, string>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    const single = url.searchParams.get("symbol");
    const multi = url.searchParams.get("symbols");
    let symbols: string[] = [];
    if (single) symbols = [single];
    else if (multi) symbols = JSON.parse(multi) as string[];
    const rows = symbols
      .filter((s) => s in priceBySymbol)
      .map((s) => ({ symbol: s, price: priceBySymbol[s] }));
    const body = single ? (rows[0] ?? null) : rows;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
}

describe("binance provider — mapping ticker → symbole", () => {
  beforeEach(() => {
    __resetBinanceCache();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __resetBinanceCache();
  });

  it("paire EUR directe pour un major (BTC → BTCEUR)", () => {
    const plan = resolveBinancePlan("BTC", null);
    expect(plan).toEqual({ kind: "eur", base: "BTC", symbol: "BTCEUR" });
  });

  it("paire USDT pour un alt sans EUR (RAY → RAYUSDT)", () => {
    const plan = resolveBinancePlan("RAY", null);
    expect(plan).toEqual({ kind: "usdt", base: "RAY", symbol: "RAYUSDT" });
  });

  it("alias de renommage MATIC → POL (USDT)", () => {
    const plan = resolveBinancePlan("MATIC", null);
    expect(plan).toEqual({ kind: "usdt", base: "POL", symbol: "POLUSDT" });
  });

  it("stablecoin USDT → plan stable", () => {
    expect(resolveBinancePlan("USDT", null)).toEqual({
      kind: "stable",
      base: "USDT",
    });
  });

  it("nettoie la casse / séparateurs (jitoSOL non supporté)", () => {
    expect(resolveBinancePlan("jitoSOL", null)).toBeNull();
  });
});

describe("binance provider — fallback CoinGecko (tokens non supportés)", () => {
  beforeEach(() => {
    __resetBinanceCache();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __resetBinanceCache();
  });

  it("liquid staking / wrapped → non supporté (registry → CoinGecko)", () => {
    for (const t of ["MSOL", "JITOSOL", "WSTETH", "WETH", "WSOL", "MON"]) {
      expect(BINANCE_UNSUPPORTED.has(t) || resolveBinancePlan(t, null) === null).toBe(
        true
      );
      expect(isBinanceSupported(cryptoAsset(t))).toBe(false);
    }
  });

  it("ticker inconnu → non supporté", () => {
    expect(isBinanceSupported(cryptoAsset("ZZZUNKNOWN"))).toBe(false);
  });

  it("non-CRYPTO → non supporté même si ticker connu", () => {
    expect(
      isBinanceSupported({ ...cryptoAsset("BTC"), assetClass: "ACTIONS" })
    ).toBe(false);
  });

  it("BINANCE_WS_ENABLED=false → tout non supporté (retour CoinGecko)", () => {
    vi.stubEnv("BINANCE_WS_ENABLED", "false");
    expect(isBinanceEnabled()).toBe(false);
    expect(isBinanceSupported(cryptoAsset("BTC"))).toBe(false);
  });
});

describe("binance provider — fetchPrice (chemins de prix)", () => {
  beforeEach(() => {
    __resetBinanceCache();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __resetBinanceCache();
  });

  it("paire EUR directe → priceEur sans conversion FX", async () => {
    mockBinance({ BTCEUR: "60000.5" });
    const q = await binanceProvider.fetchPrice(cryptoAsset("BTC"));
    expect(q.status).toBe("OK");
    expect(q.source).toBe("binance");
    expect(q.nativeCurrency).toBe("EUR");
    expect(Number(q.priceEur)).toBeCloseTo(60000.5, 4);
  });

  it("paire USDT → conversion USD→EUR (RAY)", async () => {
    // Pas d'appel réseau FX : getEurRates a un fallback USD=1.08 en cas d'échec
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname.includes("binance")) {
        return new Response(JSON.stringify({ symbol: "RAYUSDT", price: "2.16" }), {
          status: 200,
        });
      }
      // FX Frankfurter indisponible → provider FX bascule sur fallback 1.08
      return new Response("nope", { status: 500 });
    });
    const q = await binanceProvider.fetchPrice(cryptoAsset("RAY"));
    expect(q.status).toBe("OK");
    expect(q.nativeCurrency).toBe("USD");
    // 2.16 USD / 1.08 = 2.00 EUR (taux fallback)
    expect(Number(q.priceEur)).toBeCloseTo(2.0, 6);
    expect(Number(q.priceNative)).toBeCloseTo(2.16, 6);
  });

  it("stablecoin USDT → ~1 USD converti en EUR (aucun appel Binance)", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 500 })
    );
    const q = await binanceProvider.fetchPrice(cryptoAsset("USDT"));
    expect(q.status).toBe("OK");
    // 1 USD / 1.08 ≈ 0.9259 EUR (fallback FX)
    expect(Number(q.priceEur)).toBeCloseTo(1 / 1.08, 4);
    // Aucune requête vers Binance ticker/price
    const calledBinance = spy.mock.calls.some((c) =>
      String(c[0]).includes("binance")
    );
    expect(calledBinance).toBe(false);
  });

  it("paire EUR absente → repli automatique sur USDT", async () => {
    // ARB est dans EUR_PAIRS mais on ne renvoie QUE ARBUSDT (EUR manquant)
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.hostname.includes("binance")) {
        const multi = url.searchParams.get("symbols");
        const single = url.searchParams.get("symbol");
        const syms: string[] = multi
          ? (JSON.parse(multi) as string[])
          : single
            ? [single]
            : [];
        const rows = syms
          .filter((s) => s === "ARBUSDT")
          .map((s) => ({ symbol: s, price: "1.08" }));
        return new Response(JSON.stringify(single ? (rows[0] ?? null) : rows), {
          status: 200,
        });
      }
      return new Response("nope", { status: 500 });
    });
    const q = await binanceProvider.fetchPrice(cryptoAsset("ARB"));
    expect(q.status).toBe("OK");
    expect(q.nativeCurrency).toBe("USD");
    // 1.08 USD / 1.08 = 1.00 EUR
    expect(Number(q.priceEur)).toBeCloseTo(1.0, 6);
  });

  it("aucun prix → status ERROR (registry basculera sur CoinGecko)", async () => {
    mockBinance({}); // aucune ligne
    const q = await binanceProvider.fetchPrice(cryptoAsset("SOL"));
    expect(q.status).toBe("ERROR");
    expect(q.source).toBe("binance");
  });

  it("ticker non couvert → ERROR immédiat sans réseau", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const q = await binanceProvider.fetchPrice(cryptoAsset("MSOL"));
    expect(q.status).toBe("ERROR");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("binance provider — cache serveur (TTL 30 s)", () => {
  beforeEach(() => {
    __resetBinanceCache();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    __resetBinanceCache();
  });

  it("2 lectures dans la fenêtre TTL → 1 seul appel réseau", async () => {
    const spy = mockBinance({ BTCEUR: "60000" });
    const now = 1_000_000;
    const a = await getBinancePrices(["BTCEUR"], { now });
    const b = await getBinancePrices(["BTCEUR"], { now: now + 10_000 });
    expect(a.get("BTCEUR")).toBe(60000);
    expect(b.get("BTCEUR")).toBe(60000);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("au-delà du TTL → nouvel appel réseau", async () => {
    const spy = mockBinance({ BTCEUR: "60000" });
    const now = 2_000_000;
    await getBinancePrices(["BTCEUR"], { now });
    await getBinancePrices(["BTCEUR"], { now: now + 31_000 });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
