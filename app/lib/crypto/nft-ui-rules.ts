/**
 * Règles UI centralisées du module NFT — fonctions pures, sans accès Prisma,
 * importables côté client.
 *
 * Même principe que `defi-ui-rules.ts` (chantier F2) : aucune condition sur
 * `addMode`/`standard`/`chain` n'est écrite dans le JSX des composants NFT —
 * tout passe par les fonctions de ce fichier. `nft-taxonomy.ts` et
 * `nft-valuation.ts` sont déjà purs (aucun import Prisma) : ce fichier les
 * réutilise directement plutôt que de dupliquer leurs tables.
 *
 * `ClientNftHolding` est délibérément redéfini ici (et non importé depuis
 * `nft-portfolio-service.ts`) pour ne jamais coupler un composant client à un
 * module qui importe Prisma — même choix que `ClientDefiPosition`.
 */

import {
  NFT_ACQUISITION_SOURCES,
  NFT_CATEGORIES,
  NFT_CUSTODY_MODELS,
  NFT_DISPOSAL_SOURCES,
  NFT_HOLDING_ACCESS_MODES,
  NFT_HOLDING_STATUSES,
  NFT_STANDARDS,
  NFT_VALUATION_METHODS,
  isInactiveHoldingStatus,
  isIlliquidHoldingStatus,
  isNonOwnedStatus,
  isSolanaStandard,
  isWeakNftValuation,
  allowsQuantityAboveOne,
  nftHoldingStatusLabel,
  nftValuationMethodLabel,
  nftProviderLabel,
  nftCategoryLabel,
  type NftStandard,
} from "./nft-taxonomy";
import { NFT_CHAINS, nftChainLabel } from "./nft-constants";

// ─────────────────────────── Types client ───────────────────────────

/** Détention NFT enrichie telle que renvoyée par `GET /api/crypto/nft/portfolio`. */
export type ClientNftHolding = {
  holdingId: string;
  assetId: string;
  nftAssetId: string;
  name: string;
  chainId: string;
  standard: string;
  contractAddress: string | null;
  tokenId: string | null;
  mintAddress: string | null;
  imageUrl: string | null;
  collectionId: string | null;
  collectionName: string | null;
  collectionSlug: string | null;
  collectionVerifiedStatus: string;
  category: string;
  isSpam: boolean;
  isScamSuspected: boolean;
  isWrapped: boolean;
  isBridged: boolean;
  isCompressed: boolean;
  isSoulbound: boolean;
  rarityRank: number | null;
  metadataQuality: string;
  collectionFloorPriceEur: string | null;
  collectionFloorPriceUpdatedAt: string | null;
  collectionCreatorName: string | null;
  collectionCreatorAddress: string | null;
  collectionImageUrl: string | null;
  collectionBannerUrl: string | null;
  collectionExternalUrl: string | null;
  collectionRoyaltiesBps: number | null;
  platformId: string;
  platformName: string;
  ownerLabel: string | null;
  ownershipShare: string | null;
  accessMode: string;
  custodyModel: string;
  dataOrigin: string;
  status: string;
  isHidden: boolean;
  isIgnoredInPortfolio: boolean;
  conflictFlag: boolean;
  conflictReason: string | null;
  linkedHoldingId: string | null;
  acquisitionDate: string | null;
  disposalDate: string | null;
  acquisitionCostEur: string | null;
  quantity: string;
  retainedValueEur: string;
  retainedValueMethod: string;
  retainedValueUpdatedAt: string | null;
  isValuable: boolean;
  isStale: boolean;
  isIlliquid: boolean;
  isDuplicate: boolean;
  eventCount: number;
};

export type ClientNftAggregate = {
  key: string;
  label: string;
  holdingCount: number;
  retainedEur: string;
  acquisitionCostEur: string;
};

