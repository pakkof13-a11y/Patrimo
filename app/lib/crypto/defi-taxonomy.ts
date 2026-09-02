/**
 * Vocabulaire du backend DeFi / CeFi / CeDeFi — source unique.
 *
 * Objets `as const` plutôt qu'enums Prisma : c'est la convention du dépôt
 * (`DEFI_POSITION_TYPES`, `CRYPTO_CATEGORIES`, `AssetCategory` étant le seul
 * enum de base), et surtout ajouter une nature de position ou une méthode de
 * valorisation ne doit pas coûter une migration. Les colonnes correspondantes
 * sont des `String` documentées ; Zod valide à la frontière HTTP.
 *
 * Les natures de position elles-mêmes restent dans `constants.ts`
 * (`DEFI_POSITION_TYPES`) : elles y étaient déjà, les déplacer casserait les
 * imports existants sans rien apporter.
 */

/**
 * Contexte d'accès au rendement — l'axe le plus structurant du module.
 *
 * Ce n'est pas une nuance d'affichage : le risque de contrepartie diffère
 * radicalement. En `DEFI`, le risque est celui du contrat ; en `CEFI`, celui du
 * bilan de la plateforme ; en `HYBRID`, les deux se cumulent, ce qui est le cas
 * le plus dangereux et le moins visible.
 */
export const DEFI_ACCESS_MODES = {
  DEFI: "DeFi (on-chain)",
  HYBRID: "Hybride (CeDeFi)",
  CEFI: "CeFi (plateforme)",
} as const;

export type DefiAccessMode = keyof typeof DEFI_ACCESS_MODES;

/**
 * Qui détient réellement les clés.
 *
 * Orthogonal à `accessMode` : un « earn » Coinbase est `CEFI` + `CUSTODIAL`,
 * mais un staking délégué depuis un wallet auto-détenu est `DEFI` +
 * `SELF_CUSTODY` bien que les jetons soient immobilisés chez un validateur.
 */
export const DEFI_CUSTODY_MODELS = {
  SELF_CUSTODY: "Auto-détention",
  CUSTODIAL: "Conservation par un tiers",
  /** Multisig, MPC, coffre partagé — ni purement l'un ni l'autre. */
  SHARED_CUSTODY: "Conservation partagée",
  UNKNOWN: "Inconnu",
} as const;

export type DefiCustodyModel = keyof typeof DEFI_CUSTODY_MODELS;

/**
 * D'où vient la donnée.
 *
 * Détermine la priorité d'écrasement : une ligne `MANUAL` n'est jamais écrasée
 * par une synchronisation (règle déjà en place via `DefiPositionDetail.source`,
 * dont ce champ est la généralisation).
 */
export const DEFI_DATA_ORIGINS = {
  MANUAL: "Saisie manuelle",
  WALLET_SYNC: "Synchronisation wallet",
  PLATFORM_API: "API plateforme",
  CSV_IMPORT: "Import CSV",
} as const;

export type DefiDataOrigin = keyof typeof DEFI_DATA_ORIGINS;

/** Les origines synchronisées — celles qu'une resync a le droit de mettre à jour. */
export const SYNCED_DATA_ORIGINS: readonly DefiDataOrigin[] = [
  "WALLET_SYNC",
  "PLATFORM_API",
];

export function isSyncedOrigin(origin: string): boolean {
  return (SYNCED_DATA_ORIGINS as readonly string[]).includes(origin);
}

/**
 * Rôle économique d'une composante de position.
 *
 * C'est la clé de tout le module : une position n'est pas « un actif et un
 * montant ». Un emprunt Aave, c'est un `COLLATERAL` **et** un `DEBT` ; une LP,
 * deux `ASSET` et un `SHARE` ; un stETH Lido, un `ASSET` déposé et un `RECEIPT`
 * reçu. Sans cette distinction, il est impossible de retrancher une dette ni
 * d'éviter de compter deux fois un dépôt et son reçu.
 */
