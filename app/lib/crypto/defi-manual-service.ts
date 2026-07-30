/**
 * Saisie manuelle d'une position DeFi.
 *
 * Indispensable et non pas accessoire : Zerion ne couvre que l'EVM. Un staking
 * SOL chez Jito, un « earn » d'exchange, un protocole Bitcoin ou Cosmos ne
 * remontent d'aucune synchronisation — sans saisie manuelle, ces positions
 * seraient purement absentes du patrimoine.
 *
 * Reprend `indirect-service.ts` : actif et écriture d'entrée créés dans la même
 * transaction de base, de sorte qu'un échec ne laisse jamais un actif orphelin.
 */

import type Decimal from "decimal.js";
import { prisma } from "../prisma";
import { d } from "../money/decimal";
import { createTransaction } from "../transactions/service";
import { DEFI_POSITION_TYPES, isDebtPosition } from "./constants";
import {
  DEFI_ACCESS_MODES,
  DEFI_CUSTODY_MODELS,
  DEFI_DATA_ORIGINS,
  DEFI_LEG_TYPES,
  DEFI_POSITION_STATUSES,
  DEFI_REWARD_TYPES,
  requiresBlockchain,
  requiresProtocol,
  type DefiAccessMode,
  type DefiCustodyModel,
  type DefiDataOrigin,
  type DefiLegType,
  type DefiPositionStatus,
  type DefiRewardType,
} from "./defi-taxonomy";

export class DefiInputError extends Error {
  readonly code = "DEFI_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "DefiInputError";
  }
}

/** Jeton d'une LP au-delà du second (3ᵉ à 5ᵉ) — persisté dans `pairedLegs`. */
export type ExtraLpLeg = {
  symbol: string;
  amount: string;
  entryPriceEur: string;
  allocationPct?: string | null;
};

/**
 * Reward au-delà du premier — persisté dans `extraRewardLegs`. Le premier
 * reward garde ses colonnes dédiées (`rewardsSymbol`/`rewardsAmount`/
 * `rewardsValueEur`) pour compatibilité ; ceci ne couvre que les tokens
 * additionnels d'une même position (ex. CRV + gauge token sur Curve).
 */
export type ExtraRewardLeg = {
  symbol: string;
  amount: string;
  valueEur: string;
  /** Origine déclarative — "trading fees", "emissions", campagne… */
  source?: string | null;
};

/** Tranche de vesting saisie — cf. `vesting.ts` pour le calcul de progression. */
export type VestingTrancheInput = {
  cliffAt?: string | null;
  endAt: string;
  amount: string;
};

/**
 * Composante économique saisie — dette, collatéral, jeton de reçu, part.
 *
 * Distincte de `ExtraLpLeg`, qui ne décrit que les jetons supplémentaires d'une
 * LP : ceci couvre les rôles économiques (cf. `DEFI_LEG_TYPES`), c'est-à-dire ce
 * qui permet enfin de décrire un emprunt collatéralisé — un `COLLATERAL` et un
 * `DEBT` sur une même position, au lieu de deux positions sans lien.
 */
export type PositionLegInput = {
  legType: DefiLegType;
  symbol: string;
  quantity: string;
  tokenRole?: string | null;
  unitCostEur?: string | null;
  /** Bornes CLMM, adresse de contrat… — jamais lu par un calcul. */
  metadata?: Record<string, unknown> | null;
};

/** Récompense structurée — remplace à terme `ExtraRewardLeg`. */
export type PositionRewardInput = {
  symbol: string;
  rewardType?: DefiRewardType;
  accruedQuantity?: string | null;
  valueEur?: string | null;
  sourceLabel?: string | null;
};