export type ClientNftPortfolioBundle = {
  holdings: ClientNftHolding[];
  totals: {
    retainedEur: string;
    acquisitionCostEur: string;
    gainLossEur: string;
    holdingCount: number;
    countedHoldingCount: number;
    spamCount: number;
    suspectedSpamCount: number;
  };
  excluded: {
    ignoredRetainedEur: string;
    ignoredCount: number;
    hiddenCount: number;
    inactiveCount: number;
    nonOwnedCount: number;
    duplicateRetainedEur: string;
    duplicateCount: number;
  };
  byChain: ClientNftAggregate[];
  byCollection: ClientNftAggregate[];
  byCategory: ClientNftAggregate[];
  valuationQuality: {
    unvaluableCount: number;
    staleCount: number;
    weakCount: number;
  };
  conflicts: Array<{ kind: string; keepId: string; duplicateId: string; reason: string }>;
}

// ─────────────────────────── Champs du formulaire ───────────────────────────

export type NftAddMode = "MANUAL" | "WALLET_SYNC" | "CUSTODIAL" | "CSV_IMPORT";

/**
 * Identifiants de champ — un par champ réellement écrit par
 * `createNftManual` (`CreateNftInput`). Aucun champ « avancé » qui n'irait
 * nulle part (royalties, creator address, metadata URL…) n'est modélisé ici :
 * ces informations n'ont pas de colonne d'écriture manuelle en V1 (cf.
 * `docs/nft-backend-v1.md`) — les exposer serait un formulaire à moitié fini.
 */
export type NftFieldId =
  | "addMode"
  | "platformId"
  | "ownerLabel"
  | "ownershipShare"
  | "custodyModel"
  | "accessMode"
  | "chain"
  | "standard"
  | "contractAddr"
  | "tokenId"
  | "quantity"
  | "name"
  | "collectionName"
  | "imageUrl"
  | "collectionSlug"
  | "notes"
  | "acquisitionSource"
  | "acquisitionDate"
  | "acquisitionPriceEur"
  | "manualAppraisalEur";

export type NftFormRuleState = {
  addMode: NftAddMode;
  standard: string;
};

const isEvm = (s: NftFormRuleState) => !isSolanaStandard(s.standard);

/**
 * Visibilité d'un champ — divulgation progressive stricte, même principe que
 * `isDefiFieldVisible`.
 */
export function isNftFieldVisible(field: NftFieldId, s: NftFormRuleState): boolean {
  switch (field) {
    case "contractAddr":
      return isEvm(s);
    default:
      return true;
  }
}

/** Obligation d'un champ — reflète exactement `createSchema` (route POST /api/crypto/nft). */
export function isNftFieldRequired(field: NftFieldId, s: NftFormRuleState): boolean {
  if (!isNftFieldVisible(field, s)) return false;
  switch (field) {
    case "platformId":
    case "chain":
    case "standard":
    case "tokenId":
    case "name":
    case "acquisitionDate":
    case "acquisitionPriceEur":
      return true;
    case "contractAddr":
      return isEvm(s);
    default:
      return false;
  }
}

/** Libellé dynamique — `tokenId` désigne un mint Solana ou un token EVM selon le standard. */
export function getNftFieldLabel(field: NftFieldId, s: NftFormRuleState): string {
  switch (field) {
    case "tokenId":
      return isSolanaStandard(s.standard) ? "Adresse du mint (mint address)" : "Token ID";
    case "contractAddr":
      return "Adresse du contrat";
    case "platformId":
      return "Wallet / plateforme";
    default:
      return FIELD_LABELS[field] ?? field;
  }
}

const FIELD_LABELS: Record<NftFieldId, string> = {
  addMode: "Mode d'ajout",
  platformId: "Wallet / plateforme",
  ownerLabel: "Détenteur (SCI, holding…)",
  ownershipShare: "Quote-part détenue (%)",
  custodyModel: "Mode de garde",
  accessMode: "Contexte d'accès",
  chain: "Chaîne",
  standard: "Standard",
  contractAddr: "Adresse du contrat",
  tokenId: "Token ID",
  quantity: "Quantité",
  name: "Nom",
  collectionName: "Collection",
  imageUrl: "Média principal (URL)",
  collectionSlug: "Slug de collection",
  notes: "Notes",
  acquisitionSource: "Origine de l'acquisition",
  acquisitionDate: "Date d'acquisition",
  acquisitionPriceEur: "Prix d'acquisition (€)",
  manualAppraisalEur: "Expertise manuelle (€)",
};

