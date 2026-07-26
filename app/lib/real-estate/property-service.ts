/**
 * Création d'un bien immobilier détenu en direct.
 *
 * Un bien entre au patrimoine **par le journal**, comme tout le reste : la
 * saisie produit un actif, ses caractéristiques, et une transaction d'achat.
 * Poser une valeur dans un champ à côté du journal romprait le principe
 * « transactions = source de vérité » et rendrait la plus-value incalculable.
 *
 * ## La quote-part est la quantité
 *
 * `quantity` porte la part détenue (1 = pleine propriété, 0,5 = moitié) et
 * `unitPrice` la valeur du **bien entier**. La valeur au patrimoine est leur
 * produit, donc correcte sans qu'aucun calcul n'ait à se souvenir de pondérer.
 * Réévaluer le bien entier suffit à réévaluer la part ; racheter la part d'un
 * co-indivisaire est un second achat que le CUMP absorbe seul.
 *
 * Les frais d'acquisition entrent dans `fees`, donc dans le coût de revient via
 * `applyBuy` — c'est ce coût qui servira de base à la plus-value.
 */

import { Prisma } from "../prisma-client/client";
import { prisma } from "../prisma";
import { d } from "../money/decimal";
import { AccountingError } from "../accounting";
import { createTransaction } from "../transactions/service";
import { isDvfEstimable, isRentalUsage } from "./constants";
import { REAL_ESTATE_PLATFORM_TYPE } from "./platform-type";

export { REAL_ESTATE_PLATFORM_TYPE } from "./platform-type";

export class RealEstateInputError extends Error {}

export type CreatePropertyInput = {
  platformId: string;
  /** Libellé du bien — « Appartement Marseille 2e », « Parking Nice »… */
  name: string;

  propertyType: string;
  usage: string;

  /**
   * Part détenue, entre 0 exclu et 1 inclus. 1 = pleine propriété.
   * Une valeur > 1 n'a pas de sens à l'achat initial et est refusée.
   */
  ownershipShare: string;
  /** Prix du bien **entier**, hors frais. */
  purchasePriceEur: string;
  /** Frais de notaire et d'agence effectivement supportés. */
  acquisitionFeesEur?: string | null;
  purchaseDate: string;

  rooms?: number | null;
  livingAreaM2?: number | null;
  landAreaM2?: number | null;

  addressLine?: string | null;
  postalCode?: string | null;
  city?: string | null;

  monthlyRentEur?: string | null;
  monthlyChargesEur?: string | null;
  annualPropertyTaxEur?: string | null;
  occupancyRatePct?: string | null;

  /** Jour du mois d'encaissement (1–31) — active la proposition d'échéances. */
  rentDay?: number | null;
  rentalStartDate?: string | null;
  rentalEndDate?: string | null;

  constructionYear?: number | null;
  energyRating?: string | null;
  parkingSpots?: number | null;
  floor?: number | null;
  hasElevator?: boolean | null;

  /** Prêt finançant le bien — rattachement optionnel. */
  liabilityId?: string | null;
  notes?: string | null;
};

export type CreatePropertyResult = {
  assetId: string;
  transactionId: string;
  /** Valeur de la part au moment de l'achat, en euros. */
  shareValueEur: string;
  /** Coût de revient de la part, frais inclus. */
  costBasisEur: string;
};

/** Date optionnelle — une chaîne vide ou invalide vaut « non renseignée ». */
function parseOptionalDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function requirePositive(value: string, label: string): void {
  const n = d(value);
  if (!n.isFinite() || n.lte(0)) {
    throw new RealEstateInputError(`${label} doit être strictement positif`);
  }
}

/**
 * Contrôle la quote-part.
 *
 * Bornée à 1 : au-delà, l'utilisateur détiendrait plus que le bien lui-même,
 * ce qui est toujours une erreur de saisie à la création. Un rachat de part
 * ultérieur passe par une transaction distincte, pas par ce point d'entrée.
 */
function normalizeShare(raw: string): Prisma.Decimal {
  const share = d(raw);
  if (!share.isFinite() || share.lte(0)) {
    throw new RealEstateInputError(
      "La quote-part de détention doit être strictement positive"
    );
  }
  if (share.gt(1)) {
    throw new RealEstateInputError(
      "La quote-part ne peut pas dépasser 100 % — un rachat de part se saisit comme un achat complémentaire"
    );
  }
  return new Prisma.Decimal(share.toFixed(12));
}

/**
 * Crée un bien : actif + caractéristiques + transaction d'achat, en une seule
 * transaction de base.
 *
 * L'atomicité compte ici plus qu'ailleurs : un actif créé sans sa transaction
 * d'achat serait une position fantôme à quantité nulle, visible dans Positions
 * et impossible à corriger autrement qu'en base.
 */
