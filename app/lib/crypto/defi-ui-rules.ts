/**
 * Règles UI centralisées du module DeFi / CeFi / CeDeFi — fonctions pures,
 * sans accès Prisma, importables côté client.
 *
 * Le cahier des charges F2 l'exige explicitement : « Ne pas disperser les
 * conditions dans le JSX. Centraliser les règles UI. » Ce fichier est la
 * source unique de vérité pour la visibilité des champs, leur obligation,
 * leurs libellés dynamiques, l'aide contextuelle, les badges, les actions
 * disponibles et les resets en cascade. Les composants ne font qu'appeler ces
 * fonctions ; aucun composant ne réimplémente une condition `accessMode ===`.
 *
 * `defi-taxonomy.ts`, `defi-valuation.ts` et consorts sont déjà purs (aucun
 * import Prisma) : ce fichier les réutilise directement plutôt que de
 * dupliquer leurs tables, à la différence des chantiers précédents où le
 * module serveur importait Prisma et forçait une duplication côté client.
 */

import {
  DEFI_ACCESS_MODES,
  DEFI_CUSTODY_MODELS,
  DEFI_POSITION_STATUSES,
  DEFI_VALUATION_METHODS,
  accessModeLabel,
  custodyModelLabel,
  isDebtLeg,
  isIlliquidStatus,
  isInactiveStatus,
  isWeakValuation,
  positionStatusLabel,
  requiresBlockchain,
  requiresProtocol,
  valuationMethodLabel,
  type DefiAccessMode,
} from "./defi-taxonomy";
import { DEFI_POSITION_TYPES, defiPositionTypeLabel, isDebtPosition } from "./constants";

// ─────────────────────────── Types client ───────────────────────────

/** Position enrichie telle que renvoyée par `GET /api/crypto/defi/portfolio`. */
export type ClientDefiPosition = {
  id: string;
  assetId: string;
  assetName: string;
  assetSymbol: string;
  platformId: string;
  platformName: string;

  accessMode: string;
  custodyModel: string;
  dataOrigin: string;
  ownerLabel: string | null;
  ownershipPct: string | null;

  protocol: string;
  protocolVersion: string | null;
  underlyingProtocol: string | null;
  chain: string | null;
  positionType: string;
  marketRef: string | null;
  vaultRef: string | null;
  poolRef: string | null;
  validatorName: string | null;
  nftPositionRef: string | null;

  status: string;
  isLiquid: boolean;
  openedAt: string | null;
  closedAt: string | null;
  isHidden: boolean;
  isIgnoredInPortfolio: boolean;
  strategyId: string | null;

  isConcentrated: boolean;
  priceRangeMin: string | null;
  priceRangeMax: string | null;
  pairedSymbol: string | null;
  unlockAt: string | null;
  cliffAt: string | null;

  legs: Array<{
    legType: string;
    symbol: string;
    quantity: string;
    tokenRole: string | null;
    isActive: boolean;
    valueEur: string | null;
  }>;

  rewards: Array<{
    symbol: string;
    rewardType: string;
    accruedQuantity: string | null;
    claimedQuantity: string | null;
    valueEur: string | null;
    isValuable: boolean;
  }>;

  valuation: {
    grossEur: string;
    netEur: string;
    debtEur: string;
    collateralEur: string;
    rewardsEur: string;
    retainedEur: string;
    underlyingEur: string | null;
    method: string;
    confidenceScore: number;
    fallbackReason: string | null;
    isValuable: boolean;
    unpricedSymbols: string[];
    isStale: boolean;
    lastValuationAt: string | null;
  };

  debt: {
    ltvPct: string | null;
    collateralRatio: string | null;
    healthFactor: string | null;
    reportedHealthFactor: string | null;
    liqThresholdPct: string | null;
    riskLevel: "CRITICAL" | "WARNING" | "OK" | null;
  } | null;

  apyPct: string | null;
  conflict: { flagged: boolean; reason: string | null; excludedFromTotals: boolean };
  eventCount: number;
};

export type ClientDefiAggregate = {
  key: string;
  label: string;
  positionCount: number;
  grossEur: string;
  netEur: string;
  debtEur: string;
  collateralEur: string;
  rewardsEur: string;
  retainedEur: string;
};