export const DEFI_LEG_TYPES = {
  /** Actif engagé / déposé. */
  ASSET: "Actif déposé",
  /** Actif immobilisé en garantie d'un emprunt. */
  COLLATERAL: "Collatéral",
  /** Somme due — se retranche toujours. */
  DEBT: "Dette",
  /** Jeton reçu en représentation du dépôt (stETH, aUSDC…). */
  RECEIPT: "Jeton de reçu",
  /** Récompense accumulée, réclamée ou non. */
  REWARD: "Récompense",
  /** Part de pool ou de vault (LP token, vault share). */
  SHARE: "Part de pool / vault",
  /** Sous-jacent d'une part, quand il est connu (décomposition d'une LP). */
  UNDERLYING: "Sous-jacent",
} as const;

export type DefiLegType = keyof typeof DEFI_LEG_TYPES;

/**
 * Seul rôle qui retranche de la valeur.
 *
 * Isolé pour la même raison que `DEBT_POSITION_TYPES` dans `constants.ts` : une
 * dette comptée comme un dépôt gonfle le patrimoine du double de son montant.
 */
export const DEBT_LEG_TYPES: readonly DefiLegType[] = ["DEBT"];

export function isDebtLeg(legType: string): boolean {
  return (DEBT_LEG_TYPES as readonly string[]).includes(legType);
}

/**
 * Rôles qui représentent la **même** exposition que d'autres, sous une autre
 * forme technique. Le cœur de l'anti-double-compte : jamais additionner un
 * `SHARE` et ses `UNDERLYING`, ni un `ASSET` et son `RECEIPT`.
 */
export const REPRESENTATIVE_LEG_TYPES: readonly DefiLegType[] = [
  "RECEIPT",
  "SHARE",
];

export function isRepresentativeLeg(legType: string): boolean {
  return (REPRESENTATIVE_LEG_TYPES as readonly string[]).includes(legType);
}

/**
 * Cycle de vie d'une position.
 *
 * `CLOSED` et `LIQUIDATED` ne sont pas des suppressions : l'historique des
 * récompenses perçues reste dû fiscalement (même raisonnement que
 * `closeDefiPosition`). Elles sortent de la valorisation, pas de la base.
 */
export const DEFI_POSITION_STATUSES = {
  ACTIVE: "Active",
  /** Immobilisée par un verrou contractuel — toujours valorisée. */
  LOCKED: "Verrouillée",
  /** Retrait demandé, fonds pas encore disponibles. */
  WITHDRAWING: "Retrait en cours",
  /** Unbonding d'un staking natif (Cosmos, Polkadot…). */
  UNSTAKING: "Déblocage en cours",
  /** Protocole gelé / marché suspendu — valeur incertaine. */
  PAUSED: "Suspendue",
  CLOSED: "Fermée",
  LIQUIDATED: "Liquidée",
  UNKNOWN: "Inconnu",
} as const;

export type DefiPositionStatus = keyof typeof DEFI_POSITION_STATUSES;

/**
 * Statuts qui sortent une position de la valorisation patrimoniale.
 *
 * Une position fermée ou liquidée n'a plus d'exposition : la valoriser
 * gonflerait le patrimoine d'un montant qui n'existe plus.
 */
export const INACTIVE_POSITION_STATUSES: readonly DefiPositionStatus[] = [
  "CLOSED",
  "LIQUIDATED",
];

export function isInactiveStatus(status: string): boolean {
  return (INACTIVE_POSITION_STATUSES as readonly string[]).includes(status);
}

/** Statuts où les fonds sont engagés mais indisponibles — valorisés, non liquides. */
export const ILLIQUID_POSITION_STATUSES: readonly DefiPositionStatus[] = [
  "LOCKED",
  "WITHDRAWING",
  "UNSTAKING",
  "PAUSED",
];

export function isIlliquidStatus(status: string): boolean {
  return (ILLIQUID_POSITION_STATUSES as readonly string[]).includes(status);
}

