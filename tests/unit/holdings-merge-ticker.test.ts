import { describe, expect, it } from "vitest";

/**
 * Spec produit : positions crypto même ticker + enveloppe → 1 ligne.
 * On teste la clé de merge (logique pure, miroir de service.ts).
 */
function mergeKey(row: {
  assetId: string;
  ticker: string | null;
  accountType: string;
  assetClass: string;
}): string {
  const tick = (row.ticker || "").trim().toUpperCase();
  const env = (row.accountType || "CTO").toUpperCase();
  const isCrypto = row.assetClass === "CRYPTO" || env === "CRYPTO";
  if (isCrypto && tick) return `crypto:${env}:${tick}`;
  return `id:${row.assetId}`;
}

describe("holdings merge key multi-plateforme crypto", () => {
  it("regroupe ETH Base + ETH Revolut sous la même clé", () => {
    const a = mergeKey({
      assetId: "a1",
      ticker: "ETH",
      accountType: "CRYPTO",
      assetClass: "CRYPTO",
    });
    const b = mergeKey({
      assetId: "a2",
      ticker: "eth",
      accountType: "CRYPTO",
      assetClass: "CRYPTO",
    });
    expect(a).toBe(b);
    expect(a).toBe("crypto:CRYPTO:ETH");
  });

  it("ne regroupe pas les actions même ticker sur plateformes différentes par ticker seul", () => {
    const a = mergeKey({
      assetId: "a1",
      ticker: "MC.PA",
      accountType: "PEA",
      assetClass: "ACTIONS",
    });
    const b = mergeKey({
      assetId: "a2",
      ticker: "MC.PA",
      accountType: "PEA",
      assetClass: "ACTIONS",
    });
    expect(a).not.toBe(b);
    expect(a).toBe("id:a1");
    expect(b).toBe("id:a2");
  });

  it("sépare CRYPTO et CTO même ticker", () => {
    const crypto = mergeKey({
      assetId: "a1",
      ticker: "BTC",
      accountType: "CRYPTO",
      assetClass: "CRYPTO",
    });
    const cto = mergeKey({
      assetId: "a2",
      ticker: "BTC",
      accountType: "CTO",
      assetClass: "CRYPTO",
    });
    // accountType diffère → clés différentes
    expect(crypto).toBe("crypto:CRYPTO:BTC");
    expect(cto).toBe("crypto:CTO:BTC");
    expect(crypto).not.toBe(cto);
  });
});