export type ClientDefiPortfolioBundle = {
  positions: ClientDefiPosition[];
  filteredPositionCount: number;
  totals: {
    grossEur: string;
    netEur: string;
    debtEur: string;
    collateralEur: string;
    rewardsEur: string;
    retainedEur: string;
    positionCount: number;
    countedPositionCount: number;
  };
  excluded: {
    ignoredRetainedEur: string;
    ignoredCount: number;
    hiddenCount: number;
    inactiveCount: number;
    duplicateRetainedEur: string;
    duplicateCount: number;
  };
  byChain: ClientDefiAggregate[];
  byProtocol: ClientDefiAggregate[];
  byPositionType: ClientDefiAggregate[];
  byAccessMode: ClientDefiAggregate[];
  valuationQuality: {
    byMethod: Array<{ method: string; count: number; retainedEur: string }>;
    weakSharePct: string;
    unvaluableCount: number;
    weightedConfidence: string | null;
    staleCount: number;
  };
  conflicts: Array<{
    kind: string;
    keepId: string;
    duplicateId: string;
    reason: string;
  }>;
  debtAlerts: Array<{
    positionId: string;
    protocol: string;
    riskLevel: "CRITICAL" | "WARNING" | "OK";
    healthFactor: string | null;
    ltvPct: string | null;
  }>;
};

// ─────────────────────────── Champs du formulaire ───────────────────────────

/**
 * Identifiants de champ — un par ligne du cahier des charges F2.
 * Sert de clé unique aux règles ci-dessous ; jamais affiché tel quel.
 */
export type DefiFieldId =
  | "accessMode"
  | "custodyModel"
  | "platformId"
  | "ownerLabel"
  | "ownershipPct"
  | "positionType"
  | "chain"
  | "protocol"
  | "protocolVersion"
  | "underlyingProtocol"
  | "marketRef"
  | "vaultRef"
  | "poolRef"
  | "validatorName"
  | "nftPositionRef"
  | "assetSymbol"
  | "quantity"
  | "unitPriceEur"
  | "pairedSymbol"
  | "pairedAmount"
  | "pairedEntryPriceEur"
  | "isConcentrated"
  | "priceRangeMin"
  | "priceRangeMax"
  | "collateralSymbol"
  | "collateralQuantity"
  | "collateralUnitPriceEur"
  | "healthFactor"
  | "ltvPct"
  | "liqThresholdPct"
  | "pointsAmount"
  | "lockEnabled"
  | "unlockAt"
  | "apyPct"
  | "rewardsSymbol"
  | "rewardsAmount"
  | "rewardsValueEur"
  | "notes";

/**
 * Sous-ensemble de l'état du formulaire nécessaire pour évaluer les règles.
 * Volontairement plat et minimal : les composants passent leur `form` state,
 * cette fonction ne lit que ce dont elle a besoin.
 */
export type DefiFormRuleState = {
  accessMode: DefiAccessMode | string;
  positionType: string;
  isConcentrated?: boolean;
  lockEnabled?: boolean;
  hasCollateral?: boolean;
};

const isDefi = (s: DefiFormRuleState) => s.accessMode === "DEFI";
const isHybrid = (s: DefiFormRuleState) => s.accessMode === "HYBRID";
const isCefi = (s: DefiFormRuleState) => s.accessMode === "CEFI";
const isLp = (s: DefiFormRuleState) => s.positionType === "LP";
const isBorrowing = (s: DefiFormRuleState) => s.positionType === "BORROWING";
const isNativeStaking = (s: DefiFormRuleState) => s.positionType === "STAKING";
const isRestaking = (s: DefiFormRuleState) => s.positionType === "RESTAKING";
const isLockable = (s: DefiFormRuleState) =>
  ["STAKING", "LIQUID_STAKING", "RESTAKING", "VAULT", "RWA", "LOCKED", "LAUNCHPAD"].includes(
    s.positionType
  );
const isRewardEligible = (s: DefiFormRuleState) =>
  [
    "STAKING",
    "LIQUID_STAKING",
    "RESTAKING",
    "LENDING",
    "LP",
    "VAULT",
    "YIELD_FARMING",
    "FIXED_YIELD",
  ].includes(s.positionType) && !isBorrowing(s);

