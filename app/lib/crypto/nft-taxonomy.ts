/**
 * Vocabulaire du backend NFT — source unique.
 *
 * Objets `as const` plutôt qu'enums Prisma, même convention que
 * `defi-taxonomy.ts` (chantier DeFi F1) : ajouter une catégorie ou une
 * méthode de valorisation ne doit pas coûter une migration. Les colonnes
 * correspondantes sont des `String` documentées ; Zod valide à la frontière
 * HTTP.
 *
 * `NFT_STANDARDS` généralise celui de `nft-constants.ts` (conservé pour
 * compatibilité d'affichage) en ajoutant `SPL_COMPRESSED` — un compressed NFT
 * Solana n'a ni les mêmes garanties de disponibilité ni le même coût de
 * transfert qu'un SPL classique, le confondre masquerait cette différence.
 */

/** ERC_721 | ERC_1155 | SPL | SPL_COMPRESSED */
export const NFT_STANDARDS = {
  ERC_721: "ERC-721",
  ERC_1155: "ERC-1155",
  SPL: "SPL (Solana)",
  SPL_COMPRESSED: "SPL compressé (Solana)",
} as const;

export type NftStandard = keyof typeof NFT_STANDARDS;

/** Chaînes EVM connues — au-delà, `contractAddress` reste la seule identité fiable. */
const EVM_STANDARDS: readonly NftStandard[] = ["ERC_721", "ERC_1155"];
const SOLANA_STANDARDS: readonly NftStandard[] = ["SPL", "SPL_COMPRESSED"];

export function isEvmStandard(standard: string): boolean {
  return (EVM_STANDARDS as readonly string[]).includes(standard);
}

export function isSolanaStandard(standard: string): boolean {
  return (SOLANA_STANDARDS as readonly string[]).includes(standard);
}

/**
 * Un ERC-721 ou un NFT Solana valent structurellement 1 : la quantité n'a de
 * sens que pour un ERC-1155 (semi-fongible/édition). Portée ici plutôt qu'en
 * dur dans la validation : c'est la même règle qui sert à la fois à valider
 * la saisie et à afficher pourquoi une quantité > 1 est refusée.
 */
export function allowsQuantityAboveOne(standard: string): boolean {
  return standard === "ERC_1155";
}

/**
 * Catégorie déclarative — sert au regroupement patrimonial, jamais à un
 * calcul de valeur.
 */
export const NFT_CATEGORIES = {
  PFP: "Avatar (PFP)",
  ART: "Art génératif / 1-of-1",
  GAMING: "Gaming",
  MEMBERSHIP: "Adhésion / accès",
  TICKET: "Billetterie",
  RWA: "Actif réel tokenisé",
  PHOTO: "Photographie",
  MUSIC: "Musique",
  DOMAIN: "Nom de domaine",
  OTHER: "Autre",
  UNKNOWN: "Non classé",
} as const;

export type NftCategory = keyof typeof NFT_CATEGORIES;

export function nftCategoryLabel(value: string): string {
  return NFT_CATEGORIES[value as NftCategory] ?? value;
}

/**
 * Contexte d'accès d'une détention NFT — distinct de `DEFI_ACCESS_MODES` : un
 * NFT n'a pas l'axe DeFi/Hybride/CeFi d'un protocole de rendement (D3 de
 * `docs/nft-backend-v1.md`).
 */
export const NFT_HOLDING_ACCESS_MODES = {
  SELF_CUSTODY: "Wallet auto-détenu",
  CUSTODIAL: "Plateforme / exchange",
  UNKNOWN: "Inconnu",
} as const;

export type NftHoldingAccessMode = keyof typeof NFT_HOLDING_ACCESS_MODES;

/** Repris tel quel du vocabulaire DeFi — même sens, même énumération. */
export const NFT_CUSTODY_MODELS = {
  SELF_CUSTODY: "Auto-détention",
  CUSTODIAL: "Conservation par un tiers",
  SHARED_CUSTODY: "Conservation partagée",
  UNKNOWN: "Inconnu",
} as const;