/** Aide contextuelle courte — jamais un roman. */
export function getNftFieldHelpText(field: NftFieldId, s: NftFormRuleState): string | null {
  switch (field) {
    case "standard":
      return isSolanaStandard(s.standard)
        ? "SPL compressé : stocké et affiché, mais la saisie manuelle ne le distingue pas encore d'un SPL classique (limite V1)."
        : "ERC-1155 autorise une quantité supérieure à 1 (édition, semi-fongible) — ERC-721 vaut toujours 1.";
    case "tokenId":
      return isSolanaStandard(s.standard)
        ? "L'adresse du mint identifie ce NFT sur Solana — jamais fusionnée avec un contrat EVM."
        : "Avec l'adresse du contrat, identifie ce NFT de façon unique.";
    case "quantity":
      return allowsQuantityAboveOne(s.standard)
        ? "Un ERC-1155 peut représenter plusieurs unités identiques (édition)."
        : "Toujours 1 pour ce standard — la quantité n'a de sens que pour un ERC-1155.";
    case "ownershipShare":
      return "100 % si vous détenez seul. Réduisez si le NFT est partagé (indivision, entité commune).";
    case "manualAppraisalEur":
      return "Une expertise manuelle prévaut sur le floor et la dernière vente — y compris si le NFT est plus tard signalé comme spam. Distincte du floor de collection : ne renseignez ce champ que si le marché ne reflète pas la valeur réelle.";
    case "acquisitionPriceEur":
      return "Sert de repli si aucune expertise, floor ou dernière vente n'est disponible.";
    case "imageUrl":
      return "Optionnel — un NFT sans média reste suivi normalement, avec un espace réservé à la place de l'image.";
    case "collectionSlug":
      return "Identifiant technique de la collection sur les marketplaces (ex. boredapeyachtclub).";
    case "custodyModel":
      return "Qui détient réellement les clés ou l'actif au quotidien.";
    default:
      return null;
  }
}

/** Champs à réinitialiser quand `field` change de valeur. */
export function getNftFieldsToResetOnChange(field: NftFieldId): NftFieldId[] {
  switch (field) {
    case "standard":
      return ["contractAddr", "tokenId"];
    case "chain":
      return ["standard", "contractAddr", "tokenId"];
    default:
      return [];
  }
}

// ─────────────────────────── Options de sélection ───────────────────────────

export const NFT_CHAIN_OPTIONS = Object.entries(NFT_CHAINS).map(([value, label]) => ({ value, label }));
export const NFT_STANDARD_OPTIONS = Object.entries(NFT_STANDARDS).map(([value, label]) => ({ value, label }));
export const NFT_CATEGORY_OPTIONS = Object.entries(NFT_CATEGORIES).map(([value, label]) => ({ value, label }));
export const NFT_HOLDING_STATUS_OPTIONS = Object.entries(NFT_HOLDING_STATUSES).map(([value, label]) => ({ value, label }));
export const NFT_VALUATION_METHOD_OPTIONS = Object.entries(NFT_VALUATION_METHODS).map(([value, label]) => ({ value, label }));
export const NFT_ACCESS_MODE_OPTIONS = Object.entries(NFT_HOLDING_ACCESS_MODES).map(([value, label]) => ({ value, label }));
export const NFT_CUSTODY_MODEL_OPTIONS = Object.entries(NFT_CUSTODY_MODELS).map(([value, label]) => ({ value, label }));
/** `WALLET_SYNC` exclu — réservé à la découverte automatique, jamais choisi à la main. */
export const NFT_ACQUISITION_SOURCE_OPTIONS = Object.entries(NFT_ACQUISITION_SOURCES)
  .filter(([key]) => key !== "WALLET_SYNC")
  .map(([value, label]) => ({ value, label }));