/**
 * Visibilité d'un champ — divulgation progressive stricte.
 *
 * Chaque branche répond à une seule question : « ce champ a-t-il un sens dans
 * cet état ? ». Un champ masqué est exclu de la validation active par
 * construction : c'est `isDefiFieldRequired` qui, appelée seulement sur les
 * champs visibles, empêche un champ masqué de bloquer la soumission.
 */
export function isDefiFieldVisible(field: DefiFieldId, s: DefiFormRuleState): boolean {
  switch (field) {
    case "accessMode":
    case "platformId":
    case "ownerLabel":
    case "ownershipPct":
    case "positionType":
    case "assetSymbol":
    case "quantity":
    case "unitPriceEur":
    case "apyPct":
    case "notes":
      return true;

    case "custodyModel":
      return true;

    case "chain":
    case "protocol":
      return requiresProtocol(s.accessMode) || requiresBlockchain(s.accessMode) || isHybrid(s);

    case "protocolVersion":
      // Affiché seulement quand le protocole est renseigné : une version sans
      // protocole n'a rien à qualifier.
      return isDefi(s) || isHybrid(s);

    case "underlyingProtocol":
      return isHybrid(s);

    case "marketRef":
      return s.positionType === "LENDING" || s.positionType === "BORROWING";
    case "poolRef":
      return isLp(s);
    case "vaultRef":
      return s.positionType === "VAULT";
    case "validatorName":
      return isNativeStaking(s);
    case "nftPositionRef":
      return isLp(s) && Boolean(s.isConcentrated);

    case "pairedSymbol":
    case "pairedAmount":
    case "pairedEntryPriceEur":
      return isLp(s);
    case "isConcentrated":
      return isLp(s);
    case "priceRangeMin":
    case "priceRangeMax":
      return isLp(s) && Boolean(s.isConcentrated);

    case "collateralSymbol":
    case "collateralQuantity":
    case "collateralUnitPriceEur":
      return isBorrowing(s);
    case "healthFactor":
    case "ltvPct":
    case "liqThresholdPct":
      return isBorrowing(s);

    case "pointsAmount":
      return isRestaking(s);

    case "lockEnabled":
      return isLockable(s);
    case "unlockAt":
      return isLockable(s) && Boolean(s.lockEnabled);

    case "rewardsSymbol":
    case "rewardsAmount":
    case "rewardsValueEur":
      return isRewardEligible(s);

    default:
      return true;
  }
}

/**
 * Obligation d'un champ — évaluée seulement pour les champs visibles.
 *
 * Un champ « obligatoire si visible » n'a pas besoin d'un cas dédié ici : la
 * couche formulaire n'appelle cette fonction que sur les champs déjà filtrés
 * par `isDefiFieldVisible`.
 */
export function isDefiFieldRequired(field: DefiFieldId, s: DefiFormRuleState): boolean {
  if (!isDefiFieldVisible(field, s)) return false;

  switch (field) {
    case "accessMode":
    case "platformId":
    case "positionType":
    case "assetSymbol":
    case "quantity":
    case "unitPriceEur":
    case "ownershipPct":
      return true;

    case "chain":
    case "protocol":
      // DeFi directe : la chaîne et le protocole identifient le risque de
      // contrat. Hybride/CeFi : `UNKNOWN_NOT_DISCLOSED` reste une réponse
      // valide, ce n'est donc jamais bloquant côté formulaire.
      return isDefi(s);

    case "pairedSymbol":
    case "pairedAmount":
    case "pairedEntryPriceEur":
      return isLp(s);
    case "priceRangeMin":
    case "priceRangeMax":
      return isLp(s) && Boolean(s.isConcentrated);

    case "collateralSymbol":
    case "collateralQuantity":
    case "collateralUnitPriceEur":
      return isBorrowing(s);

    case "unlockAt":
      return isLockable(s) && Boolean(s.lockEnabled);

    case "ownerLabel":
    case "custodyModel":
    case "protocolVersion":
    case "underlyingProtocol":
    case "marketRef":
    case "vaultRef":
    case "poolRef":
    case "validatorName":
    case "nftPositionRef":
    case "healthFactor":
    case "ltvPct":
    case "liqThresholdPct":
    case "pointsAmount":
    case "apyPct":
    case "rewardsSymbol":
    case "rewardsAmount":
    case "rewardsValueEur":
    case "notes":
    case "lockEnabled":
    case "isConcentrated":
      return false;

    default:
      return false;
  }
}

