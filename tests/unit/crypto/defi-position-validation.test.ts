/**
 * Validation de saisie d'une position DeFi / CeFi / CeDeFi.
 *
 * Fonctions pures extraites de `createDefiPosition` : elles s'exécutent avant
 * tout accès Prisma, et c'est là que se jouent les refus qui protègent les
 * agrégats — un emprunt sans dette, une quote-part hors bornes, un point
 * valorisé.
 */

import { describe, expect, it } from "vitest";
import {
  DefiInputError,
  validateAccessContext,
  validateLegs,
  validateRewards,
  type CreateDefiInput,
  type PositionLegInput,
  type PositionRewardInput,
} from "@/app/lib/crypto/defi-manual-service";
import { syncScopeKey } from "@/app/lib/crypto/defi-position-service";

const base = (over: Partial<CreateDefiInput> = {}): CreateDefiInput => ({
  platformId: "p1",
  assetSymbol: "ETH",
  protocol: "Lido",
  positionType: "LIQUID_STAKING",
  chain: "ethereum",
  quantity: "10",
  unitPriceEur: "3000",
  openedAt: "2026-01-01",
  ...over,
});

describe("validateAccessContext — cohérence du mode d'accès", () => {
  it("accepte une position DeFi complète (cas 1)", () => {
    expect(() => validateAccessContext(base())).not.toThrow();
  });

  it("refuse une position DeFi sans protocole", () => {
    expect(() =>
      validateAccessContext(base({ accessMode: "DEFI", protocol: "  " }))
    ).toThrow(/doit préciser son protocole/);
  });

  it("refuse une position DeFi sans chaîne", () => {
    expect(() =>
      validateAccessContext(base({ accessMode: "DEFI", chain: null }))
    ).toThrow(/doit préciser sa chaîne/);
  });

  it("accepte un produit CeFi sans protocole ni chaîne (cas 2, 48)", () => {
    // Un « Earn » d'exchange ne divulgue pas toujours sa mécanique : exiger un
    // protocole obligerait l'utilisateur à en inventer un.
    expect(() =>
      validateAccessContext(
        base({ accessMode: "CEFI", protocol: "", chain: null })
      )
    ).not.toThrow();
  });

  it("accepte un hybride au protocole partiellement connu (cas 3, 35)", () => {
    expect(() =>
      validateAccessContext(
        base({
          accessMode: "HYBRID",
          protocol: "",
          chain: null,
          underlyingProtocol: "UNKNOWN_NOT_DISCLOSED",
        })
      )
    ).not.toThrow();
  });

  it("refuse un mode d'accès, un statut ou une conservation inconnus", () => {
    expect(() =>
      validateAccessContext(base({ accessMode: "MYSTERE" as never }))
    ).toThrow(/Mode d'accès inconnu/);
    expect(() =>
      validateAccessContext(base({ status: "ZOMBIE" as never }))
    ).toThrow(/Statut de position inconnu/);
    expect(() =>
      validateAccessContext(base({ custodyModel: "VAULT7" as never }))
    ).toThrow(/Modèle de conservation inconnu/);
  });

  it("valide les bornes de la quote-part (cas 41)", () => {
    expect(() => validateAccessContext(base({ ownershipPct: "30" }))).not.toThrow();
    expect(() => validateAccessContext(base({ ownershipPct: "100" }))).not.toThrow();
    // Absente = 100 %, pas une erreur.
    expect(() => validateAccessContext(base({ ownershipPct: "" }))).not.toThrow();

    for (const bad of ["0", "-5", "101", "abc"]) {
      expect(() => validateAccessContext(base({ ownershipPct: bad }))).toThrow(
        /quote-part/
      );
    }
  });

  it("refuse de créer une position déjà fermée ou liquidée", () => {
    // Elle n'aurait jamais eu d'exposition, et l'écriture d'entrée du journal
    // la contredirait immédiatement.
    for (const status of ["CLOSED", "LIQUIDATED"] as const) {
      expect(() => validateAccessContext(base({ status }))).toThrow(
        /créez-la active puis dénouez-la/
      );
    }
  });

  it("lève une DefiInputError, pas une erreur générique", () => {
    // Le type porte le code d'erreur que les routes traduisent en 400 : une
    // erreur générique remonterait en 500.
    try {
      validateAccessContext(base({ ownershipPct: "0" }));
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DefiInputError);
      expect((e as DefiInputError).code).toBe("DEFI_INPUT");
    }
  });
});