export type CreateDefiInput = {
  platformId: string;
  /** Actif engagé — « ETH », « USDC »… */
  assetSymbol: string;
  protocol: string;
  positionType: string;
  chain?: string | null;
  /** Rattachement à une stratégie existante (`DefiStrategy`), optionnel. */
  strategyId?: string | null;

  // ── Contexte d'accès (chantier F1) ──
  /** DEFI | HYBRID | CEFI — défaut `DEFI`, le cas historique du module. */
  accessMode?: DefiAccessMode | null;
  custodyModel?: DefiCustodyModel | null;
  /** MANUAL par construction ici ; le paramètre existe pour les imports CSV. */
  dataOrigin?: DefiDataOrigin | null;
  ownerLabel?: string | null;
  /** Quote-part détenue en %, dans ]0, 100]. Absente = 100 %. */
  ownershipPct?: string | null;

  // ── Infrastructure ──
  protocolVersion?: string | null;
  /** `UNKNOWN_NOT_DISCLOSED` est une valeur légitime pour un produit CeFi. */
  underlyingProtocol?: string | null;
  marketRef?: string | null;
  vaultRef?: string | null;
  poolRef?: string | null;
  validatorName?: string | null;
  nftPositionRef?: string | null;

  // ── Cycle de vie ──
  status?: DefiPositionStatus | null;
  isHidden?: boolean;
  isIgnoredInPortfolio?: boolean;
  /** Position liée — jambe opposée d'un pont, ancêtre d'une migration. */
  linkedPositionId?: string | null;

  /**
   * Composantes économiques. Sans elles, la position est décrite par son seul
   * actif principal (comportement historique) ; avec elles, elle peut porter
   * une dette, un collatéral, un reçu et ses sous-jacents.
   */
  legs?: PositionLegInput[] | null;
  /** Récompenses structurées — cumulables avec `extraRewardLegs` (legacy). */
  rewards?: PositionRewardInput[] | null;

  /** Verrou binaire — absent = librement disponible. */
  unlockAt?: string | null;
  cliffAt?: string | null;
  /** Vesting multi-tranches — prime sur `unlockAt`/`cliffAt` si renseigné. */
  vestingSchedule?: VestingTrancheInput[] | null;

  /** Quantité engagée dans le protocole. */
  quantity: string;
  /** Prix unitaire en euros au moment de l'engagement. */
  unitPriceEur: string;
  openedAt: string;

  apyPct?: string | null;
  rewardsSymbol?: string | null;
  rewardsAmount?: string | null;
  rewardsValueEur?: string | null;
  /** Rewards additionnels au-delà du premier (rare, cf. `ExtraRewardLeg`). */
  extraRewardLegs?: ExtraRewardLeg[] | null;

  healthFactor?: string | null;
  ltvPct?: string | null;
  liqThresholdPct?: string | null;

  pairedSymbol?: string | null;
  pairedAmount?: string | null;
  /** Prix (EUR) du second jeton à l'engagement — requis pour l'IL. */
  pairedEntryPriceEur?: string | null;
  poolAddress?: string | null;

  /** 3ᵉ à 5ᵉ jeton d'une LP multi-actifs (Curve, Balancer…). */
  extraLegs?: ExtraLpLeg[] | null;

  /** Liquidité concentrée façon Uniswap V3 / Curve concentré. */
  isConcentrated?: boolean;
  priceRangeMin?: string | null;
  priceRangeMax?: string | null;
  token1AllocationPct?: string | null;
  pairedAllocationPct?: string | null;

  notes?: string | null;
};

export type CreateDefiResult = {
  assetId: string;
  positionId: string;
  engagedEur: string;
};

function dec(v: string | null | undefined) {
  if (v == null || v === "") return null;
  const n = d(v);
  return n.isFinite() ? n.toString() : null;
}

/**
 * Décimal tolérant à une saisie non numérique.
 *
 * `d()` lève une `DecimalError` brute sur « abc », ce qui remonterait en 500
 * alors qu'il s'agit d'une saisie invalide — donc d'un 400. Les validateurs
 * ci-dessous passent par ici pour pouvoir refuser proprement, avec un message
 * qui nomme le champ fautif. Zod filtre déjà l'essentiel à la frontière HTTP,
 * mais ces fonctions sont aussi appelées directement (imports, scripts).
 */
function parseDec(v: string | null | undefined): Decimal | null {
  if (v == null || v === "") return null;
  try {
    const n = d(v);
    return n.isFinite() ? n : null;
  } catch {
    return null;
  }
}

const MAX_LP_TOKENS = 5;
const ALLOCATION_SUM_TOLERANCE_PCT = 0.5;

/**
 * Valide une LP multi-actifs et, si concentrée, sa plage de prix et sa
 * répartition. Isolée du corps principal parce que ces règles ne concernent
 * qu'un `positionType === "LP"` — les mélanger aux checks génériques rendrait
 * les erreurs des positions STAKING/LENDING/… illisibles.
 */
