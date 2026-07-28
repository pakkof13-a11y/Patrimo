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

import { prisma } from "../prisma";
import { d } from "../money/decimal";
import { createTransaction } from "../transactions/service";
import { DEFI_POSITION_TYPES, isDebtPosition } from "./constants";

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

export type CreateDefiInput = {
  platformId: string;
  /** Actif engagé — « ETH », « USDC »… */
  assetSymbol: string;
  protocol: string;
  positionType: string;
  chain?: string | null;
  /** Rattachement à une stratégie existante (`DefiStrategy`), optionnel. */
  strategyId?: string | null;

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
      },
    });

    // `allowNegativeCash` comme pour une souscription SCPI : engager des
    // jetons déjà détenus n'est pas un achat financé par la trésorerie du
    // portefeuille. Fabriquer un retrait de cash fausserait le solde.
    await createTransaction(
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

    return {
      assetId: asset.id,
      positionId: detail.id,
      engagedEur: quantity.times(unitPrice).toFixed(2),
    };
  });
}

/**
 * Ferme une position : ramène la quantité à zéro par une écriture de sortie.
 *
 * L'actif et ses écritures sont conservés — les récompenses perçues restent
 * dues fiscalement une fois la position dénouée, et les effacer rendrait la
 * déclaration impossible à reconstituer.
 */
export async function closeDefiPosition(
  userId: string,
  assetId: string,
  opts?: { exitUnitPriceEur?: string | null; closedAt?: string | null }
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
  if (qty.lte(0)) return { closed: false };

  const exitPrice = opts?.exitUnitPriceEur
    ? d(opts.exitUnitPriceEur)
    : detail.asset.manualPrice
      ? d(detail.asset.manualPrice.toString())
      : d(0);

  const occurredAt = opts?.closedAt
    ? new Date(opts.closedAt).toISOString()
    : new Date().toISOString();

  await createTransaction({
    userId,
    type: "VENTE",
    platformId: detail.asset.platformId,
    assetId,
    quantity: qty.toString(),
    unitPrice: exitPrice.toFixed(12),
    fees: "0",
    currency: "EUR",
    fxRateToEur: "1",
    occurredAt,
    allowNegativeCash: true,
    notes: `Dénouement ${detail.protocol}`,
  });

  return { closed: true };
}
