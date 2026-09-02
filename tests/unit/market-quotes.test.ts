import { describe, it, expect } from "vitest";
import {
  normalizeMarketState,
  isLive,
  formatQuotePrice,
  formatQuotePct,
  describeQuote,
  type MarketQuote,
} from "@/app/lib/market/quotes";
import { MARKET_TICKERS } from "@/app/lib/portfolio/market-indices";

function quote(over: Partial<MarketQuote> & { label: string }): MarketQuote {
  return {
    key: over.key ?? "k",
    label: over.label,
    // `??` avalerait un `null` explicite — or c'est précisément le cas qu'on
    // veut pouvoir décrire : « pas de cours ».
    last: "last" in over ? over.last! : 100,
    changePct: "changePct" in over ? over.changePct! : 1,
    state: over.state ?? "open",
    currency: over.currency ?? "EUR",
  };
}

describe("normalizeMarketState", () => {
  it("ramène les phases de Yahoo à trois états lisibles", () => {
    expect(normalizeMarketState("REGULAR")).toBe("open");
    expect(normalizeMarketState("CLOSED")).toBe("closed");
    expect(normalizeMarketState("POSTPOST")).toBe("closed");
    expect(normalizeMarketState("PREPRE")).toBe("closed");
    expect(normalizeMarketState("PRE")).toBe("extended");
    expect(normalizeMarketState("POST")).toBe("extended");
  });

  it("avoue son ignorance plutôt que de supposer ouvert", () => {
    expect(normalizeMarketState(null)).toBe("unknown");
    expect(normalizeMarketState("")).toBe("unknown");
    expect(normalizeMarketState("N'IMPORTE QUOI")).toBe("unknown");
  });

  it("tolère la casse et les espaces", () => {
    expect(normalizeMarketState(" regular ")).toBe("open");
  });
});

describe("isLive", () => {
  it("ne considère vivant que l'ouvert et la séance étendue", () => {
    expect(isLive("open")).toBe(true);
    expect(isLive("extended")).toBe(true);
    expect(isLive("closed")).toBe(false);
    // Un état inconnu n'est pas affiché comme vivant : mieux vaut dire « fermé »
    // à tort que présenter une clôture de vendredi comme le cours du moment.
    expect(isLive("unknown")).toBe(false);
  });
});

describe("formatQuotePrice", () => {
  /*
    `toLocaleString("fr-FR")` sépare les milliers par une espace fine insécable
    (U+202F), pas par une espace ordinaire. On l'écrit explicitement plutôt que
    de coller un caractère invisible dans le fichier.
  */
  const NNBSP = "\u202f";

  it("compacte les grands indices et détaille les parités", () => {
    expect(formatQuotePrice(41320.55)).toBe(`41${NNBSP}321`);
    expect(formatQuotePrice(7654.32)).toBe(`7${NNBSP}654,32`);
    expect(formatQuotePrice(1.0847)).toBe("1,0847");
  });
});

describe("formatQuotePct", () => {
  it("porte toujours un signe, moins typographique compris", () => {
    expect(formatQuotePct(2.081)).toBe("+2,08 %");
    expect(formatQuotePct(-1.2)).toBe("−1,20 %");
    expect(formatQuotePct(0)).toBe("+0,00 %");
  });
});

describe("describeQuote", () => {
  it("annonce « fermé » sans le cours quand la place est close", () => {
    expect(describeQuote(quote({ label: "CAC 40", state: "closed" }))).toBe(
      "CAC 40 : fermé"
    );
  });

  it("annonce cours et variation quand la place est ouverte", () => {
    expect(
      describeQuote(
        quote({ label: "BTC/USD", last: 61245.3, changePct: 2.08, state: "open" })
      )
    ).toBe("BTC/USD 61\u202f245, +2,08 %");
  });

  it("dit « indisponible » plutôt que d'inventer un cours", () => {
    expect(describeQuote(quote({ label: "XAG/USD", last: null }))).toBe(
      "XAG/USD : indisponible"
    );
  });
});

describe("catalogue du bandeau", () => {
  it("porte les onze instruments demandés, dans l'ordre", () => {
    expect(MARKET_TICKERS.map((t) => t.label)).toEqual([
      "CAC 40",
      "DAX",
      "STOXX 600",
      "S&P 500",
      "NASDAQ 100",
      "DOW JONES",
      "BTC/USD",
      "ETH/USD",
      "XAU/USD",
      "XAG/USD",
      "EUR/USD",
    ]);
  });

  it("n'a ni clé ni symbole en double", () => {
    const keys = MARKET_TICKERS.map((t) => t.key);
    const symbols = MARKET_TICKERS.map((t) => t.yahoo);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(symbols).size).toBe(symbols.length);
  });
});