export function validateLpInput(
  input: CreateDefiInput,
  primarySymbol: string,
  extraLegs: ExtraLpLeg[]
): void {
  const pairedSymbol = input.pairedSymbol?.trim().toUpperCase() || "";
  if (!pairedSymbol) {
    throw new DefiInputError(
      "Une position LP requiert au moins un second jeton"
    );
  }
  const pairedAmount = d(input.pairedAmount ?? "");
  if (!pairedAmount.isFinite() || pairedAmount.lte(0)) {
    throw new DefiInputError("La quantité du second jeton est requise");
  }
  const pairedEntry = d(input.pairedEntryPriceEur ?? "");
  if (!pairedEntry.isFinite() || pairedEntry.lte(0)) {
    throw new DefiInputError(
      "Le prix d'entrée du second jeton est requis (nécessaire au calcul de l'IL)"
    );
  }

  const symbols = [primarySymbol, pairedSymbol];
  for (const leg of extraLegs) {
    const sym = leg.symbol.trim().toUpperCase();
    if (!sym) throw new DefiInputError("Chaque jeton supplémentaire doit être renseigné");
    const amount = d(leg.amount);
    if (!amount.isFinite() || amount.lte(0)) {
      throw new DefiInputError(`Quantité invalide pour ${sym}`);
    }
    const entry = d(leg.entryPriceEur);
    if (!entry.isFinite() || entry.lte(0)) {
      throw new DefiInputError(
        `Prix d'entrée requis pour ${sym} (nécessaire au calcul de l'IL)`
      );
    }
    symbols.push(sym);
  }

  if (symbols.length > MAX_LP_TOKENS) {
    throw new DefiInputError(`Une LP ne peut pas dépasser ${MAX_LP_TOKENS} jetons`);
  }
  if (new Set(symbols).size !== symbols.length) {
    throw new DefiInputError("Les jetons d'une LP doivent être distincts");
  }

  if (input.isConcentrated) {
    const min = d(input.priceRangeMin ?? "");
    const max = d(input.priceRangeMax ?? "");
    if (!min.isFinite() || !max.isFinite() || min.lte(0) || max.lte(0)) {
      throw new DefiInputError(
        "La plage de prix (min et max) est requise pour une position concentrée"
      );
    }
    if (min.gte(max)) {
      throw new DefiInputError("Le prix minimum doit être inférieur au prix maximum");
    }

    // Répartition : exigée dans son ensemble dès qu'un seul champ est posé,
    // sinon un token1% renseigné sans le reste laisserait croire à une
    // répartition à moitié saisie.
    const allocations = [
      input.token1AllocationPct,
      input.pairedAllocationPct,
      ...extraLegs.map((l) => l.allocationPct),
    ];
    const anyProvided = allocations.some((a) => a != null && a !== "");
    if (anyProvided) {
      if (allocations.some((a) => a == null || a === "")) {
        throw new DefiInputError(
          "Renseignez la répartition (%) de tous les jetons, ou aucun"
        );
      }
      const sum = allocations.reduce((s, a) => s.plus(d(a as string)), d(0));
      if (sum.minus(100).abs().gt(ALLOCATION_SUM_TOLERANCE_PCT)) {
        throw new DefiInputError(
          `La somme des répartitions doit être égale à 100 % (actuellement ${sum.toFixed(1)} %)`
        );
      }
    }
  }
}

const MAX_EXTRA_REWARD_LEGS = 5;

/**
 * Valide les rewards additionnels (au-delà du premier). Isolée pour la même
 * raison que `validateLpInput` : ces règles ne concernent que le sac
 * `extraRewardLegs`, pas les champs génériques de la position.
 */
export function validateRewardLegs(
  primarySymbol: string | null | undefined,
  extraLegs: ExtraRewardLeg[]
): void {
  if (extraLegs.length === 0) return;
  if (extraLegs.length > MAX_EXTRA_REWARD_LEGS) {
    throw new DefiInputError(
      `Un maximum de ${MAX_EXTRA_REWARD_LEGS} rewards additionnels est accepté`
    );
  }

  const symbols = primarySymbol ? [primarySymbol.trim().toUpperCase()] : [];
  for (const leg of extraLegs) {
    const sym = leg.symbol.trim().toUpperCase();
    if (!sym) throw new DefiInputError("Chaque reward additionnel doit préciser son jeton");

    const amount = d(leg.amount);
    if (!amount.isFinite() || amount.lte(0)) {
      throw new DefiInputError(`Quantité invalide pour le reward ${sym}`);
    }
    const valueEur = d(leg.valueEur);
    if (!valueEur.isFinite() || valueEur.lt(0)) {
      throw new DefiInputError(`Valeur en euros invalide pour le reward ${sym}`);
    }
    symbols.push(sym);
  }

  if (new Set(symbols).size !== symbols.length) {
    throw new DefiInputError("Les rewards d'une même position doivent porter des jetons distincts");
  }
}

/**
 * Valide les tranches de vesting saisies. Purement syntaxique (dates valides,
 * montants positifs) — la logique de progression (cliff, linéaire…) vit dans
 * `vesting.ts`, un module pur qui n'a pas à connaître `DefiInputError`.
 */