export type NftCustodyModel = keyof typeof NFT_CUSTODY_MODELS;

export const NFT_DATA_ORIGINS = {
  MANUAL: "Saisie manuelle",
  WALLET_SYNC: "Synchronisation wallet",
  PLATFORM_API: "API plateforme",
  CSV_IMPORT: "Import CSV",
} as const;

export type NftDataOrigin = keyof typeof NFT_DATA_ORIGINS;

const SYNCED_NFT_DATA_ORIGINS: readonly NftDataOrigin[] = ["WALLET_SYNC", "PLATFORM_API"];

export function isSyncedNftOrigin(origin: string): boolean {
  return (SYNCED_NFT_DATA_ORIGINS as readonly string[]).includes(origin);
}

/**
 * Cycle de vie d'une détention NFT.
 *
 * `BURNED`/`TRANSFERRED_OUT`/`SOLD` sortent des totaux patrimoniaux sans
 * sortir de la base — même raisonnement que `DEFI_POSITION_STATUSES` :
 * l'historique d'acquisition et les royalties versées restent dus
 * fiscalement même après la sortie.
 */
export const NFT_HOLDING_STATUSES = {
  HELD: "Détenu",
  LISTED_FOR_SALE: "En vente",
  ESCROWED: "Sous séquestre",
  LOANED_OUT: "Prêté",
  /** Détenu au titre d'un emprunt — n'appartient pas à l'utilisateur, cf. `isNonOwnedStatus`. */
  BORROWED_IN: "Emprunté (garde temporaire)",
  STAKED: "Staké",
  BRIDGED_OUT: "Ponté (bridge)",
  WRAPPED: "Wrappé",
  BURNED: "Brûlé",
  TRANSFERRED_OUT: "Transféré (sortant)",
  SOLD: "Vendu",
  UNKNOWN: "Inconnu",
} as const;

export type NftHoldingStatus = keyof typeof NFT_HOLDING_STATUSES;

export function nftHoldingStatusLabel(value: string): string {
  return NFT_HOLDING_STATUSES[value as NftHoldingStatus] ?? value;
}

/** Statuts qui ferment définitivement l'exposition — sortis du patrimoine actif. */
const INACTIVE_HOLDING_STATUSES: readonly NftHoldingStatus[] = [
  "BURNED",
  "TRANSFERRED_OUT",
  "SOLD",
];

export function isInactiveHoldingStatus(status: string): boolean {
  return (INACTIVE_HOLDING_STATUSES as readonly string[]).includes(status);
}

/**
 * Emprunté ne veut pas dire possédé : le NFT doit être restitué, il ne
 * s'ajoute donc jamais au patrimoine net (même logique qu'un dépôt en garde
 * chez un tiers sans en être propriétaire).
 */
const NON_OWNED_HOLDING_STATUSES: readonly NftHoldingStatus[] = ["BORROWED_IN"];

export function isNonOwnedStatus(status: string): boolean {
  return (NON_OWNED_HOLDING_STATUSES as readonly string[]).includes(status);
}

/** Statuts qui rendent la position illiquide — informatif, jamais bloquant. */
const ILLIQUID_HOLDING_STATUSES: readonly NftHoldingStatus[] = [
  "LISTED_FOR_SALE",
  "ESCROWED",
  "LOANED_OUT",
  "STAKED",
  "BRIDGED_OUT",
  "WRAPPED",
];

export function isIlliquidHoldingStatus(status: string): boolean {
  return (ILLIQUID_HOLDING_STATUSES as readonly string[]).includes(status);
}

/**
 * Méthode de valorisation retenue.
 *
 * Ordre de priorité (cf. règles de valorisation de `docs/nft-backend-v1.md`) :
 * `APPRAISAL` manuelle > `LAST_SALE` récente et fiable > `FLOOR_PRICE` de
 * qualité suffisante > `ACQUISITION_COST_FALLBACK` > `UNKNOWN`. `ZERO` est
 * réservé au spam confirmé (jamais de valorisation positive par défaut).
 */
