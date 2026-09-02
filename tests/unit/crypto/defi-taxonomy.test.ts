/**
 * Vocabulaire du backend DeFi — règles portées par la taxonomie.
 *
 * Ces fonctions décident ce qui se retranche, ce qui ne se valorise pas et ce
 * qu'une position a le droit de ne pas renseigner. Une seule d'entre elles
 * fausse produit soit un patrimoine gonflé, soit un refus de saisie injustifié.
 */

import { describe, expect, it } from "vitest";
import {
  ACCESS_MODE_KEYS,
  DEFI_ACCESS_MODES,
  DEFI_CUSTODY_MODELS,
  DEFI_EVENT_TYPES,
  DEFI_LEG_TYPES,
  DEFI_POSITION_STATUSES,
  DEFI_REWARD_TYPES,
  DEFI_VALUATION_METHODS,
  EVENT_TYPE_KEYS,
  LEG_TYPE_KEYS,
  POSITION_STATUS_KEYS,
  REWARD_TYPE_KEYS,
  UNKNOWN_PROTOCOL,
  VALUATION_METHOD_CONFIDENCE,
  VALUATION_METHOD_KEYS,
  accessModeLabel,
  isDebtLeg,
  isIlliquidStatus,
  isInactiveStatus,
  isLedgerBackedEvent,
  isRepresentativeLeg,
  isSyncedOrigin,
  isTransferEvent,
  isValuableRewardType,
  isWeakValuation,
  legTypeLabel,
  requiresBlockchain,
  requiresProtocol,
} from "@/app/lib/crypto/defi-taxonomy";

describe("rôles économiques", () => {
  it("ne fait retrancher que la dette", () => {
    expect(isDebtLeg("DEBT")).toBe(true);
    for (const t of ["ASSET", "COLLATERAL", "RECEIPT", "REWARD", "SHARE", "UNDERLYING"]) {
      expect(isDebtLeg(t)).toBe(false);
    }
  });

  it("traite le collatéral comme détenu, pas comme dû", () => {
    // Un collatéral compté comme une dette retirerait du patrimoine un actif
    // qu'on possède toujours.
    expect(isDebtLeg("COLLATERAL")).toBe(false);
  });

  it("identifie les représentations d'une exposition existante", () => {
    expect(isRepresentativeLeg("RECEIPT")).toBe(true);
    expect(isRepresentativeLeg("SHARE")).toBe(true);
    expect(isRepresentativeLeg("ASSET")).toBe(false);
    expect(isRepresentativeLeg("UNDERLYING")).toBe(false);
  });
});

describe("statuts", () => {
  it("sort de la valorisation ce qui n'a plus d'exposition", () => {
    expect(isInactiveStatus("CLOSED")).toBe(true);
    expect(isInactiveStatus("LIQUIDATED")).toBe(true);
    expect(isInactiveStatus("ACTIVE")).toBe(false);
    // Verrouillée ou en retrait : les fonds sont engagés, donc toujours comptés.
    expect(isInactiveStatus("LOCKED")).toBe(false);
    expect(isInactiveStatus("WITHDRAWING")).toBe(false);
  });

  it("distingue l'illiquidité de l'inactivité (cas 40, 43, 47)", () => {
    for (const s of ["LOCKED", "WITHDRAWING", "UNSTAKING", "PAUSED"]) {
      expect(isIlliquidStatus(s)).toBe(true);
      expect(isInactiveStatus(s)).toBe(false);
    }
    expect(isIlliquidStatus("ACTIVE")).toBe(false);
  });
});

describe("méthodes de valorisation", () => {
  it("classe les méthodes par fiabilité décroissante", () => {
    const c = VALUATION_METHOD_CONFIDENCE;
    expect(c.MARKET).toBeGreaterThan(c.UNDERLYING_ASSETS);
    expect(c.UNDERLYING_ASSETS).toBeGreaterThan(c.PROVIDER_ESTIMATE);
    expect(c.PROVIDER_ESTIMATE).toBeGreaterThan(c.MANUAL);
    expect(c.MANUAL).toBeGreaterThan(c.ACQUISITION_COST_FALLBACK);
    expect(c.ACQUISITION_COST_FALLBACK).toBeGreaterThan(c.UNKNOWN);
    expect(c.UNKNOWN).toBe(0);
  });

  it("attribue un score à chaque méthode déclarée", () => {
    for (const m of VALUATION_METHOD_KEYS) {
      expect(VALUATION_METHOD_CONFIDENCE[m]).toBeTypeOf("number");
    }
  });

  it("signale comme faibles le repli et l'inconnu", () => {
    expect(isWeakValuation("ACQUISITION_COST_FALLBACK")).toBe(true);
    expect(isWeakValuation("UNKNOWN")).toBe(true);
    expect(isWeakValuation("MARKET")).toBe(false);
    // Une saisie manuelle est un choix assumé, pas un repli subi.
    expect(isWeakValuation("MANUAL")).toBe(false);
  });
});