export const NFT_DISPOSAL_SOURCE_OPTIONS = Object.entries(NFT_DISPOSAL_SOURCES).map(([value, label]) => ({ value, label }));

/** Standards compatibles avec une chaîne — filtre la liste plutôt que de tout montrer. */
export function nftStandardOptionsForChain(chain: string): Array<{ value: string; label: string }> {
  const solana = chain.trim().toLowerCase() === "solana";
  return NFT_STANDARD_OPTIONS.filter(({ value }) =>
    solana ? isSolanaStandard(value) : !isSolanaStandard(value)
  );
}

export function defaultStandardForChain(chain: string): NftStandard {
  return chain.trim().toLowerCase() === "solana" ? "SPL" : "ERC_721";
}

export {
  NFT_STANDARDS,
  nftHoldingStatusLabel,
  nftValuationMethodLabel,
  nftChainLabel,
  nftProviderLabel,
  nftCategoryLabel,
  isInactiveHoldingStatus,
  isIlliquidHoldingStatus,
  isNonOwnedStatus,
  isSolanaStandard,
  isWeakNftValuation,
  allowsQuantityAboveOne,
};

// ─────────────────────────── Badges ───────────────────────────

export type BadgeTone = "neutral" | "info" | "warning" | "critical" | "success";

export type BadgeSpec = {
  key: string;
  label: string;
  tone: BadgeTone;
  title?: string;
};

/**
 * Badges standardisés d'une détention — risque/anomalies d'abord, contexte
 * ensuite. Le texte porte toujours le sens : la couleur ne fait que renforcer
 * (règle d'accessibilité du cahier des charges).
 */
export function getNftStatusBadges(h: ClientNftHolding): BadgeSpec[] {
  const badges: BadgeSpec[] = [];

  if (h.isSpam) {
    badges.push({
      key: "spam",
      label: "Spam confirmé",
      tone: "critical",
      title: "Exclu de toute valorisation positive par défaut — requalifiable depuis le détail.",
    });
  } else if (h.isScamSuspected) {
    badges.push({
      key: "suspect",
      label: "Suspect",
      tone: "warning",
      title: "Signalé automatiquement comme potentiellement indésirable — à revoir.",
    });
  }

  if (h.conflictFlag || h.isDuplicate) {
    badges.push({
      key: "conflict",
      label: "Doublon détecté",
      tone: "warning",
      title: h.conflictReason ?? "Ce NFT semble compter la même valeur qu'une autre détention.",
    });
  }

  const inactive = isInactiveHoldingStatus(h.status);
  const nonOwned = isNonOwnedStatus(h.status);
  badges.push({
    key: "status",
    label: nftHoldingStatusLabel(h.status),
    tone: inactive || nonOwned ? "neutral" : isIlliquidHoldingStatus(h.status) ? "warning" : "success",
  });

  if (!inactive) {
    if (!h.isValuable) {
      badges.push({
        key: "unvaluable",
        label: "Valeur inconnue",
        tone: "critical",
        title: "Aucune source de valorisation fiable disponible pour l'instant — jamais assimilée à 0 €.",
      });
    } else if (h.isStale) {
      badges.push({
        key: "stale",
        label: "Valorisation périmée",
        tone: "warning",
        title: h.retainedValueUpdatedAt
          ? `Dernière valorisation : ${h.retainedValueUpdatedAt}`
          : "Aucune valorisation récente.",
      });
    } else if (isWeakNftValuation(h.retainedValueMethod)) {
      badges.push({
        key: "weak-valuation",
        label: nftValuationMethodLabel(h.retainedValueMethod),
        tone: "warning",
      });
    }

    if (h.retainedValueMethod === "APPRAISAL") {
      badges.push({ key: "manual-valuation", label: "Expertise manuelle", tone: "info" });
    }
  }

  if (h.isBridged) badges.push({ key: "bridged", label: "Ponté (bridge)", tone: "neutral" });
  if (h.isWrapped) badges.push({ key: "wrapped", label: "Wrappé", tone: "neutral" });
  if (h.isCompressed) badges.push({ key: "compressed", label: "Compressé", tone: "neutral" });
  if (h.isSoulbound) badges.push({ key: "soulbound", label: "Soulbound", tone: "neutral" });

  if (h.isHidden) badges.push({ key: "hidden", label: "Masqué", tone: "neutral" });
  if (h.isIgnoredInPortfolio)
    badges.push({ key: "ignored", label: "Ignoré du patrimoine", tone: "neutral" });

  if (h.metadataQuality === "BROKEN") {
    badges.push({ key: "metadata-broken", label: "Metadata cassée", tone: "warning" });
  } else if (h.metadataQuality === "UNKNOWN" || h.metadataQuality === "PARTIAL") {
    badges.push({ key: "metadata-partial", label: "Metadata incomplète", tone: "neutral" });
  }

  if (!h.imageUrl) badges.push({ key: "no-media", label: "Sans média", tone: "neutral" });

  if (Number(h.quantity) > 1) {
    badges.push({ key: "quantity", label: `× ${h.quantity}`, tone: "neutral" });
  }

  if (h.collectionVerifiedStatus === "UNVERIFIED") {
    badges.push({ key: "unverified-collection", label: "Collection non vérifiée", tone: "neutral" });
  }

  badges.push({ key: "chain", label: nftChainLabel(h.chainId), tone: "neutral" });
  badges.push({ key: "standard", label: NFT_STANDARDS[h.standard as NftStandard] ?? h.standard, tone: "neutral" });

  return badges;
}