/**
 * Comment la valeur a été obtenue.
 *
 * Conservée avec chaque snapshot : une valeur affichée sans sa méthode est
 * inexplicable trois mois plus tard, et un `ACQUISITION_COST_FALLBACK` pris
 * pour un prix de marché fait croire à une position stable alors qu'elle n'est
 * simplement plus cotée.
 */
export const DEFI_VALUATION_METHODS = {
  /** Prix de marché du jeton lui-même. */
  MARKET: "Prix de marché",
  /** Somme des sous-jacents (LP, vault dont la composition est connue). */
  UNDERLYING_ASSETS: "Somme des sous-jacents",
  /** Valeur saisie par l'utilisateur — prévaut quand elle est active. */
  MANUAL: "Saisie manuelle",
  /** Chiffre fourni par le provider, sans recalcul de notre côté. */
  PROVIDER_ESTIMATE: "Estimation du fournisseur",
  /** Repli sur le coût d'acquisition du journal, faute de prix. */
  ACQUISITION_COST_FALLBACK: "Repli sur le coût d'acquisition",
  /** Rien d'exploitable — valeur nulle et position signalée non valorisable. */
  UNKNOWN: "Non valorisable",
} as const;

export type DefiValuationMethod = keyof typeof DEFI_VALUATION_METHODS;

/**
 * Qualité d'une méthode, du plus fiable au moins fiable.
 *
 * Sert aux agrégats : « 80 % du portefeuille DeFi valorisé au marché » est une
 * information de pilotage, « 40 % au coût d'acquisition » un signal d'alerte.
 */
export const VALUATION_METHOD_CONFIDENCE: Record<DefiValuationMethod, number> = {
  MARKET: 100,
  UNDERLYING_ASSETS: 90,
  PROVIDER_ESTIMATE: 70,
  MANUAL: 60,
  ACQUISITION_COST_FALLBACK: 30,
  UNKNOWN: 0,
};

/** Méthodes dont la valeur ne doit pas être présentée comme fiable. */
export const WEAK_VALUATION_METHODS: readonly DefiValuationMethod[] = [
  "ACQUISITION_COST_FALLBACK",
  "UNKNOWN",
];

export function isWeakValuation(method: string): boolean {
  return (WEAK_VALUATION_METHODS as readonly string[]).includes(method);
}

/**
 * Nature d'une récompense.
 *
 * `POINTS` est le cas qui justifie cette liste : un programme de points n'a pas
 * de marché fiable, et le valoriser comme un jeton inventerait du patrimoine.
 * Cf. `isValuableRewardType`.
 */
export const DEFI_REWARD_TYPES = {
  /** Intérêts de prêt, rendement de staking. */
  YIELD: "Rendement",
  /** Frais de trading d'une LP. */
  TRADING_FEES: "Frais de trading",
  /** Émissions de jetons du protocole (gauge, farm). */
  EMISSIONS: "Émissions",
  /** Airdrop attribué mais pas encore réclamé. */
  AIRDROP: "Airdrop",
  /** Points de campagne — hors valorisation par défaut. */
  POINTS: "Points",
  /** Coupon d'un RWA ou d'un produit à rendement fixe. */
  COUPON: "Coupon",
  OTHER: "Autre",
} as const;

export type DefiRewardType = keyof typeof DEFI_REWARD_TYPES;

/**
 * Types de récompense **exclus** de la valorisation patrimoniale par défaut.
 *
 * Un point EigenLayer n'a pas de prix : lui en attribuer un reviendrait à
 * inscrire au patrimoine la spéculation sur un airdrop futur. La valeur réelle
 * reste celle de l'actif engagé, qui est déjà comptée par ailleurs.
 */
export const NON_VALUABLE_REWARD_TYPES: readonly DefiRewardType[] = ["POINTS"];

export function isValuableRewardType(rewardType: string): boolean {
  return !(NON_VALUABLE_REWARD_TYPES as readonly string[]).includes(rewardType);
}