/** Libellé dynamique — le même champ technique change de nom selon le contexte. */
export function getDefiFieldLabel(field: DefiFieldId, s: DefiFormRuleState): string {
  switch (field) {
    case "platformId":
      return isDefi(s) ? "Wallet" : "Plateforme";
    case "assetSymbol":
      if (isBorrowing(s)) return "Actif emprunté";
      if (s.positionType === "LIQUID_STAKING" || s.positionType === "RESTAKING")
        return "Jeton reçu (receipt token)";
      if (isLp(s)) return "Premier jeton de la paire";
      if (s.positionType === "VAULT") return "Part de vault (share token)";
      return "Actif engagé";
    case "quantity":
      return isBorrowing(s) ? "Quantité empruntée" : "Quantité engagée";
    case "unitPriceEur":
      return isBorrowing(s) ? "Prix unitaire de la dette (€)" : "Prix d'entrée unitaire (€)";
    case "marketRef":
      return isBorrowing(s) ? "Marché d'emprunt" : "Marché de prêt";
    case "poolRef":
      return "Pool de liquidité";
    case "vaultRef":
      return "Vault / stratégie";
    case "chain":
      return "Chaîne";
    case "protocol":
      return "Protocole";
    case "ownerLabel":
      return "Détenteur (SCI, holding…)";
    case "ownershipPct":
      return "Quote-part détenue (%)";
    default:
      return FIELD_LABELS[field] ?? field;
  }
}

const FIELD_LABELS: Record<DefiFieldId, string> = {
  accessMode: "Mode d'accès",
  custodyModel: "Conservation",
  platformId: "Plateforme",
  ownerLabel: "Détenteur",
  ownershipPct: "Quote-part détenue (%)",
  positionType: "Nature de la position",
  chain: "Chaîne",
  protocol: "Protocole",
  protocolVersion: "Version du protocole",
  underlyingProtocol: "Protocole sous-jacent",
  marketRef: "Marché",
  vaultRef: "Vault / stratégie",
  poolRef: "Pool",
  validatorName: "Validateur",
  nftPositionRef: "Référence NFT de position",
  assetSymbol: "Actif",
  quantity: "Quantité",
  unitPriceEur: "Prix unitaire (€)",
  pairedSymbol: "Second jeton",
  pairedAmount: "Quantité du second jeton",
  pairedEntryPriceEur: "Prix d'entrée du second jeton (€)",
  isConcentrated: "Liquidité concentrée",
  priceRangeMin: "Prix minimum",
  priceRangeMax: "Prix maximum",
  collateralSymbol: "Actif du collatéral",
  collateralQuantity: "Quantité de collatéral",
  collateralUnitPriceEur: "Prix unitaire du collatéral (€)",
  healthFactor: "Health factor",
  ltvPct: "LTV (%)",
  liqThresholdPct: "Seuil de liquidation (%)",
  pointsAmount: "Points accumulés",
  lockEnabled: "Position verrouillée",
  unlockAt: "Date de déblocage",
  apyPct: "APR / APY indicatif (%)",
  rewardsSymbol: "Jeton de récompense",
  rewardsAmount: "Quantité de récompense",
  rewardsValueEur: "Valeur de la récompense (€)",
  notes: "Notes",
};