// ─────────────────────────── Actions disponibles ───────────────────────────

export type NftActionId =
  | "edit"
  | "hide"
  | "unhide"
  | "ignore"
  | "unignore"
  | "mark-spam"
  | "unmark-spam"
  | "override-valuation"
  | "clear-manual-valuation"
  | "refresh-valuation"
  | "clear-conflict"
  | "dispose"
  | "view-history";

export type ActionSpec = {
  id: NftActionId;
  label: string;
  danger?: boolean;
};

/**
 * Actions disponibles sur une détention, dans l'ordre d'affichage. Un NFT
 * sorti (vendu/brûlé/transféré) ne propose plus que la consultation — même
 * raisonnement que `getDefiAvailableActions`.
 */
export function getNftAvailableActions(h: ClientNftHolding): ActionSpec[] {
  if (isInactiveHoldingStatus(h.status)) {
    return [{ id: "view-history", label: "Voir l'historique" }];
  }

  const actions: ActionSpec[] = [{ id: "edit", label: "Éditer" }];

  actions.push(h.isHidden ? { id: "unhide", label: "Réafficher" } : { id: "hide", label: "Masquer" });
  actions.push(
    h.isIgnoredInPortfolio
      ? { id: "unignore", label: "Réintégrer au patrimoine" }
      : { id: "ignore", label: "Ignorer dans le patrimoine" }
  );

  actions.push(
    h.isSpam || h.isScamSuspected
      ? { id: "unmark-spam", label: "Retirer le signalement spam" }
      : { id: "mark-spam", label: "Marquer comme spam" }
  );

  actions.push(
    h.retainedValueMethod === "APPRAISAL"
      ? { id: "clear-manual-valuation", label: "Retirer l'expertise manuelle" }
      : { id: "override-valuation", label: "Ajouter une expertise manuelle" }
  );
  actions.push({ id: "refresh-valuation", label: "Rafraîchir la valorisation" });

  if (h.conflictFlag) {
    actions.push({ id: "clear-conflict", label: "Lever le conflit (revu)" });
  }

  actions.push({ id: "dispose", label: "Dénouer / sortir du patrimoine", danger: true });

  return actions;
}

// ─────────────────────────── Valorisation ───────────────────────────

