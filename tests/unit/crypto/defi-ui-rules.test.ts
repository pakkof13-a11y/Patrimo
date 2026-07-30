/**
 * Règles UI centralisées du module DeFi/CeFi/CeDeFi — fonctions pures.
 *
 * Ce fichier pilote la divulgation progressive du formulaire et les badges du
 * tableau/détail : une règle fausse ici se répercute sur tous les composants
 * qui l'appellent, jamais sur un seul écran isolé.
 */

import { describe, expect, it } from "vitest";
import {
  getDefiAvailableActions,
  getDefiEmptyStateConfig,
  getDefiFieldLabel,
  getDefiLockInfo,
  getDefiStatusBadges,
  getDefiValuationDisplay,
  getFieldsToResetOnChange,
  isDefiFieldRequired,
  isDefiFieldVisible,
  isProtocolUnknown,
  type ClientDefiPosition,
  type DefiFormRuleState,
} from "@/app/lib/crypto/defi-ui-rules";

const state = (over: Partial<DefiFormRuleState> = {}): DefiFormRuleState => ({
  accessMode: "DEFI",
  positionType: "STAKING",
  ...over,
});

describe("isDefiFieldVisible — divulgation progressive", () => {
  it("masque chaîne et protocole en CeFi pur (cas K)", () => {
    const s = state({ accessMode: "CEFI" });
    expect(isDefiFieldVisible("chain", s)).toBe(false);
    expect(isDefiFieldVisible("protocol", s)).toBe(false);
  });

  it("affiche chaîne et protocole en DeFi directe", () => {
    const s = state({ accessMode: "DEFI" });
    expect(isDefiFieldVisible("chain", s)).toBe(true);
    expect(isDefiFieldVisible("protocol", s)).toBe(true);
  });

  it("affiche le protocole sous-jacent seulement en hybride (cas J)", () => {
    expect(isDefiFieldVisible("underlyingProtocol", state({ accessMode: "HYBRID" }))).toBe(
      true
    );
    expect(isDefiFieldVisible("underlyingProtocol", state({ accessMode: "DEFI" }))).toBe(
      false
    );
    expect(isDefiFieldVisible("underlyingProtocol", state({ accessMode: "CEFI" }))).toBe(
      false
    );
  });

  it("affiche le validateur seulement pour le staking natif (cas A)", () => {
    expect(isDefiFieldVisible("validatorName", state({ positionType: "STAKING" }))).toBe(
      true
    );
    expect(
      isDefiFieldVisible("validatorName", state({ positionType: "LIQUID_STAKING" }))
    ).toBe(false);
  });

  it("affiche les champs de paire seulement pour une LP (cas F, G)", () => {
    const lp = state({ positionType: "LP" });
    expect(isDefiFieldVisible("pairedSymbol", lp)).toBe(true);
    expect(isDefiFieldVisible("pairedAmount", lp)).toBe(true);
    expect(isDefiFieldVisible("isConcentrated", lp)).toBe(true);

    const staking = state({ positionType: "STAKING" });
    expect(isDefiFieldVisible("pairedSymbol", staking)).toBe(false);
  });

  it("n'affiche les bornes de prix que sur une LP concentrée (cas G)", () => {
    const lpFullRange = state({ positionType: "LP", isConcentrated: false });
    expect(isDefiFieldVisible("priceRangeMin", lpFullRange)).toBe(false);

    const lpConcentrated = state({ positionType: "LP", isConcentrated: true });
    expect(isDefiFieldVisible("priceRangeMin", lpConcentrated)).toBe(true);
    expect(isDefiFieldVisible("priceRangeMax", lpConcentrated)).toBe(true);
  });

  it("affiche le collatéral et les indicateurs de risque seulement sur un emprunt (cas E)", () => {
    const borrowing = state({ positionType: "BORROWING" });
    expect(isDefiFieldVisible("collateralSymbol", borrowing)).toBe(true);
    expect(isDefiFieldVisible("healthFactor", borrowing)).toBe(true);
    expect(isDefiFieldVisible("ltvPct", borrowing)).toBe(true);

    const lending = state({ positionType: "LENDING" });
    expect(isDefiFieldVisible("collateralSymbol", lending)).toBe(false);
    expect(isDefiFieldVisible("healthFactor", lending)).toBe(false);
  });

  it("affiche les points seulement pour le restaking (cas C)", () => {
    expect(isDefiFieldVisible("pointsAmount", state({ positionType: "RESTAKING" }))).toBe(
      true
    );
    expect(isDefiFieldVisible("pointsAmount", state({ positionType: "LENDING" }))).toBe(
      false
    );
  });

  it("masque la date de déblocage tant que le verrou n'est pas activé", () => {
    const locked = state({ positionType: "STAKING", lockEnabled: false });
    expect(isDefiFieldVisible("unlockAt", locked)).toBe(false);
    expect(
      isDefiFieldVisible("unlockAt", { ...locked, lockEnabled: true })
    ).toBe(true);
  });

  it("masque le lock-up sur les positions qui n'en ont jamais (lending, borrowing)", () => {
    expect(isDefiFieldVisible("lockEnabled", state({ positionType: "LENDING" }))).toBe(
      false
    );
    expect(isDefiFieldVisible("lockEnabled", state({ positionType: "BORROWING" }))).toBe(
      false
    );
  });

  it("masque les rewards sur un emprunt (une dette ne rapporte pas)", () => {
    expect(isDefiFieldVisible("rewardsSymbol", state({ positionType: "BORROWING" }))).toBe(
      false
    );
  });
});

