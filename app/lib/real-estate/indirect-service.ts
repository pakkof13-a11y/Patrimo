/**
 * Création d'une position sur un véhicule immobilier indirect.
 *
 * Reprend `property-service.ts` : un actif et sa transaction d'achat sont
 * écrits dans la même transaction de base, de sorte qu'un échec ne laisse
 * jamais un actif sans son écriture au journal.
 *
 * ## La quantité est le nombre de parts
 *
 * Une SCPI se comporte exactement comme une ligne de titres : quantité ×
 * prix de part = valeur. C'est donc le mécanisme de position ordinaire qui
 * s'applique, sans valorisation parallèle — la valeur affichée vient du
 * journal, comme pour toute autre position.
 */

import { prisma } from "../prisma";
import { d } from "../money/decimal";
import { createTransaction } from "../transactions/service";
import { INDIRECT_VEHICLES, type IndirectVehicle } from "./indirect";

export class IndirectInputError extends Error {
  readonly code = "INDIRECT_INPUT";
  constructor(message: string) {
    super(message);
    this.name = "IndirectInputError";
  }
}

export type CreateIndirectInput = {
  platformId: string;
  /** Libellé — « SCPI Primovie », « SCI Familiale »… */
  name: string;
  vehicle: string;
  manager?: string | null;
  isin?: string | null;

  /** Nombre de parts détenues. */
  shares: string;
  /** Prix payé par part, à l'acquisition. */
  sharePriceEur: string;
  /** Frais de souscription réellement supportés. */
  subscriptionFeesEur?: string | null;
  purchaseDate: string;

  /** Valeur courante d'une part — sert de prix manuel si renseignée. */
  currentSharePriceEur?: string | null;

  distributionRatePct?: string | null;
  debtRatioPct?: string | null;
  realEstateSharePct?: string | null;
  ownershipStakePct?: string | null;
  taxTransparency?: string | null;
  ifiExcluded?: boolean;
  notes?: string | null;
};

export type CreateIndirectResult = {
  assetId: string;
  transactionId: string;
  investedEur: string;
};

function dec(v: string | null | undefined) {
  if (v == null || v === "") return null;
  const n = d(v);
  return n.isFinite() ? n.toString() : null;
}

/** Catégorie d'affichage déduite du véhicule. */
function categoryFor(vehicle: string): "SCPI" | "REIT" | "REAL_ESTATE_DIRECT" {
  if (vehicle === "SCPI") return "SCPI";
  if (vehicle === "SIIC") return "REIT";
  // SCI, OPCI, GFI : pas de catégorie dédiée, rattachés à l'immobilier.
  return "REAL_ESTATE_DIRECT";
}

export async function createIndirectHolding(
  userId: string,
  input: CreateIndirectInput
): Promise<CreateIndirectResult> {
  const platform = await prisma.platform.findFirst({
    where: { id: input.platformId, userId },
    select: { id: true },
  });
  if (!platform) throw new IndirectInputError("Plateforme introuvable");

  if (!input.name.trim()) {
    throw new IndirectInputError("Le nom du véhicule est requis");
  }
  if (!(input.vehicle in INDIRECT_VEHICLES)) {
    throw new IndirectInputError("Type de véhicule inconnu");
  }

  const shares = d(input.shares);
  if (!shares.isFinite() || shares.lte(0)) {
    throw new IndirectInputError("Le nombre de parts doit être strictement positif");
  }

  const sharePrice = d(input.sharePriceEur);
  if (!sharePrice.isFinite() || sharePrice.lte(0)) {
    throw new IndirectInputError("Le prix de part doit être strictement positif");
  }

  const fees = input.subscriptionFeesEur ? d(input.subscriptionFeesEur) : d(0);
  if (fees.lt(0)) {
    throw new IndirectInputError("Les frais de souscription ne peuvent pas être négatifs");
  }

  const purchaseDate = new Date(input.purchaseDate);
  if (Number.isNaN(purchaseDate.getTime())) {
    throw new IndirectInputError("Date d'acquisition invalide");
  }

  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.create({
      data: {
        userId,
        platformId: platform.id,
        name: input.name.trim(),
        isin: input.isin?.trim() || null,
        assetClass: "IMMOBILIER",
        category: categoryFor(input.vehicle),
        accountType: "IMMOBILIER",
        currency: "EUR",
        // Une part de SCPI n'a pas de cotation continue : le prix vient de la
        // société de gestion, saisi à la main, jamais d'un fournisseur.
        priceProvider: "MANUAL",
        manualPrice: input.currentSharePriceEur
          ? d(input.currentSharePriceEur).toFixed(12)
          : sharePrice.toFixed(12),
        acquisitionDate: purchaseDate,
        notes: input.notes?.trim() || null,
      },
    });

    await tx.indirectRealEstateDetail.create({
      data: {
        assetId: asset.id,
        vehicle: input.vehicle as IndirectVehicle,
        manager: input.manager?.trim() || null,
        distributionRatePct: dec(input.distributionRatePct),
        debtRatioPct: dec(input.debtRatioPct),
        realEstateSharePct: dec(input.realEstateSharePct),
        ownershipStakePct: dec(input.ownershipStakePct),
        taxTransparency: input.taxTransparency || null,
        ifiExcluded: Boolean(input.ifiExcluded),
        notes: input.notes?.trim() || null,
      },
    });

    // `autoFundCash` absent, comme pour un bien direct : une souscription se
    // finance par un apport suivi ailleurs, pas par la trésorerie du
    // portefeuille. Fabriquer un dépôt fictif fausserait le cash.
    const created = await createTransaction(
      {
        userId,
        type: "ACHAT",
        platformId: platform.id,
        assetId: asset.id,
        quantity: shares.toString(),
        unitPrice: sharePrice.toFixed(2),
        fees: fees.toFixed(2),
        currency: "EUR",
        fxRateToEur: "1",
        occurredAt: purchaseDate.toISOString(),
        allowNegativeCash: true,
        notes: `Souscription — ${input.name.trim()}`,
      } as Parameters<typeof createTransaction>[0],
      tx as unknown as Parameters<typeof createTransaction>[1]
    );

    return {
      assetId: asset.id,
      transactionId: (created as { id?: string } | null)?.id ?? "",
      investedEur: shares.times(sharePrice).plus(fees).toFixed(2),
    };
  });
}