export function validateVestingSchedule(schedule: VestingTrancheInput[]): void {
  for (const tranche of schedule) {
    const endAt = new Date(tranche.endAt);
    if (Number.isNaN(endAt.getTime())) {
      throw new DefiInputError("Échéance de vesting invalide");
    }
    if (tranche.cliffAt) {
      const cliffAt = new Date(tranche.cliffAt);
      if (Number.isNaN(cliffAt.getTime())) {
        throw new DefiInputError("Date de cliff invalide");
      }
      if (cliffAt > endAt) {
        throw new DefiInputError("Le cliff doit précéder l'échéance de la tranche");
      }
    }
    const amount = d(tranche.amount);
    if (!amount.isFinite() || amount.lte(0)) {
      throw new DefiInputError("Quantité de vesting invalide");
    }
  }
}

/**
 * Cohérence du contexte d'accès.
 *
 * Exportée et testée à part : ces règles disent ce qu'une position a le droit
 * de ne pas renseigner, et une seule d'entre elles mal appliquée produit soit un
 * refus injustifié (un « Earn » d'exchange qui n'a pas de protocole à déclarer),
 * soit une donnée creuse (une position on-chain sans contrat identifié).
 */
export function validateAccessContext(input: CreateDefiInput): void {
  const accessMode = input.accessMode ?? "DEFI";
  if (!(accessMode in DEFI_ACCESS_MODES)) {
    throw new DefiInputError("Mode d'accès inconnu");
  }
  if (input.custodyModel && !(input.custodyModel in DEFI_CUSTODY_MODELS)) {
    throw new DefiInputError("Modèle de conservation inconnu");
  }
  if (input.dataOrigin && !(input.dataOrigin in DEFI_DATA_ORIGINS)) {
    throw new DefiInputError("Origine de donnée inconnue");
  }
  if (input.status && !(input.status in DEFI_POSITION_STATUSES)) {
    throw new DefiInputError("Statut de position inconnu");
  }

  // Une position on-chain sans protocole ni chaîne n'est pas identifiable : le
  // risque qu'elle porte est celui d'un contrat qu'on ne sait pas nommer.
  if (requiresProtocol(accessMode) && !input.protocol?.trim()) {
    throw new DefiInputError(
      "Une position DeFi doit préciser son protocole — utilisez le mode CEFI si la plateforme ne le divulgue pas"
    );
  }
  if (requiresBlockchain(accessMode) && !input.chain?.trim()) {
    throw new DefiInputError(
      "Une position DeFi doit préciser sa chaîne — utilisez le mode CEFI pour un produit custodial"
    );
  }

  if (input.ownershipPct != null && input.ownershipPct !== "") {
    const pct = parseDec(input.ownershipPct);
    if (pct == null || pct.lte(0) || pct.gt(100)) {
      throw new DefiInputError("La quote-part doit être comprise dans ]0 ; 100]");
    }
  }

  // Une position déclarée fermée à la création n'a aucun sens : elle n'aurait
  // jamais eu d'exposition, et l'écriture d'entrée du journal la contredirait.
  if (input.status === "CLOSED" || input.status === "LIQUIDATED") {
    throw new DefiInputError(
      `Une position ne peut pas être créée avec le statut ${input.status} — créez-la active puis dénouez-la`
    );
  }
}

const MAX_LEGS = 12;

/**
 * Cohérence des composantes économiques.
 *
 * La règle qui compte : un emprunt doit porter sa dette. Sans elle, une position
 * `BORROWING` valorisée comme un dépôt gonflerait le patrimoine du montant exact
 * de ce qu'on doit — l'erreur serait doublée, pas neutre.
 */
export function validateLegs(
  positionType: string,
  legs: PositionLegInput[]
): void {
  if (legs.length === 0) {
    // Un emprunt sans jambes reste accepté : c'est le comportement historique,
    // où la dette est portée par l'actif principal. On ne casse pas l'existant.
    return;
  }
  if (legs.length > MAX_LEGS) {
    throw new DefiInputError(`Une position ne peut pas dépasser ${MAX_LEGS} composantes`);
  }

  const seen = new Set<string>();
  for (const leg of legs) {
    if (!(leg.legType in DEFI_LEG_TYPES)) {
      throw new DefiInputError(`Rôle de composante inconnu : ${leg.legType}`);
    }
    const symbol = leg.symbol.trim().toUpperCase();
    if (!symbol) throw new DefiInputError("Chaque composante doit porter un symbole");

    const qty = parseDec(leg.quantity);
    if (qty == null || qty.lte(0)) {
      throw new DefiInputError(`Quantité invalide pour la composante ${symbol}`);
    }

    // Le couple (rôle, symbole) est la clé logique d'une composante : deux
    // lignes `DEBT`/`USDC` sur la même position sont une saisie en double, pas
    // deux dettes distinctes.
    const key = `${leg.legType}|${symbol}`;
    if (seen.has(key)) {
      throw new DefiInputError(`Composante ${leg.legType} ${symbol} déclarée deux fois`);
    }
    seen.add(key);
  }

  if (positionType === "BORROWING" && !legs.some((l) => l.legType === "DEBT")) {
    throw new DefiInputError(
      "Un emprunt doit déclarer au moins une composante DEBT — sans elle, la dette ne serait pas retranchée du patrimoine"
    );
  }
  // Une dette déclarée sur autre chose qu'un emprunt ou un CDP est une erreur de
  // saisie : elle se retrancherait du patrimoine sans qu'aucun libellé ne
  // l'explique.
  if (
    legs.some((l) => l.legType === "DEBT") &&
    positionType !== "BORROWING" &&
    positionType !== "CDP"
  ) {
    throw new DefiInputError(
      `Une composante DEBT n'a pas de sens sur une position ${positionType} — utilisez BORROWING ou CDP`
    );
  }
}