/**
 * Fournisseurs de données DeFi.
 *
 * `ZERION` est le seul implémenté (cf. `defi-sync.ts`) ; les autres ont le
 * contrat et la place dans `DefiSyncCursor` sans implémentation — c'est une
 * limite V1 assumée, documentée dans `docs/defi-backend-v1.md`.
 */
export const DEFI_PROVIDERS = {
  ZERION: "Zerion",
  DEBANK: "DeBank",
  COVALENT: "GoldRush (Covalent)",
  SOLANA_RPC: "Solana RPC",
  /** Import CSV — le « fournisseur » est le fichier. */
  CSV: "Import CSV",
  /** Saisie manuelle — aucun fournisseur. */
  MANUAL: "Manuel",
} as const;

export type DefiProvider = keyof typeof DEFI_PROVIDERS;

/**
 * Nature d'un événement de position.
 *
 * Couvre l'intégralité du cycle de vie demandé au cahier des charges. Les
 * événements sont la trace de ce qui a produit l'exposition courante ; ceux qui
 * déplacent de la quantité portent un `ledgerTransactionId` vers l'écriture de
 * journal correspondante (cf. D7 de la note de décision).
 */
export const DEFI_EVENT_TYPES = {
  DEPOSIT: "Dépôt",
  WITHDRAW: "Retrait",
  STAKE: "Staking",
  UNSTAKE: "Déblocage",
  CLAIM_REWARD: "Réclamation de récompense",
  COMPOUND: "Capitalisation",
  BORROW: "Emprunt",
  REPAY: "Remboursement",
  ADD_LIQUIDITY: "Ajout de liquidité",
  REMOVE_LIQUIDITY: "Retrait de liquidité",
  REBALANCE: "Rééquilibrage",
  MIGRATE: "Migration de protocole",
  LIQUIDATION: "Liquidation",
  BRIDGE_IN: "Arrivée de pont",
  BRIDGE_OUT: "Départ de pont",
  WRAP: "Encapsulation",
  UNWRAP: "Désencapsulation",
  /** Passage de synchronisation — informatif, sans flux. */
  SYNC_REFRESH: "Synchronisation",
  /** Correction manuelle assumée par l'utilisateur. */
  MANUAL_OVERRIDE: "Correction manuelle",
} as const;

export type DefiEventType = keyof typeof DEFI_EVENT_TYPES;

/**
 * Événements qui déplacent de la quantité et doivent donc s'adosser au journal.
 *
 * Le reste (`SYNC_REFRESH`, `REBALANCE`, `MANUAL_OVERRIDE`) est informatif :
 * exiger une écriture de journal pour un simple passage de sync fabriquerait
 * des transactions vides.
 */
export const LEDGER_BACKED_EVENT_TYPES: readonly DefiEventType[] = [
  "DEPOSIT",
  "WITHDRAW",
  "STAKE",
  "UNSTAKE",
  "CLAIM_REWARD",
  "COMPOUND",
  "BORROW",
  "REPAY",
  "ADD_LIQUIDITY",
  "REMOVE_LIQUIDITY",
  "LIQUIDATION",
  "BRIDGE_IN",
  "BRIDGE_OUT",
];

export function isLedgerBackedEvent(eventType: string): boolean {
  return (LEDGER_BACKED_EVENT_TYPES as readonly string[]).includes(eventType);
}

/**
 * Événements de transfert inter-représentations.
 *
 * Signalés à part parce qu'ils sont la source la plus fréquente de double
 * compte : un bridge ou un wrap crée un second jeton pour la **même** valeur
 * économique. Cf. `detectDoubleCounting`.
 */
export const TRANSFER_EVENT_TYPES: readonly DefiEventType[] = [
  "BRIDGE_IN",
  "BRIDGE_OUT",
  "WRAP",
  "UNWRAP",
  "MIGRATE",
];