/** Aide contextuelle courte — jamais un roman, une phrase qui prévient une erreur de lecture. */
export function getDefiFieldHelpText(field: DefiFieldId, s: DefiFormRuleState): string | null {
  switch (field) {
    case "accessMode":
      return "DeFi : contrat on-chain. Hybride : plateforme qui route vers un protocole. CeFi : produit d'une plateforme, sans protocole identifiable.";
    case "platformId":
      return isDefi(s)
        ? "Le wallet qui détient réellement les clés."
        : "La plateforme qui détient le produit pour vous.";
    case "protocol":
      return isHybrid(s) || isCefi(s)
        ? "Laissez vide si la plateforme ne le divulgue pas — ne jamais inventer un protocole."
        : "Le contrat qui porte le risque de contrepartie (Aave, Lido, Uniswap…).";
    case "ownershipPct":
      return "100 % si vous détenez seul. Réduisez si la position est partagée (indivision, entité commune).";
    case "assetSymbol":
      if (s.positionType === "LIQUID_STAKING" || s.positionType === "RESTAKING")
        return "Le jeton que vous détenez réellement (ex. stETH), pas l'actif déposé à l'origine.";
      return null;
    case "unitPriceEur":
      return "Sert à l'écriture d'entrée du journal — la valeur affichée ensuite vient du marché, pas de ce prix.";
    case "pairedEntryPriceEur":
    case "collateralUnitPriceEur":
      return "Nécessaire pour calculer la valeur de cette jambe — sans prix, la position ne sera pas valorisable.";
    case "isConcentrated":
      return "Uniswap V3, Curve concentré… : la position ne génère des frais que dans une plage de prix.";
    case "healthFactor":
      return "Sous 1, la position est liquidable. En dessous de 1,3, elle est en zone critique.";
    case "ltvPct":
      return "Dette ÷ collatéral. Au-delà de 70 %, la marge de sécurité devient faible.";
    case "pointsAmount":
      return "Un programme de points n'a pas de marché fiable — il ne compte pas dans la valorisation patrimoniale.";
    case "unlockAt":
      return "Date à laquelle les fonds redeviennent disponibles.";
    case "apyPct":
      return "Purement indicatif — jamais utilisé comme valeur comptable.";
    case "underlyingProtocol":
      return "Si la plateforme ne le précise pas, choisissez « non divulgué » plutôt que d'inventer un nom.";
    default:
      return null;
  }
}

/**
 * Champs à réinitialiser quand `field` change de valeur.
 *
 * Centralisé pour que le changement d'`accessMode` ou de `positionType` ne
 * laisse jamais un champ incompatible peuplé en arrière-plan — un protocole
 * DeFi resté rempli après bascule en CeFi serait soumis silencieusement si
 * l'utilisateur revenait en arrière sans y toucher.
 */
export function getFieldsToResetOnChange(field: DefiFieldId): DefiFieldId[] {
  switch (field) {
    case "accessMode":
      return [
        "platformId",
        "chain",
        "protocol",
        "protocolVersion",
        "underlyingProtocol",
      ];
    case "positionType":
      return [
        "marketRef",
        "vaultRef",
        "poolRef",
        "validatorName",
        "nftPositionRef",
        "pairedSymbol",
        "pairedAmount",
        "pairedEntryPriceEur",
        "isConcentrated",
        "priceRangeMin",
        "priceRangeMax",
        "collateralSymbol",
        "collateralQuantity",
        "collateralUnitPriceEur",
        "healthFactor",
        "ltvPct",
        "liqThresholdPct",
        "pointsAmount",
        "lockEnabled",
        "unlockAt",
        "rewardsSymbol",
        "rewardsAmount",
        "rewardsValueEur",
      ];
    case "isConcentrated":
      return ["priceRangeMin", "priceRangeMax", "nftPositionRef"];
    case "lockEnabled":
      return ["unlockAt"];
    default:
      return [];
  }
}

// ─────────────────────────── Badges ───────────────────────────

export type BadgeTone = "neutral" | "info" | "warning" | "critical" | "success";

export type BadgeSpec = {
  key: string;
  /** Toujours visible même sans couleur — jamais un simple point de couleur. */
  label: string;
  tone: BadgeTone;
  title?: string;
};

/**
 * Badges standardisés d'une position — un par ligne de la section « BADGES /
 * FLAGS À STANDARDISER » du cahier des charges. L'ordre est signifiant :
 * risque et anomalies d'abord (ce qui doit attirer l'œil), contexte ensuite.
 */
