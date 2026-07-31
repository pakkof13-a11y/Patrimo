import { describe, expect, it } from "vitest";
import {
  assetLogoSources,
  platformDomain,
  platformLogoSources,
} from "@/app/lib/logos/logodev";

/**
 * Résolution des logos.
 *
 * Ce qui compte n'est pas l'URL exacte — logo.dev peut changer de paramètres —
 * mais l'ordre des tentatives et l'identifiant retenu à chaque rang : c'est là
 * que se joue la différence entre un vrai logo et un monogramme générique.
 */

function endpoints(urls: string[]): string[] {
  return urls.map((u) => new URL(u).pathname.slice(1));
}

describe("assetLogoSources", () => {
  it("interroge le ticker, puis l'ISIN, puis le nom pour un titre coté", () => {
    const sources = assetLogoSources({
      ticker: "MC.PA",
      isin: "FR0000121014",
      name: "LVMH",
      assetClass: "EQUITY",
    });
    expect(endpoints(sources)).toEqual([
      "ticker/MC.PA",
      "isin/FR0000121014",
      "name/LVMH",
    ]);
  });

  it("n'interroge pas l'endpoint action pour une crypto", () => {
    const sources = assetLogoSources({
      ticker: "BTC",
      name: "Bitcoin",
      assetClass: "CRYPTO",
    });
    expect(endpoints(sources)).toEqual(["crypto/BTC", "name/Bitcoin"]);
  });

  it("réduit un ticker de paire à sa monnaie de base", () => {
    for (const ticker of ["SOL-USD", "SOLUSDT", "SOL/USDC"]) {
      const [first] = endpoints(
        assetLogoSources({ ticker, name: "Solana", assetClass: "CRYPTO" })
      );
      expect(first).toBe("crypto/SOL");
    }
  });

  it("ne vide pas le symbole d'un stablecoin dont le nom est sa contrepartie", () => {
    const [first] = endpoints(
      assetLogoSources({ ticker: "USDT", name: "Tether", assetClass: "CRYPTO" })
    );
    expect(first).toBe("crypto/USDT");
  });

  it("reconnaît une crypto mal classée à son ticker", () => {
    const [first] = endpoints(
      assetLogoSources({ ticker: "ETH", name: "Ethereum", assetClass: "OTHER" })
    );
    expect(first).toBe("crypto/ETH");
  });

  it("ne demande le monogramme qu'au dernier rang — sinon il masquerait les suivants", () => {
    const sources = assetLogoSources({
      ticker: "AAPL",
      isin: "US0378331005",
      name: "Apple",
    });
    const fallbacks = sources.map((u) =>
      new URL(u).searchParams.get("fallback")
    );
    expect(fallbacks).toEqual(["404", "404", "monogram"]);
  });

  it("place une URL déjà stockée devant les déductions", () => {
    const sources = assetLogoSources({
      logoUrl: "https://cdn.exemple.fr/lvmh.png",
      ticker: "MC.PA",
      name: "LVMH",
    });
    expect(sources[0]).toBe("https://cdn.exemple.fr/lvmh.png");
    expect(sources.length).toBe(3);
  });

  it("ignore les URL héritées des fournisseurs abandonnés", () => {
    const sources = assetLogoSources({
      logoUrl: "https://logo.clearbit.com/lvmh.com",
      ticker: "MC.PA",
      name: "LVMH",
    });
    expect(sources[0]).not.toContain("clearbit");
  });

  it("ne renvoie rien quand aucun identifiant n'est connu", () => {
    expect(assetLogoSources({})).toEqual([]);
  });
});

describe("platformLogoSources", () => {
  it("préfère le domaine connu de l'établissement à son nom", () => {
    expect(endpoints(platformLogoSources({ name: "BoursoBank" }))).toEqual([
      "boursobank.com",
      "name/BoursoBank",
    ]);
  });

  it("retombe sur le nom pour un établissement absent de la table", () => {
    expect(
      endpoints(platformLogoSources({ name: "Courtier Inconnu" }))
    ).toEqual(["name/Courtier%20Inconnu"]);
  });

  it("retrouve le domaine quelle que soit la casse saisie", () => {
    expect(platformDomain("boursobank")).toBe("boursobank.com");
    expect(platformDomain("  Interactive Brokers ")).toBe(
      "interactivebrokers.com"
    );
    expect(platformDomain("Néant")).toBeNull();
  });
});