export async function createProperty(
  userId: string,
  input: CreatePropertyInput
): Promise<CreatePropertyResult> {
  const platform = await prisma.platform.findFirst({
    where: { id: input.platformId, userId },
    select: { id: true, type: true },
  });
  if (!platform) {
    throw new RealEstateInputError("Plateforme introuvable");
  }
  if (platform.type !== REAL_ESTATE_PLATFORM_TYPE) {
    throw new RealEstateInputError(
      "Un bien immobilier doit être rattaché à une plateforme « Notaire / immobilier »"
    );
  }

  if (!input.name.trim()) {
    throw new RealEstateInputError("Le nom du bien est requis");
  }
  requirePositive(input.purchasePriceEur, "Le prix d'achat");

  const purchaseDate = new Date(input.purchaseDate);
  if (Number.isNaN(purchaseDate.getTime())) {
    throw new RealEstateInputError("Date d'achat invalide");
  }

  const share = normalizeShare(input.ownershipShare);
  const fees = input.acquisitionFeesEur ? d(input.acquisitionFeesEur) : d(0);
  if (fees.lt(0)) {
    throw new RealEstateInputError("Les frais d'acquisition ne peuvent pas être négatifs");
  }

  if (input.liabilityId) {
    const liability = await prisma.liability.findFirst({
      where: { id: input.liabilityId, userId },
      select: { id: true },
    });
    if (!liability) {
      throw new RealEstateInputError("Prêt introuvable");
    }
  }

  // Un bien non estimable par DVF (parking, terrain, local) démarre forcément
  // en valorisation manuelle : lui proposer un mode automatique promettrait une
  // réévaluation qui ne viendrait jamais.
  const valuationMode = isDvfEstimable(input.propertyType)
    ? "DVF_AUTO"
    : "MANUAL";

  const dec = (v: string | null | undefined): Prisma.Decimal | null =>
    v == null || v === "" ? null : new Prisma.Decimal(d(v).toFixed(6));

  const rentalUsage = isRentalUsage(input.usage);

  return prisma.$transaction(async (tx) => {
    const asset = await tx.asset.create({
      data: {
        userId,
        platformId: platform.id,
        name: input.name.trim(),
        assetClass: "IMMOBILIER",
        accountType: "IMMOBILIER",
        category: "REAL_ESTATE_DIRECT",
        currency: "EUR",
        // La valorisation d'un bien ne vient d'aucune place de marché : le
        // provider manuel lit `manualPrice`, qu'une estimation DVF viendra
        // ensuite mettre à jour si le mode automatique est actif.
        priceProvider: "MANUAL",
        manualPrice: new Prisma.Decimal(d(input.purchasePriceEur).toFixed(12)),
        acquisitionDate: purchaseDate,
        notes: input.notes?.trim() || null,
      },
      select: { id: true },
    });

    await tx.realEstateDetail.create({
      data: {
        assetId: asset.id,
        propertyType: input.propertyType,
        usage: input.usage,
        rooms: input.rooms ?? null,
        livingAreaM2: input.livingAreaM2 ?? null,
        landAreaM2: input.landAreaM2 ?? null,
        addressLine: input.addressLine?.trim() || null,
        postalCode: input.postalCode?.trim() || null,
        city: input.city?.trim() || null,
        valuationMode,
        lastValuedAt: purchaseDate,
        monthlyRentEur: dec(input.monthlyRentEur),
        monthlyChargesEur: dec(input.monthlyChargesEur),
        annualPropertyTaxEur: dec(input.annualPropertyTaxEur),
        occupancyRatePct: dec(input.occupancyRatePct),
        // L'échéancier ne s'arme que sur un usage locatif : proposer des loyers
        // sur une résidence principale n'aurait aucun sens, même si le jour a
        // été saisi par inadvertance.
        rentDay: rentalUsage ? (input.rentDay ?? null) : null,
        rentalStartDate: rentalUsage ? parseOptionalDate(input.rentalStartDate) : null,
        rentalEndDate: rentalUsage ? parseOptionalDate(input.rentalEndDate) : null,
        constructionYear: input.constructionYear ?? null,
        energyRating: input.energyRating || null,
        parkingSpots: input.parkingSpots ?? null,
        floor: input.floor ?? null,
        hasElevator: input.hasElevator ?? null,
      },
    });

    // Achat : quantité = quote-part, prix = bien entier, frais = frais réels.
    // `autoFundCash` est volontairement absent — un achat immobilier n'est pas
    // financé par la trésorerie du portefeuille, mais par un prêt et un apport
    // suivis ailleurs. Fabriquer un dépôt fictif fausserait le cash.
    const created = await createTransaction(
      {
        userId,
        type: "ACHAT",
        platformId: platform.id,
        assetId: asset.id,
        quantity: share.toString(),
        unitPrice: d(input.purchasePriceEur).toFixed(2),
        fees: fees.toFixed(2),
        currency: "EUR",
        fxRateToEur: "1",
        occurredAt: purchaseDate.toISOString(),
        allowNegativeCash: true,
        notes: `Acquisition — ${input.name.trim()}`,
      } as Parameters<typeof createTransaction>[0],
      tx as unknown as Parameters<typeof createTransaction>[1]
    );

    if (input.liabilityId) {
      await tx.liability.update({
        where: { id: input.liabilityId },
        data: { assetId: asset.id },
      });
    }

    const shareValue = d(input.purchasePriceEur).times(d(share.toString()));

    return {
      assetId: asset.id,
      transactionId:
        (created as { id?: string } | null)?.id ?? "",
      shareValueEur: shareValue.toFixed(2),
      costBasisEur: shareValue.plus(fees).toFixed(2),
    };
  });
}

/**
 * Capital restant dû rattaché à un bien.
 *
 * Renvoie le montant **réellement dû**, jamais pondéré par la quote-part : on
 * peut détenir la moitié d'un bien tout en étant solidaire de la totalité de
 * l'emprunt. Pondérer silencieusement produirait un patrimoine net faux sans
 * que rien ne le signale.
 */
export async function getLinkedDebtEur(
  userId: string,
  assetId: string
): Promise<string> {
  const rows = await prisma.liability.findMany({
    where: { userId, assetId },
    select: { remainingAmount: true },
  });
  let total = d(0);
  for (const row of rows) total = total.plus(d(row.remainingAmount.toString()));
  return total.toFixed(2);
}

/** Vrai si la plateforme accueille des biens immobiliers. */
export function isRealEstatePlatform(
  platform: { type?: string | null } | null | undefined
): boolean {
  return (platform?.type ?? "") === REAL_ESTATE_PLATFORM_TYPE;
}

export { AccountingError };