/** Cohérence des récompenses structurées. */
export function validateRewards(rewards: PositionRewardInput[]): void {
  const seen = new Set<string>();
  for (const r of rewards) {
    const symbol = r.symbol.trim().toUpperCase();
    if (!symbol) throw new DefiInputError("Chaque récompense doit préciser son jeton");
    const rewardType = r.rewardType ?? "YIELD";
    if (!(rewardType in DEFI_REWARD_TYPES)) {
      throw new DefiInputError(`Nature de récompense inconnue : ${rewardType}`);
    }
    const key = `${symbol}|${rewardType}`;
    if (seen.has(key)) {
      throw new DefiInputError(`Récompense ${symbol} (${rewardType}) déclarée deux fois`);
    }
    seen.add(key);

    if (r.accruedQuantity != null && r.accruedQuantity !== "") {
      const qty = parseDec(r.accruedQuantity);
      if (qty == null || qty.lt(0)) {
        throw new DefiInputError(`Quantité de récompense invalide pour ${symbol}`);
      }
    }
    if (r.valueEur != null && r.valueEur !== "") {
      const value = parseDec(r.valueEur);
      if (value == null || value.lt(0)) {
        throw new DefiInputError(`Valeur de récompense invalide pour ${symbol}`);
      }
      // Les points n'ont pas de valeur de marché : accepter un montant en euros
      // les ferait entrer dans les agrégats patrimoniaux par une porte dérobée.
      if (rewardType === "POINTS" && value.gt(0)) {
        throw new DefiInputError(
          "Un programme de points n'a pas de valeur de marché — laissez la valeur vide"
        );
      }
    }
  }
}