export const NFT_VALUATION_METHODS = {
  MANUAL: "Saisie manuelle",
  FLOOR_PRICE: "Floor de collection",
  LAST_SALE: "Dernière vente",
  COLLECTION_ESTIMATE: "Estimation de collection",
  APPRAISAL: "Expertise manuelle",
  ACQUISITION_COST_FALLBACK: "Repli sur le coût d'acquisition",
  ZERO: "Valeur nulle (spam confirmé)",
  UNKNOWN: "Inconnue",
} as const;

export type NftValuationMethod = keyof typeof NFT_VALUATION_METHODS;

export function nftValuationMethodLabel(value: string): string {
  return NFT_VALUATION_METHODS[value as NftValuationMethod] ?? value;
}

/** Méthodes qui n'expriment pas un prix réellement observé — informatif à l'affichage. */
const WEAK_NFT_VALUATION_METHODS: readonly NftValuationMethod[] = [
  "ACQUISITION_COST_FALLBACK",
  "COLLECTION_ESTIMATE",
  "UNKNOWN",
  "ZERO",
];

export function isWeakNftValuation(method: string): boolean {
  return (WEAK_NFT_VALUATION_METHODS as readonly string[]).includes(method);
}

/** Confiance par défaut d'une méthode — recalculée si un provider en fournit une. */
const NFT_VALUATION_METHOD_CONFIDENCE: Record<NftValuationMethod, number> = {
  MANUAL: 90,
  APPRAISAL: 85,
  LAST_SALE: 70,
  FLOOR_PRICE: 60,
  COLLECTION_ESTIMATE: 40,
  ACQUISITION_COST_FALLBACK: 25,
  ZERO: 100,
  UNKNOWN: 0,
};

export function defaultNftValuationConfidence(method: string): number {
  return NFT_VALUATION_METHOD_CONFIDENCE[method as NftValuationMethod] ?? 0;
}

export const NFT_PROVIDERS = {
  OPENSEA: "OpenSea",
  BLUR: "Blur",
  MAGIC_EDEN: "Magic Eden",
  TENSOR: "Tensor",
  RESERVOIR: "Reservoir",
  MANUAL: "Saisie manuelle",
} as const;

export type NftProvider = keyof typeof NFT_PROVIDERS;

export function nftProviderLabel(value: string): string {
  return NFT_PROVIDERS[value as NftProvider] ?? value;
}

/** Qualité de la metadata d'un NFT précis ou d'une fiche de collection. */
export const NFT_METADATA_QUALITY = {
  UNKNOWN: "Inconnue",
  PARTIAL: "Partielle",
  COMPLETE: "Complète",
  /** Réponse provider reçue mais inexploitable (JSON invalide, champs clés absents). */
  BROKEN: "Cassée",
} as const;

export type NftMetadataQuality = keyof typeof NFT_METADATA_QUALITY;

export const NFT_VERIFIED_STATUSES = {
  UNVERIFIED: "Non vérifiée",
  VERIFIED: "Vérifiée",
  UNKNOWN: "Inconnu",
} as const;

export type NftVerifiedStatus = keyof typeof NFT_VERIFIED_STATUSES;

/**
 * Statut spam — jamais résolu à l'insu de l'utilisateur (cf. D9 de la note
 * de décision). `IGNORED_BY_USER` permet de requalifier un spam réellement
 * détenu (cas 55 du cahier des charges) sans perdre sa classification
 * technique initiale.
 */
export const NFT_SPAM_STATUSES = {
  CLEAN: "Propre",
  SUSPECTED: "Suspect",
  CONFIRMED_SPAM: "Spam confirmé",
  IGNORED_BY_USER: "Reclassé par l'utilisateur",
} as const;

export type NftSpamStatus = keyof typeof NFT_SPAM_STATUSES;