export function getDefiStatusBadges(p: ClientDefiPosition): BadgeSpec[] {
  const badges: BadgeSpec[] = [];

  if (p.debt?.riskLevel === "CRITICAL") {
    badges.push({
      key: "risk",
      label: "Risque de liquidation",
      tone: "critical",
      title: "Health factor sous le seuil critique.",
    });
  } else if (p.debt?.riskLevel === "WARNING") {
    badges.push({
      key: "risk",
      label: "À surveiller",
      tone: "warning",
      title: "Health factor ou LTV proche du seuil d'alerte.",
    });
  }

  if (p.conflict.flagged || p.conflict.excludedFromTotals) {
    badges.push({
      key: "conflict",
      label: "Doublon détecté",
      tone: "warning",
      title: p.conflict.reason ?? "Cette position semble compter la même valeur qu'une autre.",
    });
  }

  badges.push({
    key: "access-mode",
    label: accessModeLabel(p.accessMode),
    tone: p.accessMode === "DEFI" ? "info" : p.accessMode === "CEFI" ? "neutral" : "info",
  });

  badges.push({
    key: "status",
    label: positionStatusLabel(p.status),
    tone: isInactiveStatus(p.status)
      ? "neutral"
      : isIlliquidStatus(p.status)
        ? "warning"
        : "success",
  });

  if (p.valuation.isStale) {
    badges.push({
      key: "stale",
      label: "Valorisation périmée",
      tone: "warning",
      title: p.valuation.lastValuationAt
        ? `Dernière valorisation : ${p.valuation.lastValuationAt}`
        : "Aucune valorisation récente.",
    });
  }

  if (!p.valuation.isValuable) {
    badges.push({
      key: "unvaluable",
      label: "Valeur inconnue",
      tone: "critical",
      title: p.valuation.fallbackReason ?? "Aucun prix disponible pour cette position.",
    });
  } else if (isWeakValuation(p.valuation.method)) {
    badges.push({
      key: "weak-valuation",
      label: valuationMethodLabel(p.valuation.method),
      tone: "warning",
      title: p.valuation.fallbackReason ?? undefined,
    });
  }

  if (p.valuation.method === "MANUAL") {
    badges.push({ key: "manual-valuation", label: "Valorisation manuelle", tone: "info" });
  }

  if (isProtocolUnknown(p.protocol, p.underlyingProtocol)) {
    badges.push({
      key: "unknown-protocol",
      label: "Protocole non divulgué",
      tone: "neutral",
    });
  }

  if (p.debt && p.debt.riskLevel == null && (p.valuation.debtEur !== "0.00" || isDebtPosition(p.positionType))) {
    badges.push({ key: "debt", label: "Emprunt", tone: "neutral" });
  }

  if (p.rewards.some((r) => r.isValuable && r.valueEur && Number(r.valueEur) > 0)) {
    badges.push({ key: "rewards", label: "Récompenses en attente", tone: "info" });
  }
  if (p.rewards.some((r) => r.rewardType === "POINTS")) {
    badges.push({ key: "points", label: "Points (hors valorisation)", tone: "neutral" });
  }

  if (p.isHidden) badges.push({ key: "hidden", label: "Masquée", tone: "neutral" });
  if (p.isIgnoredInPortfolio)
    badges.push({ key: "ignored", label: "Ignorée du patrimoine", tone: "neutral" });

  const lock = getDefiLockInfo(p);
  if (lock.isLocked) {
    badges.push({
      key: "lock",
      label: lock.unlockAt ? `Verrouillée jusqu'au ${lock.unlockAt}` : "Verrouillée",
      tone: "warning",
    });
  }

  if (p.isConcentrated) {
    // Pas de statut in-range / out-of-range : il faudrait le prix courant du
    // second jeton, que ce bundle ne va jamais chercher en réseau (cf. limite
    // V1). Afficher « dans la plage » sans preuve serait précisément la donnée
    // incertaine présentée comme sûre que les règles absolues interdisent.
    badges.push({
      key: "clmm",
      label: "Liquidité concentrée",
      tone: "neutral",
      title:
        p.priceRangeMin && p.priceRangeMax
          ? `Plage : ${p.priceRangeMin} – ${p.priceRangeMax} (statut in-range non calculé, prix de marché du second jeton indisponible)`
          : "Bornes de prix non renseignées",
    });
  }

  badges.push({
    key: "provider",
    label: p.dataOrigin === "MANUAL" ? "Saisie manuelle" : "Synchronisée",
    tone: "neutral",
  });

  return badges;
}

/** `UNKNOWN_NOT_DISCLOSED` ou protocole vide — même sens, une seule vérité. */
export function isProtocolUnknown(protocol: string, underlyingProtocol: string | null): boolean {
  const p = protocol.trim().toUpperCase();
  const u = (underlyingProtocol ?? "").trim().toUpperCase();
  return (
    !protocol.trim() ||
    p === "UNKNOWN_NOT_DISCLOSED" ||
    u === "UNKNOWN_NOT_DISCLOSED"
  );
}