describe("isDefiFieldRequired — n'évalue que les champs visibles", () => {
  it("rend faux un champ masqué même s'il serait obligatoire visible", () => {
    // priceRangeMin est obligatoire sur une LP concentrée, mais masqué hors LP.
    expect(isDefiFieldRequired("priceRangeMin", state({ positionType: "STAKING" }))).toBe(
      false
    );
  });

  it("exige les bornes de prix sur une LP concentrée seulement", () => {
    const concentrated = state({ positionType: "LP", isConcentrated: true });
    expect(isDefiFieldRequired("priceRangeMin", concentrated)).toBe(true);

    const fullRange = state({ positionType: "LP", isConcentrated: false });
    expect(isDefiFieldRequired("priceRangeMin", fullRange)).toBe(false);
  });

  it("exige le collatéral sur un emprunt", () => {
    expect(
      isDefiFieldRequired("collateralSymbol", state({ positionType: "BORROWING" }))
    ).toBe(true);
  });

  it("n'exige jamais le protocole en dehors de la DeFi directe (cas J, K)", () => {
    expect(isDefiFieldRequired("protocol", state({ accessMode: "HYBRID" }))).toBe(false);
    expect(isDefiFieldRequired("protocol", state({ accessMode: "CEFI" }))).toBe(false);
    expect(isDefiFieldRequired("protocol", state({ accessMode: "DEFI" }))).toBe(true);
  });

  it("exige toujours la quote-part, quel que soit le contexte", () => {
    expect(isDefiFieldRequired("ownershipPct", state({ accessMode: "CEFI" }))).toBe(true);
  });

  it("n'exige jamais les notes ni l'APY, purement informatifs", () => {
    expect(isDefiFieldRequired("notes", state())).toBe(false);
    expect(isDefiFieldRequired("apyPct", state())).toBe(false);
  });
});