/** Seul statut qui retire une valorisation positive par défaut. */
export function blocksPositiveValuationByDefault(spamStatus: string): boolean {
  return spamStatus === "CONFIRMED_SPAM";
}

export const NFT_ACQUISITION_SOURCES = {
  MINT: "Mint",
  SECONDARY_PURCHASE: "Achat secondaire",
  TRANSFER_IN: "Transfert entrant",
  AIRDROP: "Airdrop",
  DONATION_IN: "Don reçu",
  BRIDGE_IN: "Pont entrant",
  UNWRAP: "Unwrap",
  UNBUNDLE: "Sortie de bundle",
  MANUAL: "Saisie manuelle",
  WALLET_SYNC: "Découverte par synchronisation",
  UNKNOWN: "Inconnue",
} as const;

export type NftAcquisitionSource = keyof typeof NFT_ACQUISITION_SOURCES;

export const NFT_DISPOSAL_SOURCES = {
  SOLD: "Vente",
  BURNED: "Burn",
  TRANSFER_OUT: "Transfert sortant",
  DONATION_OUT: "Don donné",
  BRIDGE_OUT: "Pont sortant",
  WRAP: "Wrap",
  BUNDLE: "Entrée en bundle",
  LOST: "Perdu (clé/accès)",
  UNKNOWN: "Inconnue",
} as const;

export type NftDisposalSource = keyof typeof NFT_DISPOSAL_SOURCES;

/**
 * Événement de cycle de vie — journal qualitatif, cf. `NftEvent`.
 * `SYNC_MISSING` (D7 de la note de décision) qualifie une disparition du
 * wallet courant sans jamais en déduire silencieusement une vente ou un burn.
 */
export const NFT_EVENT_TYPES = {
  MINT: "Mint",
  BUY: "Achat",
  SELL: "Vente",
  TRANSFER_IN: "Transfert entrant",
  TRANSFER_OUT: "Transfert sortant",
  AIRDROP: "Airdrop",
  DONATION_IN: "Don reçu",
  DONATION_OUT: "Don donné",
  BUNDLE: "Mise en bundle",
  UNBUNDLE: "Sortie de bundle",
  BURN: "Burn",
  LIST: "Mise en vente",
  DELIST: "Retrait de vente",
  BRIDGE_IN: "Pont entrant",
  BRIDGE_OUT: "Pont sortant",
  WRAP: "Wrap",
  UNWRAP: "Unwrap",
  STAKE: "Stake",
  UNSTAKE: "Unstake",
  LOAN_OUT: "Prêt donné",
  LOAN_IN: "Emprunt reçu",
  METADATA_REFRESH: "Rafraîchissement metadata",
  VALUATION_REFRESH: "Rafraîchissement de valorisation",
  SPAM_FLAG: "Signalement spam",
  MANUAL_OVERRIDE: "Surcharge manuelle",
  /** Absent d'un re-scan wallet sans confirmation d'une sortie réelle (D7). */
  SYNC_MISSING: "Disparu de la synchronisation",
} as const;

export type NftEventType = keyof typeof NFT_EVENT_TYPES;

/** Événements adossés à une écriture de journal (déplacent une quantité). */
const LEDGER_BACKED_NFT_EVENTS: readonly NftEventType[] = [
  "MINT",
  "BUY",
  "SELL",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "AIRDROP",
  "DONATION_IN",
  "DONATION_OUT",
  "BURN",
  "BRIDGE_IN",
  "BRIDGE_OUT",
];

export function isLedgerBackedNftEvent(eventType: string): boolean {
  return (LEDGER_BACKED_NFT_EVENTS as readonly string[]).includes(eventType);
}

/**
 * Un standard EVM exige contrat+tokenId ; un standard Solana exige un mint.
 * Sert à la fois à la validation et à la normalisation d'identité.
 */
export function requiresContractIdentity(standard: string): boolean {
  return isEvmStandard(standard);
}

export function requiresMintIdentity(standard: string): boolean {
  return isSolanaStandard(standard);
}