export function isTransferEvent(eventType: string): boolean {
  return (TRANSFER_EVENT_TYPES as readonly string[]).includes(eventType);
}

/**
 * Marqueur d'un protocole non divulgué.
 *
 * Un produit « Earn » d'exchange ne dit pas toujours où va l'argent. Forcer
 * l'utilisateur à inventer un nom de protocole produirait une donnée fausse ;
 * cette valeur dit explicitement « on ne sait pas », ce qui est exact et
 * exploitable (elle dégrade le score de confiance de la valorisation).
 */
export const UNKNOWN_PROTOCOL = "UNKNOWN_NOT_DISCLOSED";

/** Libellés — tous suivent la même forme, factorisés en un helper par liste. */
function labeller<T extends Record<string, string>>(table: T) {
  return (value: string): string =>
    (table as Record<string, string>)[value] ?? value;
}

export const accessModeLabel = labeller(DEFI_ACCESS_MODES);
export const custodyModelLabel = labeller(DEFI_CUSTODY_MODELS);
export const dataOriginLabel = labeller(DEFI_DATA_ORIGINS);
export const legTypeLabel = labeller(DEFI_LEG_TYPES);
export const positionStatusLabel = labeller(DEFI_POSITION_STATUSES);
export const valuationMethodLabel = labeller(DEFI_VALUATION_METHODS);
export const rewardTypeLabel = labeller(DEFI_REWARD_TYPES);
export const providerLabel = labeller(DEFI_PROVIDERS);
export const eventTypeLabel = labeller(DEFI_EVENT_TYPES);

/** Clés, pour les `z.enum()` des routes — évite de redéclarer les listes. */
export const ACCESS_MODE_KEYS = Object.keys(DEFI_ACCESS_MODES) as [
  DefiAccessMode,
  ...DefiAccessMode[],
];
export const CUSTODY_MODEL_KEYS = Object.keys(DEFI_CUSTODY_MODELS) as [
  DefiCustodyModel,
  ...DefiCustodyModel[],
];
export const DATA_ORIGIN_KEYS = Object.keys(DEFI_DATA_ORIGINS) as [
  DefiDataOrigin,
  ...DefiDataOrigin[],
];
export const LEG_TYPE_KEYS = Object.keys(DEFI_LEG_TYPES) as [
  DefiLegType,
  ...DefiLegType[],
];
export const POSITION_STATUS_KEYS = Object.keys(DEFI_POSITION_STATUSES) as [
  DefiPositionStatus,
  ...DefiPositionStatus[],
];
export const VALUATION_METHOD_KEYS = Object.keys(DEFI_VALUATION_METHODS) as [
  DefiValuationMethod,
  ...DefiValuationMethod[],
];
export const REWARD_TYPE_KEYS = Object.keys(DEFI_REWARD_TYPES) as [
  DefiRewardType,
  ...DefiRewardType[],
];
export const PROVIDER_KEYS = Object.keys(DEFI_PROVIDERS) as [
  DefiProvider,
  ...DefiProvider[],
];
export const EVENT_TYPE_KEYS = Object.keys(DEFI_EVENT_TYPES) as [
  DefiEventType,
  ...DefiEventType[],
];

/**
 * Cohérence `accessMode` ↔ protocole.
 *
 * Une position `DEFI` sans protocole n'a pas de sens : c'est le contrat qui
 * définit le risque. Une position `CEFI` sans protocole en a parfaitement un —
 * la plateforme ne dit pas toujours ce qu'elle fait des fonds, et l'obliger à
 * en déclarer un produirait une donnée inventée.
 */
export function requiresProtocol(accessMode: string): boolean {
  return accessMode === "DEFI";
}

/**
 * Cohérence `accessMode` ↔ chaîne.
 *
 * Même raisonnement : une position on-chain vit sur une chaîne identifiable,
 * un produit custodial pas nécessairement.
 */
export function requiresBlockchain(accessMode: string): boolean {
  return accessMode === "DEFI";
}
