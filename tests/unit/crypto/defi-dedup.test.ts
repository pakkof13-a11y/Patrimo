/**
 * Anti-double-compte DeFi.
 *
 * Couvre les cas métier 19-22, 32-33, 36 du cahier des charges F1 : bridge,
 * wrap, migration de protocole, duplication multi-source, NFT de position.
 */

import { describe, expect, it } from "vitest";
import {
  describeLegOverlap,
  detectDoubleCounting,
  duplicateIdsToExclude,
  eventDedupKey,
  isSameExposure,
  logicalPositionKey,
  underlyingSymbol,
  type DedupPosition,
} from "@/app/lib/crypto/defi-dedup";

const pos = (over: Partial<DedupPosition> & { id: string }): DedupPosition => ({
  dataOrigin: "WALLET_SYNC",
  protocol: "Aave",
  chain: "ethereum",
  positionType: "LENDING",
  symbols: ["USDC"],
  status: "ACTIVE",
  ...over,
});

describe("équivalence d'exposition", () => {
  it("ramène un jeton encapsulé à son sous-jacent", () => {
    expect(underlyingSymbol("WETH")).toBe("ETH");
    expect(underlyingSymbol("stETH")).toBe("ETH");
    expect(underlyingSymbol("jitoSOL")).toBe("SOL");
  });

  it("laisse intacts les jetons qui ne sont pas des wrappers", () => {
    // Un `W` initial ne signifie pas encapsulé : WIF et WLD sont des jetons à
    // part entière. Une heuristique se tromperait ici, une table non.
    expect(underlyingSymbol("WIF")).toBe("WIF");
    expect(underlyingSymbol("WLD")).toBe("WLD");
  });

  it("reconnaît deux formes de la même exposition", () => {
    expect(isSameExposure("WETH", "ETH")).toBe(true);
    expect(isSameExposure("stETH", "WETH")).toBe(true);
    expect(isSameExposure("ETH", "SOL")).toBe(false);
  });
});

describe("clé logique de position", () => {
  it("distingue deux chaînes pour le même protocole et le même jeton", () => {
    const a = logicalPositionKey(pos({ id: "a", chain: "ethereum" }));
    const b = logicalPositionKey(pos({ id: "b", chain: "arbitrum" }));
    expect(a).not.toBe(b);
  });

  it("distingue deux versions d'un même protocole", () => {
    const v2 = logicalPositionKey(pos({ id: "a", protocolVersion: "v2" }));
    const v3 = logicalPositionKey(pos({ id: "b", protocolVersion: "v3" }));
    expect(v2).not.toBe(v3);
  });

  it("rapproche deux libellés de protocole équivalents", () => {
    const a = logicalPositionKey(pos({ id: "a", protocol: "Aave" }));
    const b = logicalPositionKey(pos({ id: "b", protocol: "  aave  " }));
    expect(a).toBe(b);
  });
});

describe("duplication multi-source (cas 32)", () => {
  it("détecte la même position vue par deux sources et garde la saisie manuelle", () => {
    const conflicts = detectDoubleCounting([
      pos({ id: "sync", dataOrigin: "WALLET_SYNC" }),
      pos({ id: "manual", dataOrigin: "MANUAL" }),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].kind).toBe("MULTI_SOURCE_DUPLICATE");
    // La saisie manuelle est une affirmation explicite de l'utilisateur.
    expect(conflicts[0].keepId).toBe("manual");
    expect(conflicts[0].duplicateId).toBe("sync");
  });

  it("préfère l'API de plateforme au scan de wallet", () => {
    const conflicts = detectDoubleCounting([
      pos({ id: "wallet", dataOrigin: "WALLET_SYNC" }),
      pos({ id: "api", dataOrigin: "PLATFORM_API" }),
    ]);
    expect(conflicts[0].keepId).toBe("api");
  });

  it("ne signale rien pour deux positions réellement distinctes (cas 27)", () => {
    const conflicts = detectDoubleCounting([
      pos({ id: "a", protocolVersion: "v2" }),
      pos({ id: "b", protocolVersion: "v3" }),
    ]);
    expect(conflicts).toHaveLength(0);
  });

  it("ignore les positions fermées et liquidées (cas 28, 29)", () => {
    const conflicts = detectDoubleCounting([
      pos({ id: "live", dataOrigin: "MANUAL" }),
      pos({ id: "dead", dataOrigin: "WALLET_SYNC", status: "CLOSED" }),
    ]);
    expect(conflicts).toHaveLength(0);
  });
});