describe("validateLegs — composantes économiques", () => {
  const leg = (over: Partial<PositionLegInput> = {}): PositionLegInput => ({
    legType: "ASSET",
    symbol: "ETH",
    quantity: "1",
    ...over,
  });

  it("accepte l'absence de composantes (compatibilité)", () => {
    // Comportement historique : la dette est portée par l'actif principal.
    expect(() => validateLegs("BORROWING", [])).not.toThrow();
  });

  it("exige une dette sur un emprunt (cas 8)", () => {
    // Sans elle, la position serait valorisée comme un dépôt et gonflerait le
    // patrimoine du montant exact de ce qu'on doit.
    expect(() =>
      validateLegs("BORROWING", [leg({ legType: "COLLATERAL" })])
    ).toThrow(/au moins une composante DEBT/);

    expect(() =>
      validateLegs("BORROWING", [
        leg({ legType: "COLLATERAL" }),
        leg({ legType: "DEBT", symbol: "USDC", quantity: "1000" }),
      ])
    ).not.toThrow();
  });

  it("refuse une dette sur une position qui n'est ni emprunt ni CDP", () => {
    expect(() =>
      validateLegs("LIQUID_STAKING", [leg({ legType: "DEBT", symbol: "USDC" })])
    ).toThrow(/n'a pas de sens sur une position LIQUID_STAKING/);
  });

  it("accepte une dette sur un CDP (cas 5 du vocabulaire étendu)", () => {
    expect(() =>
      validateLegs("CDP", [
        leg({ legType: "COLLATERAL" }),
        leg({ legType: "DEBT", symbol: "DAI", quantity: "500" }),
      ])
    ).not.toThrow();
  });

  it("refuse une composante en double sur le même rôle", () => {
    expect(() =>
      validateLegs("LP", [leg({ symbol: "ETH" }), leg({ symbol: "eth" })])
    ).toThrow(/déclarée deux fois/);
  });

  it("laisse coexister le même jeton sous deux rôles (cas 18)", () => {
    // Déposer de l'ETH et recevoir un reçu libellé ETH est légitime : c'est le
    // rôle qui les distingue, pas le symbole.
    expect(() =>
      validateLegs("LIQUID_STAKING", [
        leg({ legType: "ASSET", symbol: "ETH" }),
        leg({ legType: "RECEIPT", symbol: "ETH" }),
      ])
    ).not.toThrow();
  });

  it("refuse une quantité nulle, négative ou non numérique", () => {
    for (const q of ["0", "-1", "abc"]) {
      expect(() => validateLegs("LP", [leg({ quantity: q })])).toThrow(
        /Quantité invalide/
      );
    }
  });

  it("refuse un rôle inconnu et un symbole vide", () => {
    expect(() =>
      validateLegs("LP", [leg({ legType: "MYSTERE" as never })])
    ).toThrow(/Rôle de composante inconnu/);
    expect(() => validateLegs("LP", [leg({ symbol: "   " })])).toThrow(
      /doit porter un symbole/
    );
  });

  it("borne le nombre de composantes", () => {
    const many = Array.from({ length: 13 }, (_, i) =>
      leg({ symbol: `TOK${i}` })
    );
    expect(() => validateLegs("LP", many)).toThrow(/ne peut pas dépasser/);
  });
});

describe("validateRewards — récompenses structurées", () => {
  const reward = (over: Partial<PositionRewardInput> = {}): PositionRewardInput => ({
    symbol: "CRV",
    ...over,
  });

  it("accepte plusieurs jetons de récompense (cas 10)", () => {
    expect(() =>
      validateRewards([
        reward({ symbol: "CRV", accruedQuantity: "50", valueEur: "25" }),
        reward({ symbol: "CVX", accruedQuantity: "10", valueEur: "30" }),
      ])
    ).not.toThrow();
  });

  it("distingue deux natures du même jeton", () => {
    // Des frais de trading et des émissions libellés dans le même jeton sont
    // deux flux distincts, pas un doublon.
    expect(() =>
      validateRewards([
        reward({ symbol: "CRV", rewardType: "TRADING_FEES" }),
        reward({ symbol: "CRV", rewardType: "EMISSIONS" }),
      ])
    ).not.toThrow();
  });

  it("refuse le même couple jeton/nature deux fois", () => {
    expect(() =>
      validateRewards([
        reward({ symbol: "CRV", rewardType: "YIELD" }),
        reward({ symbol: "crv", rewardType: "YIELD" }),
      ])
    ).toThrow(/déclarée deux fois/);
  });

  it("refuse de valoriser un programme de points (cas 17)", () => {
    expect(() =>
      validateRewards([
        reward({ symbol: "EIGEN-PTS", rewardType: "POINTS", valueEur: "9999" }),
      ])
    ).toThrow(/pas de valeur de marché/);
  });

  it("accepte un programme de points sans valeur", () => {
    expect(() =>
      validateRewards([
        reward({ symbol: "EIGEN-PTS", rewardType: "POINTS", accruedQuantity: "50000" }),
      ])
    ).not.toThrow();
  });

  it("refuse une nature inconnue et une quantité négative", () => {
    expect(() =>
      validateRewards([reward({ rewardType: "MYSTERE" as never })])
    ).toThrow(/Nature de récompense inconnue/);
    expect(() =>
      validateRewards([reward({ accruedQuantity: "-5" })])
    ).toThrow(/Quantité de récompense invalide/);
  });

  it("accepte une liste vide", () => {
    expect(() => validateRewards([])).not.toThrow();
  });
});

describe("syncScopeKey — unicité réelle du curseur", () => {
  it("distingue deux plateformes du même fournisseur", () => {
    expect(syncScopeKey("plat1", "0xabc")).not.toBe(syncScopeKey("plat2", "0xabc"));
  });

  it("distingue deux adresses de la même plateforme", () => {
    expect(syncScopeKey("plat1", "0xabc")).not.toBe(syncScopeKey("plat1", "0xdef"));
  });

  it("rend une clé non nulle même sans portée", () => {
    // PostgreSQL ne fait pas collisionner deux NULL : sans cette clé, la
    // contrainte d'unicité laisserait créer des curseurs en double.
    expect(syncScopeKey(null, null)).toBe("-:-");
    expect(syncScopeKey(undefined, undefined)).toBe("-:-");
  });

  it("normalise la casse de l'adresse", () => {
    expect(syncScopeKey("p1", "0xABC")).toBe(syncScopeKey("p1", "0xabc"));
  });
});