export type LockInfo = {
  isLocked: boolean;
  /** Date de déblocage formatée (locale FR courte), ou `null` si inconnue. */
  unlockAt: string | null;
  cliffAt: string | null;
};

/**
 * Statut de verrouillage d'une position — dérivé de `unlockAt`, jamais
 * recalculé ailleurs. `isLocked` compare à la date courante : un `unlockAt`
 * passé ne verrouille plus rien, même si le champ reste renseigné pour
 * l'historique.
 */
export function getDefiLockInfo(p: Pick<ClientDefiPosition, "unlockAt" | "cliffAt">): LockInfo {
  if (!p.unlockAt) return { isLocked: false, unlockAt: null, cliffAt: null };
  const at = new Date(p.unlockAt);
  const isLocked = !Number.isNaN(at.getTime()) && at.getTime() > Date.now();
  return {
    isLocked,
    unlockAt: Number.isNaN(at.getTime()) ? null : at.toLocaleDateString("fr-FR"),
    cliffAt: p.cliffAt ? new Date(p.cliffAt).toLocaleDateString("fr-FR") : null,
  };
}

// ─────────────────────────── Actions disponibles ───────────────────────────

export type DefiActionId =
  | "edit"
  | "hide"
  | "unhide"
  | "ignore"
  | "unignore"
  | "override-valuation"
  | "clear-manual-valuation"
  | "refresh-valuation"
  | "close"
  | "liquidate"
  | "clear-conflict"
  | "view-history";

export type ActionSpec = {
  id: DefiActionId;
  label: string;
  danger?: boolean;
};

/**
 * Actions disponibles sur une position, dans l'ordre d'affichage.
 *
 * Une position fermée/liquidée ne propose plus que la consultation : la
 * modifier ou la valoriser à nouveau n'aurait pas de sens sur une exposition
 * qui n'existe plus.
 */
export function getDefiAvailableActions(p: ClientDefiPosition): ActionSpec[] {
  if (isInactiveStatus(p.status)) {
    return [{ id: "view-history", label: "Voir l'historique" }];
  }

  const actions: ActionSpec[] = [{ id: "edit", label: "Éditer" }];

  actions.push(
    p.isHidden
      ? { id: "unhide", label: "Réafficher" }
      : { id: "hide", label: "Masquer" }
  );
  actions.push(
    p.isIgnoredInPortfolio
      ? { id: "unignore", label: "Réintégrer au patrimoine" }
      : { id: "ignore", label: "Ignorer dans le patrimoine" }
  );

  if (p.valuation.method === "MANUAL") {
    actions.push({ id: "clear-manual-valuation", label: "Retirer la valorisation manuelle" });
  } else {
    actions.push({ id: "override-valuation", label: "Ajouter une valorisation manuelle" });
  }
  actions.push({ id: "refresh-valuation", label: "Rafraîchir la valorisation" });

  if (p.conflict.flagged) {
    actions.push({ id: "clear-conflict", label: "Lever le conflit (revu)" });
  }

  actions.push({ id: "close", label: "Clôturer la position" });
  if (isDebtPosition(p.positionType)) {
    actions.push({ id: "liquidate", label: "Marquer comme liquidée", danger: true });
  }

  return actions;
}

// ─────────────────────────── Valorisation ───────────────────────────

export type ValuationDisplay = {
  grossLabel: string;
  netLabel: string;
  debtLabel: string;
  collateralLabel: string;
  rewardsLabel: string;
  retainedLabel: string;
  methodLabel: string;
  isStale: boolean;
  isValuable: boolean;
  explanation: string;
};

/**
 * Traduction pédagogique d'une décomposition de valorisation — un seul endroit
 * décide de la phrase qui explique chaque montant, pour que le tableau et le
 * détail n'inventent pas deux explications différentes du même chiffre.
 */