describe("récompenses", () => {
  it("exclut les points de la valorisation (cas 17)", () => {
    expect(isValuableRewardType("POINTS")).toBe(false);
  });

  it("valorise toutes les autres natures", () => {
    for (const t of ["YIELD", "TRADING_FEES", "EMISSIONS", "AIRDROP", "COUPON", "OTHER"]) {
      expect(isValuableRewardType(t)).toBe(true);
    }
  });
});

describe("événements", () => {
  it("adosse au journal les seuls événements qui déplacent de la quantité", () => {
    for (const t of ["DEPOSIT", "WITHDRAW", "STAKE", "CLAIM_REWARD", "BORROW", "REPAY"]) {
      expect(isLedgerBackedEvent(t)).toBe(true);
    }
    // Exiger une écriture pour un passage de sync fabriquerait des
    // transactions vides.
    for (const t of ["SYNC_REFRESH", "REBALANCE", "MANUAL_OVERRIDE", "WRAP"]) {
      expect(isLedgerBackedEvent(t)).toBe(false);
    }
  });

  it("identifie les transferts inter-représentations (source de double compte)", () => {
    for (const t of ["BRIDGE_IN", "BRIDGE_OUT", "WRAP", "UNWRAP", "MIGRATE"]) {
      expect(isTransferEvent(t)).toBe(true);
    }
    expect(isTransferEvent("DEPOSIT")).toBe(false);
  });

  it("couvre l'intégralité du cycle de vie du cahier des charges", () => {
    for (const required of [
      "DEPOSIT", "WITHDRAW", "STAKE", "UNSTAKE", "CLAIM_REWARD", "COMPOUND",
      "BORROW", "REPAY", "ADD_LIQUIDITY", "REMOVE_LIQUIDITY", "REBALANCE",
      "MIGRATE", "LIQUIDATION", "BRIDGE_IN", "BRIDGE_OUT", "WRAP", "UNWRAP",
      "SYNC_REFRESH", "MANUAL_OVERRIDE",
    ]) {
      expect(DEFI_EVENT_TYPES).toHaveProperty(required);
    }
  });
});

describe("origines de donnée", () => {
  it("ne laisse resynchroniser que les origines automatiques", () => {
    expect(isSyncedOrigin("WALLET_SYNC")).toBe(true);
    expect(isSyncedOrigin("PLATFORM_API")).toBe(true);
    // Une saisie manuelle n'est jamais écrasée par une synchronisation.
    expect(isSyncedOrigin("MANUAL")).toBe(false);
    expect(isSyncedOrigin("CSV_IMPORT")).toBe(false);
  });
});

describe("cohérence du contexte d'accès", () => {
  it("exige protocole et chaîne d'une position on-chain", () => {
    expect(requiresProtocol("DEFI")).toBe(true);
    expect(requiresBlockchain("DEFI")).toBe(true);
  });

  it("n'exige rien d'un produit CeFi ou hybride (cas 2, 3, 26, 48)", () => {
    // Un « Earn » d'exchange ne dit pas toujours où va l'argent : forcer un nom
    // de protocole produirait une donnée inventée.
    for (const mode of ["CEFI", "HYBRID"]) {
      expect(requiresProtocol(mode)).toBe(false);
      expect(requiresBlockchain(mode)).toBe(false);
    }
  });

  it("offre une valeur explicite pour un protocole non divulgué (cas 35)", () => {
    expect(UNKNOWN_PROTOCOL).toBe("UNKNOWN_NOT_DISCLOSED");
  });
});

describe("libellés et clés", () => {
  it("renvoie le libellé français d'une valeur connue", () => {
    expect(accessModeLabel("CEFI")).toBe("CeFi (plateforme)");
    expect(legTypeLabel("DEBT")).toBe("Dette");
  });

  it("renvoie la valeur brute plutôt que rien pour un inconnu", () => {
    // Un libellé vide masquerait une donnée existante ; la valeur brute reste
    // lisible et signale l'oubli.
    expect(accessModeLabel("MYSTERE")).toBe("MYSTERE");
  });

  it("expose des clés alignées sur chaque table", () => {
    expect([...ACCESS_MODE_KEYS].sort()).toEqual(Object.keys(DEFI_ACCESS_MODES).sort());
    expect([...LEG_TYPE_KEYS].sort()).toEqual(Object.keys(DEFI_LEG_TYPES).sort());
    expect([...POSITION_STATUS_KEYS].sort()).toEqual(
      Object.keys(DEFI_POSITION_STATUSES).sort()
    );
    expect([...VALUATION_METHOD_KEYS].sort()).toEqual(
      Object.keys(DEFI_VALUATION_METHODS).sort()
    );
    expect([...REWARD_TYPE_KEYS].sort()).toEqual(Object.keys(DEFI_REWARD_TYPES).sort());
    expect([...EVENT_TYPE_KEYS].sort()).toEqual(Object.keys(DEFI_EVENT_TYPES).sort());
  });

  it("couvre les trois contextes d'accès et les modèles de conservation", () => {
    expect(Object.keys(DEFI_ACCESS_MODES)).toEqual(["DEFI", "HYBRID", "CEFI"]);
    expect(Object.keys(DEFI_CUSTODY_MODELS)).toContain("SELF_CUSTODY");
    expect(Object.keys(DEFI_CUSTODY_MODELS)).toContain("CUSTODIAL");
  });
});