export async function createDefiPosition(
  userId: string,
  input: CreateDefiInput
): Promise<CreateDefiResult> {
  const platform = await prisma.platform.findFirst({
    where: { id: input.platformId, userId },
    select: { id: true },
  });
  if (!platform) throw new DefiInputError("Plateforme introuvable");

  const symbol = input.assetSymbol.trim().toUpperCase();
  if (!symbol) throw new DefiInputError("L'actif engagé est requis");

  const protocol = input.protocol.trim();
  if (!protocol) throw new DefiInputError("Le protocole est requis");

  if (!(input.positionType in DEFI_POSITION_TYPES)) {
    throw new DefiInputError("Type de position DeFi inconnu");
  }

  const quantity = d(input.quantity);
  if (!quantity.isFinite() || quantity.lte(0)) {
    throw new DefiInputError("La quantité doit être strictement positive");
  }

  const unitPrice = d(input.unitPriceEur);
  if (!unitPrice.isFinite() || unitPrice.lt(0)) {
    throw new DefiInputError("Le prix unitaire ne peut pas être négatif");
  }

  const openedAt = new Date(input.openedAt);
  if (Number.isNaN(openedAt.getTime())) {
    throw new DefiInputError("Date d'engagement invalide");
  }

  // Un emprunt sans santé renseignée est accepté, mais c'est le seul cas où
  // l'information manquante coûte cher : sans health factor, aucune alerte de
  // liquidation ne peut se déclencher.
  const isDebt = isDebtPosition(input.positionType);

  const isLp = input.positionType === "LP";
  const extraLegs = isLp ? (input.extraLegs ?? []) : [];

  if (isLp) {
    validateLpInput(input, symbol, extraLegs);
  }

  const pairedLegsJson =
    extraLegs.length > 0
      ? extraLegs.map((leg) => ({
          symbol: leg.symbol.trim().toUpperCase(),
          amount: dec(leg.amount),
          entryPriceEur: dec(leg.entryPriceEur),
          allocationPct: dec(leg.allocationPct),
        }))
      : undefined;

  const extraRewardLegs = input.extraRewardLegs ?? [];
  validateRewardLegs(input.rewardsSymbol, extraRewardLegs);
  const extraRewardLegsJson =
    extraRewardLegs.length > 0
      ? extraRewardLegs.map((leg) => ({
          symbol: leg.symbol.trim().toUpperCase(),
          amount: dec(leg.amount),
          valueEur: dec(leg.valueEur),
          source: leg.source?.trim() || null,
        }))
      : undefined;

  const vestingSchedule = input.vestingSchedule ?? [];
  validateVestingSchedule(vestingSchedule);
  const vestingScheduleJson =
    vestingSchedule.length > 0
      ? vestingSchedule.map((t) => ({
          cliffAt: t.cliffAt || null,
          endAt: t.endAt,
          amount: dec(t.amount),
        }))
      : undefined;
  const unlockAt = input.unlockAt ? new Date(input.unlockAt) : null;
  if (unlockAt && Number.isNaN(unlockAt.getTime())) {
    throw new DefiInputError("Date de déblocage invalide");
  }
  const cliffAt = input.cliffAt ? new Date(input.cliffAt) : null;
  if (cliffAt && Number.isNaN(cliffAt.getTime())) {
    throw new DefiInputError("Date de cliff invalide");
  }

  if (input.strategyId) {
    const strategy = await prisma.defiStrategy.findFirst({
      where: { id: input.strategyId, userId },
      select: { id: true },
    });
    if (!strategy) throw new DefiInputError("Stratégie introuvable");
  }

  // Contexte d'accès, composantes et récompenses structurées — chantier F1.
  validateAccessContext(input);
  const positionLegs = input.legs ?? [];
  validateLegs(input.positionType, positionLegs);
  const positionRewards = input.rewards ?? [];
  validateRewards(positionRewards);

  if (input.linkedPositionId) {
    const linked = await prisma.defiPositionDetail.findFirst({
      where: { id: input.linkedPositionId, asset: { is: { userId } } },
      select: { id: true },
    });
    if (!linked) throw new DefiInputError("Position liée introuvable");
  }

  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.create({
      data: {
        userId,
        platformId: platform.id,
        name: `${symbol} · ${protocol}`.slice(0, 120),
        ticker: symbol.slice(0, 24),
        assetClass: "CRYPTO",
        category: "CRYPTO",
        accountType: "CRYPTO",
        currency: "EUR",
        priceProvider: "MANUAL",
        manualPrice: unitPrice.toFixed(12),
        acquisitionDate: openedAt,
        notes: input.notes?.trim() || null,
      },
    });

    const detail = await tx.defiPositionDetail.create({
      data: {
        assetId: asset.id,
        strategyId: input.strategyId || null,
        protocol,
        chain: input.chain?.trim() || null,
        positionType: input.positionType,
        pairedSymbol: input.pairedSymbol?.trim().toUpperCase() || null,
        pairedAmount: dec(input.pairedAmount),
        pairedEntryPriceEur: dec(input.pairedEntryPriceEur),
        pairedLegs: pairedLegsJson,
        isConcentrated: isLp ? Boolean(input.isConcentrated) : false,
        priceRangeMin: isLp && input.isConcentrated ? dec(input.priceRangeMin) : null,
        priceRangeMax: isLp && input.isConcentrated ? dec(input.priceRangeMax) : null,
        token1AllocationPct: isLp ? dec(input.token1AllocationPct) : null,
        pairedAllocationPct: isLp ? dec(input.pairedAllocationPct) : null,
        poolAddress: input.poolAddress?.trim() || null,
        apyPct: dec(input.apyPct),
        rewardsSymbol: input.rewardsSymbol?.trim().toUpperCase() || null,
        rewardsAmount: dec(input.rewardsAmount),
        rewardsValueEur: dec(input.rewardsValueEur),
        extraRewardLegs: extraRewardLegsJson,
        unlockAt,
        cliffAt,
        vestingSchedule: vestingScheduleJson,
        healthFactor: isDebt ? dec(input.healthFactor) : null,
        ltvPct: isDebt ? dec(input.ltvPct) : null,
        liqThresholdPct: isDebt ? dec(input.liqThresholdPct) : null,
        source: "MANUAL",
        notes: input.notes?.trim() || null,

        // Contexte d'accès et cycle de vie — chantier F1.
        accessMode: input.accessMode ?? "DEFI",
        custodyModel: input.custodyModel ?? "UNKNOWN",
        dataOrigin: input.dataOrigin ?? "MANUAL",
        ownerLabel: input.ownerLabel?.trim() || null,
        ownershipPct: dec(input.ownershipPct),
        protocolVersion: input.protocolVersion?.trim() || null,
        underlyingProtocol: input.underlyingProtocol?.trim() || null,
        marketRef: input.marketRef?.trim() || null,
        vaultRef: input.vaultRef?.trim() || null,
        poolRef: input.poolRef?.trim() || null,
        validatorName: input.validatorName?.trim() || null,
        nftPositionRef: input.nftPositionRef?.trim() || null,
        status: input.status ?? "ACTIVE",
        openedAt,
        isHidden: input.isHidden ?? false,
        isIgnoredInPortfolio: input.isIgnoredInPortfolio ?? false,
        linkedPositionId: input.linkedPositionId || null,
      },
    });

    // Composantes économiques. La jambe de l'actif principal est ajoutée
    // d'office quand la saisie n'en fournit aucune de rôle `ASSET`/`DEBT` :
    // sans elle, la position n'aurait aucune exposition et sortirait des
    // totaux, alors que l'écriture de journal ci-dessous l'engage bien.
    if (positionLegs.length > 0) {
      const hasPrimary = positionLegs.some(
        (l) =>
          l.symbol.trim().toUpperCase() === symbol &&
          (l.legType === "ASSET" || l.legType === "DEBT" || l.legType === "COLLATERAL")
      );
      const legsToWrite: PositionLegInput[] = hasPrimary
        ? positionLegs
        : [
            {
              legType: isDebt ? "DEBT" : "ASSET",
              symbol,
              quantity: quantity.toString(),
              unitCostEur: unitPrice.toFixed(12),
              tokenRole: "primary",
            },
            ...positionLegs,
          ];

      await tx.defiLeg.createMany({
        data: legsToWrite.map((leg) => ({
          defiPositionId: detail.id,
          legType: leg.legType,
          symbol: leg.symbol.trim().toUpperCase(),
          quantity: d(leg.quantity).toString(),
          // Seule la jambe du symbole principal est rattachée à l'`Asset` : les
          // autres n'ont pas de position ouverte propre, elles n'existent que
          // comme composantes de celle-ci.
          assetId: leg.symbol.trim().toUpperCase() === symbol ? asset.id : null,
          tokenRole: leg.tokenRole?.trim() || null,
          unitCostEur: dec(leg.unitCostEur),
          metadataJson: (leg.metadata ?? undefined) as never,
        })),
      });
    }

    for (const reward of positionRewards) {
      const rewardType = reward.rewardType ?? "YIELD";
      await tx.defiReward.create({
        data: {
          defiPositionId: detail.id,
          symbol: reward.symbol.trim().toUpperCase(),
          rewardType,
          accruedQuantity: dec(reward.accruedQuantity),
          // Forcée à `null` pour un programme de points, quelle que soit la
          // saisie : cf. `validateRewards`.
          valueEur: rewardType === "POINTS" ? null : dec(reward.valueEur),
          sourceLabel: reward.sourceLabel?.trim() || null,
          sourceProvider: "MANUAL",
          lastUpdatedAt: new Date(),
        },
      });
    }

    // `allowNegativeCash` comme pour une souscription SCPI : engager des
    // jetons déjà détenus n'est pas un achat financé par la trésorerie du
    // portefeuille. Fabriquer un retrait de cash fausserait le solde.
    const ledgerTx = await createTransaction(
      {
        userId,
        type: "ACHAT",
        platformId: platform.id,
        assetId: asset.id,
        quantity: quantity.toString(),
        unitPrice: unitPrice.toFixed(12),
        fees: "0",
        currency: "EUR",
        fxRateToEur: "1",
        occurredAt: openedAt.toISOString(),
        allowNegativeCash: true,
        notes: `Engagement ${protocol} — ${symbol}`,
      } as Parameters<typeof createTransaction>[0],
      tx as unknown as Parameters<typeof createTransaction>[1]
    );

    // Événement d'ouverture, adossé à l'écriture qu'on vient de créer. Le
    // journal dit « +N jetons » ; cet événement dit *pourquoi*. C'est ce lien
    // qui rend la position reconstruisible sans dupliquer le ledger (D7).
    await tx.defiEvent.create({
      data: {
        defiPositionId: detail.id,
        eventType: eventTypeForOpening(input.positionType),
        eventDate: openedAt,
        chainId: input.chain?.trim() || null,
        assetId: asset.id,
        symbol,
        quantity: quantity.toString(),
        amountEur: quantity.times(unitPrice).toFixed(2),
        relatedProtocol: protocol,
        ledgerTransactionId: extractTransactionId(ledgerTx),
        sourceProvider: "MANUAL",
      },
    });

    return {
      assetId: asset.id,
      positionId: detail.id,
      engagedEur: quantity.times(unitPrice).toFixed(2),
    };
  });
}