export function getDefiValuationDisplay(p: ClientDefiPosition): ValuationDisplay {
  return {
    grossLabel: "Exposition positive avant dette",
    netLabel: "Exposition après déduction de la dette",
    debtLabel: "Passif de la position",
    collateralLabel: "Actif immobilisé en garantie",
    rewardsLabel: "Gains non nécessairement réclamés",
    retainedLabel: "Valeur utilisée dans le patrimoine (nette × quote-part)",
    methodLabel: valuationMethodLabel(p.valuation.method),
    isStale: p.valuation.isStale,
    isValuable: p.valuation.isValuable,
    explanation: !p.valuation.isValuable
      ? (p.valuation.fallbackReason ?? "Aucune valorisation fiable disponible pour l'instant.")
      : isWeakValuation(p.valuation.method)
        ? (p.valuation.fallbackReason ?? "Valorisation de repli — à considérer avec prudence.")
        : "Valorisation à jour.",
  };
}

// ─────────────────────────── États vides ───────────────────────────

export type EmptyStateKind =
  | "no-position"
  | "no-match-filters"
  | "sync-empty"
  | "only-hidden-or-ignored"
  | "no-reliable-valuation"
  | "no-recognized-protocol";

export type EmptyStateConfig = {
  kind: EmptyStateKind;
  title: string;
  description: string;
  primaryCta: "add" | "sync" | "reset-filters" | "show-hidden" | null;
};

export function getDefiEmptyStateConfig(kind: EmptyStateKind): EmptyStateConfig {
  switch (kind) {
    case "no-position":
      return {
        kind,
        title: "Aucune position DeFi",
        description:
          "Ajoutez une position manuellement ou synchronisez un wallet pour démarrer le suivi.",
        primaryCta: "add",
      };
    case "no-match-filters":
      return {
        kind,
        title: "Aucune position ne correspond aux filtres actuels",
        description: "Élargissez les filtres ou réinitialisez-les pour retrouver vos positions.",
        primaryCta: "reset-filters",
      };
    case "sync-empty":
      return {
        kind,
        title: "Aucune position détectée sur ce wallet",
        description:
          "La synchronisation a réussi mais n'a trouvé aucun protocole DeFi actif sur cette adresse.",
        primaryCta: "add",
      };
    case "only-hidden-or-ignored":
      return {
        kind,
        title: "Toutes vos positions sont masquées ou ignorées",
        description:
          "Elles restent comptées ou historisées selon le cas — affichez-les pour les retrouver.",
        primaryCta: "show-hidden",
      };
    case "no-reliable-valuation":
      return {
        kind,
        title: "Des positions ont été détectées, mais aucune valorisation fiable n'est disponible pour l'instant",
        description:
          "Ajoutez une valorisation manuelle en attendant qu'un prix de marché devienne disponible.",
        primaryCta: null,
      };
    case "no-recognized-protocol":
      return {
        kind,
        title: "Aucun protocole reconnu après cet import",
        description:
          "Les positions sont visibles mais leur protocole n'a pas pu être identifié — complétez-les manuellement.",
        primaryCta: null,
      };
  }
}

// ─────────────────────────── Options de sélection ───────────────────────────

/** Options de `positionType` — jamais les dérivés de trading (perps/futures/options/margin). */
export const DEFI_POSITION_TYPE_OPTIONS = Object.entries(DEFI_POSITION_TYPES)
  .filter(([key]) => key !== "OTHER")
  .map(([value, label]) => ({ value, label }));

export const ACCESS_MODE_OPTIONS = Object.entries(DEFI_ACCESS_MODES).map(
  ([value, label]) => ({ value, label })
);

export const CUSTODY_MODEL_OPTIONS = Object.entries(DEFI_CUSTODY_MODELS).map(
  ([value, label]) => ({ value, label })
);

export const VALUATION_METHOD_OPTIONS = Object.entries(DEFI_VALUATION_METHODS).map(
  ([value, label]) => ({ value, label })
);

export const POSITION_STATUS_OPTIONS = Object.entries(DEFI_POSITION_STATUSES).map(
  ([value, label]) => ({ value, label })
);

export {
  defiPositionTypeLabel,
  custodyModelLabel,
  accessModeLabel,
  positionStatusLabel,
  valuationMethodLabel,
};

/** Reprend la logique serveur pour un avertissement en amont de la soumission. */
export function debtLegTypeMismatch(positionType: string, hasDebtLeg: boolean): string | null {
  if (hasDebtLeg && !isDebtLeg("DEBT")) return null; // garde-fou, toujours faux
  if (positionType === "BORROWING" && !hasDebtLeg) {
    return "Un emprunt doit préciser au moins une composante de dette.";
  }
  return null;
}