describe("getFieldsToResetOnChange — reset en cascade", () => {
  it("réinitialise chaîne/protocole/plateforme quand accessMode change", () => {
    const resets = getFieldsToResetOnChange("accessMode");
    expect(resets).toContain("platformId");
    expect(resets).toContain("chain");
    expect(resets).toContain("protocol");
    expect(resets).toContain("underlyingProtocol");
  });

  it("réinitialise tous les champs spécifiques quand positionType change", () => {
    const resets = getFieldsToResetOnChange("positionType");
    expect(resets).toContain("collateralSymbol");
    expect(resets).toContain("pairedSymbol");
    expect(resets).toContain("healthFactor");
    expect(resets).toContain("pointsAmount");
    // Les champs universels ne sont jamais dans la liste de reset.
    expect(resets).not.toContain("accessMode");
    expect(resets).not.toContain("ownershipPct");
  });

  it("réinitialise les bornes de prix quand isConcentrated bascule", () => {
    expect(getFieldsToResetOnChange("isConcentrated")).toEqual(
      expect.arrayContaining(["priceRangeMin", "priceRangeMax"])
    );
  });

  it("ne renvoie rien pour un champ sans dépendants", () => {
    expect(getFieldsToResetOnChange("notes")).toEqual([]);
  });
});

describe("getDefiFieldLabel — libellés dynamiques", () => {
  it("relabelle le wallet en plateforme selon le mode d'accès", () => {
    expect(getDefiFieldLabel("platformId", state({ accessMode: "DEFI" }))).toBe("Wallet");
    expect(getDefiFieldLabel("platformId", state({ accessMode: "CEFI" }))).toBe(
      "Plateforme"
    );
  });

  it("relabelle l'actif selon la nature de la position", () => {
    expect(getDefiFieldLabel("assetSymbol", state({ positionType: "BORROWING" }))).toBe(
      "Actif emprunté"
    );
    expect(
      getDefiFieldLabel("assetSymbol", state({ positionType: "LIQUID_STAKING" }))
    ).toContain("reçu");
    expect(getDefiFieldLabel("assetSymbol", state({ positionType: "LP" }))).toContain(
      "paire"
    );
  });
});

describe("isProtocolUnknown", () => {
  it("détecte un protocole vide ou explicitement non divulgué", () => {
    expect(isProtocolUnknown("", null)).toBe(true);
    expect(isProtocolUnknown("UNKNOWN_NOT_DISCLOSED", null)).toBe(true);
    expect(isProtocolUnknown("Aave", "UNKNOWN_NOT_DISCLOSED")).toBe(true);
    expect(isProtocolUnknown("Aave", null)).toBe(false);
  });
});

// ─────────────────────────── Badges & actions ───────────────────────────

const position = (over: Partial<ClientDefiPosition> = {}): ClientDefiPosition => ({
  id: "p1",
  assetId: "a1",
  assetName: "ETH · Aave",
  assetSymbol: "ETH",
  platformId: "plat1",
  platformName: "MetaMask",
  accessMode: "DEFI",
  custodyModel: "SELF_CUSTODY",
  dataOrigin: "MANUAL",
  ownerLabel: null,
  ownershipPct: "100",
  protocol: "Aave",
  protocolVersion: "v3",
  underlyingProtocol: null,
  chain: "ethereum",
  positionType: "LENDING",
  marketRef: null,
  vaultRef: null,
  poolRef: null,
  validatorName: null,
  nftPositionRef: null,
  status: "ACTIVE",
  isLiquid: true,
  openedAt: "2026-01-01T00:00:00Z",
  closedAt: null,
  isHidden: false,
  isIgnoredInPortfolio: false,
  strategyId: null,
  isConcentrated: false,
  priceRangeMin: null,
  priceRangeMax: null,
  pairedSymbol: null,
  unlockAt: null,
  cliffAt: null,
  legs: [],
  rewards: [],
  valuation: {
    grossEur: "1000.00",
    netEur: "1000.00",
    debtEur: "0.00",
    collateralEur: "0.00",
    rewardsEur: "0.00",
    retainedEur: "1000.00",
    underlyingEur: null,
    method: "MARKET",
    confidenceScore: 100,
    fallbackReason: null,
    isValuable: true,
    unpricedSymbols: [],
    isStale: false,
    lastValuationAt: "2026-07-29T12:00:00Z",
  },
  debt: null,
  apyPct: null,
  conflict: { flagged: false, reason: null, excludedFromTotals: false },
  eventCount: 0,
  ...over,
});