describe("pont et migration (cas 19, 20)", () => {
  it("ne compte qu'une extrémité quand les deux côtés restent actifs", () => {
    // Le vrai double compte : le pont a été fait mais la position d'origine n'a
    // pas été soldée, si bien que la même valeur existe sur deux chaînes.
    const conflicts = detectDoubleCounting([
      pos({
        id: "src",
        chain: "ethereum",
        status: "ACTIVE",
        linkedPositionId: "dst",
        openedAt: "2026-01-01T00:00:00Z",
      }),
      pos({
        id: "dst",
        chain: "arbitrum",
        status: "ACTIVE",
        linkedPositionId: "src",
        openedAt: "2026-06-01T00:00:00Z",
      }),
    ]);
    const bridge = conflicts.find((c) => c.kind === "BRIDGE_BOTH_SIDES");
    expect(bridge).toBeDefined();
    // La destination — ouverte le plus récemment — porte la valeur aujourd'hui.
    expect(bridge!.keepId).toBe("dst");
    expect(bridge!.duplicateId).toBe("src");
  });

  it("ne signale rien quand l'origine du pont a été soldée", () => {
    // Pas de double compte : une seule extrémité porte encore de la valeur.
    const conflicts = detectDoubleCounting([
      pos({ id: "src", chain: "ethereum", status: "CLOSED", linkedPositionId: "dst" }),
      pos({ id: "dst", chain: "arbitrum", status: "ACTIVE", linkedPositionId: "src" }),
    ]);
    expect(conflicts.filter((c) => c.kind === "BRIDGE_BOTH_SIDES")).toHaveLength(0);
  });

  it("tranche le sens du pont indépendamment de l'ordre de lecture", () => {
    // Le même couple, lu dans les deux sens, doit désigner la même destination :
    // sinon les totaux changeraient d'une requête à l'autre.
    const src = pos({
      id: "zzz-src",
      chain: "ethereum",
      status: "ACTIVE",
      linkedPositionId: "aaa-dst",
      openedAt: "2026-01-01T00:00:00Z",
    });
    const dst = pos({
      id: "aaa-dst",
      chain: "base",
      status: "ACTIVE",
      linkedPositionId: "zzz-src",
      openedAt: "2026-06-01T00:00:00Z",
    });
    const forward = detectDoubleCounting([src, dst]);
    const backward = detectDoubleCounting([dst, src]);
    expect(forward[0].keepId).toBe("aaa-dst");
    expect(backward[0].keepId).toBe("aaa-dst");
  });

  it("signale une migration comme un reste sur la même chaîne", () => {
    const conflicts = detectDoubleCounting([
      pos({
        id: "old",
        protocol: "Aave",
        protocolVersion: "v2",
        status: "PAUSED",
        linkedPositionId: "new",
      }),
      pos({
        id: "new",
        protocol: "Aave",
        protocolVersion: "v3",
        status: "ACTIVE",
        linkedPositionId: "old",
      }),
    ]);
    const migration = conflicts.find((c) => c.kind === "MIGRATION_LEFTOVER");
    expect(migration).toBeDefined();
    expect(migration!.keepId).toBe("new");
  });

  it("ne signale la paire qu'une fois, même liée des deux côtés", () => {
    const conflicts = detectDoubleCounting([
      pos({ id: "a", chain: "ethereum", status: "ACTIVE", linkedPositionId: "b" }),
      pos({ id: "b", chain: "base", status: "ACTIVE", linkedPositionId: "a" }),
    ]);
    expect(conflicts.filter((c) => c.kind === "BRIDGE_BOTH_SIDES")).toHaveLength(1);
  });
});