/**
 * Nature de l'événement d'ouverture, selon le type de position.
 *
 * Un `DEPOSIT` générique pour tout serait techniquement exact mais illisible :
 * l'historique d'un staking doit dire « staking », celui d'une LP « ajout de
 * liquidité », celui d'un emprunt « emprunt » — sinon le journal d'événements
 * n'apprend rien de plus que le ledger.
 */
function eventTypeForOpening(positionType: string): string {
  switch (positionType) {
    case "STAKING":
    case "LIQUID_STAKING":
    case "RESTAKING":
      return "STAKE";
    case "BORROWING":
      return "BORROW";
    case "LP":
      return "ADD_LIQUIDITY";
    default:
      return "DEPOSIT";
  }
}

/**
 * Identifiant de l'écriture créée, quand `createTransaction` le renvoie.
 *
 * Défensif à dessein : le contrat de retour de `createTransaction` n'est pas
 * typé de façon exploitable ici (l'appel passe déjà par un cast), et un
 * événement sans lien vers le journal reste utile — c'est un `SetNull` côté
 * schéma. Mieux vaut un lien manquant qu'une création qui échoue.
 */
function extractTransactionId(result: unknown): string | null {
  if (result && typeof result === "object" && "id" in result) {
    const id = (result as { id: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

/**
 * Ferme une position : ramène la quantité à zéro par une écriture de sortie.
 *
 * L'actif et ses écritures sont conservés — les récompenses perçues restent
 * dues fiscalement une fois la position dénouée, et les effacer rendrait la
 * déclaration impossible à reconstituer.
 *
 * `liquidated` distingue une sortie choisie d'une liquidation subie : les deux
 * ramènent la quantité à zéro, mais confondre l'une avec l'autre effacerait
 * l'événement le plus important de l'historique d'un emprunt.
 */
export async function closeDefiPosition(
  userId: string,
  assetId: string,
  opts?: {
    exitUnitPriceEur?: string | null;
    closedAt?: string | null;
    liquidated?: boolean;
  }
): Promise<{ closed: boolean }> {
  const detail = await prisma.defiPositionDetail.findFirst({
    where: { assetId, asset: { is: { userId } } },
    include: { asset: { select: { id: true, platformId: true, manualPrice: true } } },
  });
  if (!detail) throw new DefiInputError("Position introuvable");

  const { getHoldings } = await import("../portfolio/service");
  const holdings = await getHoldings(userId);
  const held = holdings.find((h) => h.assetId === assetId);
  const qty = held ? d(held.quantity) : d(0);

  const closedAt = opts?.closedAt ? new Date(opts.closedAt) : new Date();
  if (Number.isNaN(closedAt.getTime())) {
    throw new DefiInputError("Date de clôture invalide");
  }
  const status = opts?.liquidated ? "LIQUIDATED" : "CLOSED";

  // Position déjà à zéro au journal : rien à dénouer, mais le statut doit
  // quand même basculer. Sans cela, une position vidée par une synchronisation
  // resterait éternellement « active » à 0 € dans les agrégats de qualité.
  if (qty.lte(0)) {
    await prisma.defiPositionDetail.update({
      where: { id: detail.id },
      data: { status, closedAt },
    });
    return { closed: false };
  }

  const exitPrice = opts?.exitUnitPriceEur
    ? d(opts.exitUnitPriceEur)
    : detail.asset.manualPrice
      ? d(detail.asset.manualPrice.toString())
      : d(0);

  await prisma.$transaction(async (tx) => {
    const ledgerTx = await createTransaction(
      {
        userId,
        type: "VENTE",
        platformId: detail.asset.platformId,
        assetId,
        quantity: qty.toString(),
        unitPrice: exitPrice.toFixed(12),
        fees: "0",
        currency: "EUR",
        fxRateToEur: "1",
        occurredAt: closedAt.toISOString(),
        allowNegativeCash: true,
        notes: `Dénouement ${detail.protocol}`,
      } as Parameters<typeof createTransaction>[0],
      tx as unknown as Parameters<typeof createTransaction>[1]
    );

    await tx.defiEvent.create({
      data: {
        defiPositionId: detail.id,
        eventType: opts?.liquidated ? "LIQUIDATION" : "WITHDRAW",
        eventDate: closedAt,
        assetId,
        quantity: qty.toString(),
        amountEur: qty.times(exitPrice).toFixed(2),
        relatedProtocol: detail.protocol,
        ledgerTransactionId: extractTransactionId(ledgerTx),
        sourceProvider: "MANUAL",
      },
    });

    // Les jambes sont désactivées, pas supprimées : elles expliquent
    // l'exposition passée, que la déclaration fiscale peut avoir à reconstituer.
    await tx.defiLeg.updateMany({
      where: { defiPositionId: detail.id },
      data: { isActive: false },
    });

    await tx.defiPositionDetail.update({
      where: { id: detail.id },
      data: { status, closedAt },
    });
  });

  return { closed: true };
}