export type ValuationDisplay = {
  retainedLabel: string;
  methodLabel: string;
  isStale: boolean;
  isValuable: boolean;
  /** Texte prêt à afficher — jamais "0,00 €" quand la valeur est inconnue. */
  retainedDisplayText: string | null;
  explanation: string;
};

/**
 * Traduction pédagogique de la valorisation retenue — un seul endroit décide
 * du texte, pour que galerie/tableau/détail n'inventent jamais deux
 * explications différentes du même chiffre. `retainedDisplayText: null`
 * signifie « laissez l'appelant afficher le texte "Valeur inconnue" », jamais
 * un montant.
 */
export function getNftValuationDisplay(h: ClientNftHolding): ValuationDisplay {
  return {
    retainedLabel: "Valeur utilisée par l'agrégation patrimoniale",
    methodLabel: nftValuationMethodLabel(h.retainedValueMethod),
    isStale: h.isStale,
    isValuable: h.isValuable,
    retainedDisplayText: h.isValuable ? h.retainedValueEur : null,
    explanation: !h.isValuable
      ? "Aucune source de valorisation fiable disponible — ce NFT compte pour une valeur inconnue, jamais pour zéro."
      : h.isStale
        ? "Valorisation périmée — envisagez un rafraîchissement."
        : isWeakNftValuation(h.retainedValueMethod)
          ? "Valorisation de repli — à considérer avec prudence."
          : "Valorisation à jour.",
  };
}

/**
 * Coût d'acquisition affichable — `null` signifie « non renseigné », jamais
 * "0,00 €". Une détention découverte par synchronisation n'a jamais de coût
 * de revient saisi (`nft-wallet-sync.ts` ne pose pas `acquisitionCostEur`) :
 * le "0.00" que le bundle renvoie par défaut ne doit pas se lire comme un
 * NFT obtenu gratuitement.
 */
export function getNftAcquisitionCostDisplay(h: ClientNftHolding): string | null {
  const isZero = !h.acquisitionCostEur || Number(h.acquisitionCostEur) === 0;
  if (isZero && h.dataOrigin !== "MANUAL") return null;
  return h.acquisitionCostEur ?? null;
}

// ─────────────────────────── États vides ───────────────────────────

export type NftEmptyStateKind =
  | "no-nft"
  | "no-match-filters"
  | "sync-empty"
  | "only-hidden-or-ignored-or-spam"
  | "sync-no-metadata";

export type NftEmptyStateConfig = {
  kind: NftEmptyStateKind;
  title: string;
  description: string;
  primaryCta: "add" | "sync" | "reset-filters" | "show-hidden" | null;
};

export function getNftEmptyStateConfig(kind: NftEmptyStateKind): NftEmptyStateConfig {
  switch (kind) {
    case "no-nft":
      return {
        kind,
        title: "Aucun NFT suivi",
        description:
          "Synchronisez un wallet pour découvrir vos NFT automatiquement, ou ajoutez-en un manuellement.",
        primaryCta: "sync",
      };
    case "no-match-filters":
      return {
        kind,
        title: "Aucun NFT ne correspond aux filtres actuels",
        description: "Élargissez les filtres ou réinitialisez-les pour retrouver vos NFT.",
        primaryCta: "reset-filters",
      };
    case "sync-empty":
      return {
        kind,
        title: "Aucun NFT détecté sur ce wallet",
        description: "La synchronisation a réussi mais n'a trouvé aucun NFT sur cette adresse.",
        primaryCta: "add",
      };
    case "only-hidden-or-ignored-or-spam":
      return {
        kind,
        title: "Tous vos NFT sont masqués, ignorés ou signalés spam",
        description:
          "Ils restent historisés — affichez-les pour les retrouver et les requalifier si besoin.",
        primaryCta: "show-hidden",
      };
    case "sync-no-metadata":
      return {
        kind,
        title: "NFT détectés, mais sans metadata exploitable",
        description:
          "Le provider n'a renvoyé ni nom ni image pour ces NFT — complétez-les manuellement depuis leur détail.",
        primaryCta: null,
      };
  }
}