describe("encapsulation (cas 19)", () => {
  it("signale un jeton et sa version encapsulée sur le même protocole", () => {
    const conflicts = detectDoubleCounting([
      pos({ id: "native", symbols: ["ETH"], protocol: "Wallet", positionType: "LENDING" }),
      pos({ id: "wrapped", symbols: ["WETH"], protocol: "Wallet", positionType: "LENDING" }),
    ]);
    expect(conflicts.some((c) => c.kind === "WRAP_DUPLICATE")).toBe(true);
  });

  it("laisse coexister ETH natif et stETH sur des protocoles distincts", () => {
    // Détenir de l'ETH en wallet et du stETH chez Lido, ce sont deux
    // expositions réelles : les fusionner effacerait le risque Lido.
    const conflicts = detectDoubleCounting([
      pos({ id: "native", symbols: ["ETH"], protocol: "Wallet" }),
      pos({ id: "lido", symbols: ["STETH"], protocol: "Lido" }),
    ]);
    expect(conflicts.filter((c) => c.kind === "WRAP_DUPLICATE")).toHaveLength(0);
  });

  it("n'applique pas la règle aux pools de liquidité", () => {
    // Une LP ETH/WETH est parfaitement légitime : les deux jambes existent.
    const conflicts = detectDoubleCounting([
      pos({ id: "lp1", symbols: ["ETH"], protocol: "Curve", positionType: "LP" }),
      pos({ id: "lp2", symbols: ["WETH"], protocol: "Curve", positionType: "LP" }),
    ]);
    expect(conflicts.filter((c) => c.kind === "WRAP_DUPLICATE")).toHaveLength(0);
  });
});

describe("NFT de position (cas 36)", () => {
  it("signale un NFT de position déclaré deux fois", () => {
    const conflicts = detectDoubleCounting([
      pos({ id: "clmm", nftPositionRef: "uni-v3-#12345", positionType: "LP" }),
      pos({ id: "nftmod", nftPositionRef: "UNI-V3-#12345", positionType: "OTHER" }),
    ]);
    expect(conflicts.some((c) => c.kind === "NFT_POSITION_DUPLICATE")).toBe(true);
  });
});

describe("exclusion des doublons", () => {
  it("n'exclut jamais une position par ailleurs conservée", () => {
    // Chaîne A→B→C : B est à la fois gardée et doublon. L'exclure viderait la
    // chaîne et ferait disparaître la valeur des totaux.
    const excluded = duplicateIdsToExclude([
      { kind: "MULTI_SOURCE_DUPLICATE", keepId: "A", duplicateId: "B", reason: "" },
      { kind: "MULTI_SOURCE_DUPLICATE", keepId: "B", duplicateId: "C", reason: "" },
    ]);
    expect(excluded.has("C")).toBe(true);
    expect(excluded.has("B")).toBe(false);
    expect(excluded.has("A")).toBe(false);
  });

  it("dédoublonne une position en conflit de plusieurs façons", () => {
    const excluded = duplicateIdsToExclude([
      { kind: "WRAP_DUPLICATE", keepId: "A", duplicateId: "B", reason: "" },
      { kind: "BRIDGE_BOTH_SIDES", keepId: "A", duplicateId: "B", reason: "" },
    ]);
    expect(excluded.size).toBe(1);
  });
});

describe("chevauchement interne des jambes", () => {
  it("signale un dépôt et son reçu comme non valorisés deux fois", () => {
    const msg = describeLegOverlap([
      { legType: "ASSET", symbol: "ETH" },
      { legType: "RECEIPT", symbol: "STETH" },
    ]);
    expect(msg).toContain("STETH");
    expect(msg).toContain("seule la représentation est valorisée");
  });

  it("ne dit rien quand il n'y a pas de représentation", () => {
    expect(
      describeLegOverlap([
        { legType: "ASSET", symbol: "ETH" },
        { legType: "DEBT", symbol: "USDC" },
      ])
    ).toBeNull();
  });
});

describe("déduplication des événements (cas 21, 22)", () => {
  it("distingue deux événements d'une même transaction", () => {
    const a = eventDedupKey({
      defiPositionId: "p1",
      txHash: "0xabc",
      eventType: "REMOVE_LIQUIDITY",
      symbol: "ETH",
    });
    const b = eventDedupKey({
      defiPositionId: "p1",
      txHash: "0xabc",
      eventType: "REMOVE_LIQUIDITY",
      symbol: "USDC",
    });
    expect(a).not.toBe(b);
  });

  it("rend la même clé pour un événement rejoué (re-sync sans doublon)", () => {
    const key = { defiPositionId: "p1", txHash: "0xABC", eventType: "DEPOSIT", symbol: "eth" };
    expect(eventDedupKey(key)).toBe(
      eventDedupKey({ ...key, txHash: "0xabc", symbol: "ETH" })
    );
  });

  it("tolère l'absence de hash (CeFi, saisie manuelle)", () => {
    expect(
      eventDedupKey({ defiPositionId: "p1", eventType: "DEPOSIT" })
    ).toBe("p1|no-tx|DEPOSIT|");
  });
});