describe("getDefiStatusBadges", () => {
  it("signale une position en risque de liquidation avant tout le reste (cas L)", () => {
    const p = position({
      debt: {
        ltvPct: "80",
        collateralRatio: "1.1",
        healthFactor: "1.1",
        reportedHealthFactor: null,
        liqThresholdPct: "80",
        riskLevel: "CRITICAL",
      },
    });
    const badges = getDefiStatusBadges(p);
    expect(badges[0].key).toBe("risk");
    expect(badges[0].tone).toBe("critical");
  });

  it("signale un doublon détecté sans jamais l'exclure silencieusement", () => {
    const p = position({
      conflict: { flagged: true, reason: "Vue par deux sources", excludedFromTotals: true },
    });
    const badges = getDefiStatusBadges(p);
    const conflict = badges.find((b) => b.key === "conflict");
    expect(conflict).toBeDefined();
    expect(conflict!.title).toContain("deux sources");
  });

  it("signale une valorisation périmée (cas stale)", () => {
    const p = position({
      valuation: { ...position().valuation, isStale: true },
    });
    expect(getDefiStatusBadges(p).some((b) => b.key === "stale")).toBe(true);
  });

  it("signale une position non valorisable plutôt que de l'afficher comme fiable (cas 37)", () => {
    const p = position({
      valuation: {
        ...position().valuation,
        isValuable: false,
        method: "UNKNOWN",
        fallbackReason: "Aucun prix disponible",
      },
    });
    const badges = getDefiStatusBadges(p);
    expect(badges.some((b) => b.key === "unvaluable" && b.tone === "critical")).toBe(true);
    // Ne doit pas afficher un badge "weak-valuation" en plus de "unvaluable".
    expect(badges.some((b) => b.key === "weak-valuation")).toBe(false);
  });

  it("signale une méthode de repli sans la faire passer pour fiable", () => {
    const p = position({
      valuation: {
        ...position().valuation,
        method: "ACQUISITION_COST_FALLBACK",
        fallbackReason: "Prix indisponible",
      },
    });
    expect(getDefiStatusBadges(p).some((b) => b.key === "weak-valuation")).toBe(true);
  });

  it("signale un protocole non divulgué (cas J, K)", () => {
    const p = position({ protocol: "UNKNOWN_NOT_DISCLOSED", accessMode: "CEFI" });
    expect(getDefiStatusBadges(p).some((b) => b.key === "unknown-protocol")).toBe(true);
  });

  it("signale les points comme hors valorisation (cas 17)", () => {
    const p = position({
      rewards: [
        {
          symbol: "EIGEN-PTS",
          rewardType: "POINTS",
          accruedQuantity: "5000",
          claimedQuantity: null,
          valueEur: null,
          isValuable: false,
        },
      ],
    });
    const badge = getDefiStatusBadges(p).find((b) => b.key === "points");
    expect(badge).toBeDefined();
    expect(badge!.label).toContain("hors valorisation");
  });

  it("signale une position masquée et une position ignorée distinctement (cas 30, 31)", () => {
    expect(getDefiStatusBadges(position({ isHidden: true })).some((b) => b.key === "hidden")).toBe(
      true
    );
    expect(
      getDefiStatusBadges(position({ isIgnoredInPortfolio: true })).some(
        (b) => b.key === "ignored"
      )
    ).toBe(true);
  });

  it("signale une position concentrée sans prétendre connaître son statut in-range", () => {
    const p = position({
      positionType: "LP",
      isConcentrated: true,
      priceRangeMin: "0.99",
      priceRangeMax: "1.01",
    });
    const badge = getDefiStatusBadges(p).find((b) => b.key === "clmm");
    expect(badge).toBeDefined();
    expect(badge!.title).toContain("0.99");
    // Ne jamais inventer in-range / out-of-range sans prix courant.
    expect(getDefiStatusBadges(p).some((b) => b.key === "in-range" || b.key === "out-of-range")).toBe(
      false
    );
  });
});

