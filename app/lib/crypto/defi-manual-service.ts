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

export type CreateDefiInput = {
  platformId: string;
  /** Actif engagé — « ETH », « USDC »… */
  assetSymbol: string;
  protocol: string;
  positionType: string;
  chain?: string | null;

  /** Quantité engagée dans le protocole. */
  quantity: string;
  /** Prix unitaire en euros au moment de l'engagement. */
  unitPriceEur: string;
  openedAt: string;

  apyPct?: string | null;
  rewardsSymbol?: string | null;
  rewardsAmount?: string | null;
  rewardsValueEur?: string | null;

  healthFactor?: string | null;
  ltvPct?: string | null;
  liqThresholdPct?: string | null;

  pairedSymbol?: string | null;
  pairedAmount?: string | null;
  poolAddress?: string | null;
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
        protocol,
        chain: input.chain?.trim() || null,
        positionType: input.positionType,
        pairedSymbol: input.pairedSymbol?.trim().toUpperCase() || null,
        pairedAmount: dec(input.pairedAmount),
        poolAddress: input.poolAddress?.trim() || null,
        apyPct: dec(input.apyPct),
        rewardsSymbol: input.rewardsSymbol?.trim().toUpperCase() || null,
        rewardsAmount: dec(input.rewardsAmount),
        rewardsValueEur: dec(input.rewardsValueEur),
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