describe("getDefiAvailableActions", () => {
  it("ne propose que la consultation d'historique sur une position fermée (cas M)", () => {
    const actions = getDefiAvailableActions(position({ status: "CLOSED" }));
    expect(actions).toEqual([{ id: "view-history", label: "Voir l'historique" }]);
  });

  it("propose masquer/afficher selon l'état courant", () => {
    expect(
      getDefiAvailableActions(position({ isHidden: false })).find((a) => a.id === "hide")
    ).toBeDefined();
    expect(
      getDefiAvailableActions(position({ isHidden: true })).find((a) => a.id === "unhide")
    ).toBeDefined();
  });

  it("propose de retirer la valorisation manuelle seulement si elle est active", () => {
    const manual = position({ valuation: { ...position().valuation, method: "MANUAL" } });
    expect(
      getDefiAvailableActions(manual).some((a) => a.id === "clear-manual-valuation")
    ).toBe(true);
    expect(
      getDefiAvailableActions(position()).some((a) => a.id === "override-valuation")
    ).toBe(true);
  });

  it("propose la liquidation seulement sur une dette", () => {
    expect(
      getDefiAvailableActions(position({ positionType: "BORROWING" })).some(
        (a) => a.id === "liquidate"
      )
    ).toBe(true);
    expect(
      getDefiAvailableActions(position({ positionType: "LENDING" })).some(
        (a) => a.id === "liquidate"
      )
    ).toBe(false);
  });
});

describe("getDefiValuationDisplay", () => {
  it("explicite la différence entre brut, net et retenu", () => {
    const display = getDefiValuationDisplay(position());
    expect(display.grossLabel).toMatch(/avant dette/);
    expect(display.netLabel).toMatch(/après/);
    expect(display.retainedLabel).toMatch(/patrimoine/);
  });

  it("explique pourquoi une position n'est pas valorisable", () => {
    const p = position({
      valuation: {
        ...position().valuation,
        isValuable: false,
        fallbackReason: "Aucun prix ni coût disponible",
      },
    });
    expect(getDefiValuationDisplay(p).explanation).toBe("Aucun prix ni coût disponible");
  });
});

describe("getDefiLockInfo", () => {
  it("considère verrouillée une position dont le déblocage est dans le futur", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const info = getDefiLockInfo({ unlockAt: future, cliffAt: null });
    expect(info.isLocked).toBe(true);
    expect(info.unlockAt).not.toBeNull();
  });

  it("ne considère pas verrouillée une position dont le déblocage est passé", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const info = getDefiLockInfo({ unlockAt: past, cliffAt: null });
    expect(info.isLocked).toBe(false);
  });

  it("renvoie non verrouillé sans date de déblocage", () => {
    expect(getDefiLockInfo({ unlockAt: null, cliffAt: null }).isLocked).toBe(false);
  });
});

describe("getDefiEmptyStateConfig", () => {
  it("propose une action distincte par état vide", () => {
    expect(getDefiEmptyStateConfig("no-position").primaryCta).toBe("add");
    expect(getDefiEmptyStateConfig("no-match-filters").primaryCta).toBe("reset-filters");
    expect(getDefiEmptyStateConfig("only-hidden-or-ignored").primaryCta).toBe("show-hidden");
  });

  it("ne renvoie jamais un message vague", () => {
    for (const kind of [
      "no-position",
      "no-match-filters",
      "sync-empty",
      "only-hidden-or-ignored",
      "no-reliable-valuation",
      "no-recognized-protocol",
    ] as const) {
      const cfg = getDefiEmptyStateConfig(kind);
      expect(cfg.title.length).toBeGreaterThan(10);
      expect(cfg.description.length).toBeGreaterThan(10);
    }
  });
});
