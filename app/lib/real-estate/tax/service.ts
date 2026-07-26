/**
 * Assemblage des données fiscales immobilières depuis le journal.
 *
 * Ce module est la seule couche qui touche à Prisma ; les moteurs de calcul
 * (`ifi.ts`, `capital-gain.ts`, `rental-income.ts`) restent purs et testables
 * sans base.
 *
 * Principe directeur : **rien n'est valorisé ici**. La valeur d'un bien vient
 * de `getHoldings`, c'est-à-dire du journal — même source que le tableau
 * Positions et que le patrimoine net. Recalculer une valeur à part créerait un
 * second référentiel, exactement ce qui avait produit le double comptage de
 * l'assurance-vie.
 */

import { prisma } from "@/app/lib/prisma";
import { d, zero, type Decimal } from "@/app/lib/money/decimal";
import { getHoldings } from "@/app/lib/portfolio/service";
import { isRentalUsage } from "@/app/lib/real-estate/constants";
import { computeIfi, type IfiAsset, type IfiResult } from "./ifi";
import {
  compareRentalRegimes,
  type RentalComparison,
} from "./rental-income";

/** Vue fiscale d'un bien, telle qu'affichée dans l'onglet. */
export type PropertyTaxRow = {
  assetId: string;
  label: string;
  propertyType: string;
  usage: string;
  /** Valeur de la quote-part détenue (issue du journal). */
  shareValueEur: string;
  /** Valeur du bien entier, si renseignée. */
  wholeValueEur: string | null;
  /** Capital restant dû sur les crédits rattachés. */
  debtEur: string;
  isPrimaryResidence: boolean;
  isRental: boolean;
  /** Exclu de l'assiette IFI par l'utilisateur. */
  ifiExcluded: boolean;
  /** Loyer et charges mensuels déclarés sur la fiche du bien. */
  monthlyRentEur: string | null;
  monthlyChargesEur: string | null;
  annualPropertyTaxEur: string | null;
  purchaseDate: string | null;
  purchasePriceEur: string | null;
};

export type RealEstateTaxBundle = {
  properties: PropertyTaxRow[];
  ifi: IfiResult;
  /** Revenus fonciers agrégés sur les biens locatifs nus. */
  rental: {
    grossRentEur: string;
    deductibleChargesEur: string;
    comparison: RentalComparison;
  };
};

const PRIMARY_RESIDENCE_USAGE = "RESIDENCE_PRINCIPALE";

/**
 * Charge les biens avec leur valeur de marché issue du journal.
 *
 * `getHoldings` est appelé une fois et indexé : les biens immobiliers sont
 * peu nombreux, mais recharger le ledger par bien reproduirait le défaut de
 * performance corrigé sur l'import CSV.
 */
export async function loadPropertyTaxRows(
  userId: string
): Promise<PropertyTaxRow[]> {
  const [details, holdings] = await Promise.all([
    prisma.realEstateDetail.findMany({
      where: { asset: { is: { userId } } },
      include: {
        asset: {
          select: {
            id: true,
            name: true,
            manualPrice: true,
            acquisitionDate: true,
            liabilities: { select: { remainingAmount: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    getHoldings(userId),
  ]);

  const byAsset = new Map(holdings.map((h) => [h.assetId, h]));

  return details.map((detail) => {
    const holding = byAsset.get(detail.assetId);

    let debt = zero();
    for (const l of detail.asset.liabilities) {
      debt = debt.plus(d(l.remainingAmount.toString()));
    }

    return {
      assetId: detail.assetId,
      label: detail.asset.name,
      propertyType: detail.propertyType,
      usage: detail.usage,
      // La valeur retenue est celle de la position : quote-part déjà appliquée.
      shareValueEur: holding?.marketValueEur ?? "0",
      wholeValueEur: detail.asset.manualPrice?.toString() ?? null,
      debtEur: debt.toFixed(2),
      isPrimaryResidence: detail.usage === PRIMARY_RESIDENCE_USAGE,
      isRental: isRentalUsage(detail.usage),
      ifiExcluded: false,
      monthlyRentEur: detail.monthlyRentEur?.toString() ?? null,
      monthlyChargesEur: detail.monthlyChargesEur?.toString() ?? null,
      annualPropertyTaxEur: detail.annualPropertyTaxEur?.toString() ?? null,
      purchaseDate: detail.asset.acquisitionDate?.toISOString() ?? null,
      purchasePriceEur: holding?.costBasisEur ?? null,
    };
  });
}

/** Convertit les biens en assiette IFI. */
export function toIfiAssets(rows: readonly PropertyTaxRow[]): IfiAsset[] {
  return rows.map((r) => ({
    id: r.assetId,
    label: r.label,
    grossValueEur: r.shareValueEur,
    isPrimaryResidence: r.isPrimaryResidence,
    excluded: r.ifiExcluded,
    // La dette est prise telle qu'elle est due, sans pondération par la
    // quote-part : on peut détenir la moitié d'un bien en étant solidaire de
    // la totalité de l'emprunt (même règle que `getLinkedDebtEur`).
    deductibleDebtEur: r.debtEur,
  }));
}

/**
 * Agrège les loyers et charges annuels des biens locatifs.
 *
 * Les montants proviennent de la fiche du bien (loyer mensuel déclaré), pas du
 * journal : ils décrivent la situation locative *courante*, alors que le
 * journal décrit ce qui a été encaissé. Pour un arbitrage de régime fiscal,
 * c'est bien la situation courante annualisée qui est pertinente.
 */
export function aggregateRentalBase(rows: readonly PropertyTaxRow[]): {
  grossRent: Decimal;
  charges: Decimal;
} {
  let grossRent = zero();
  let charges = zero();

  for (const r of rows) {
    if (!r.isRental) continue;
    if (r.monthlyRentEur) grossRent = grossRent.plus(d(r.monthlyRentEur).times(12));
    if (r.monthlyChargesEur) charges = charges.plus(d(r.monthlyChargesEur).times(12));
    if (r.annualPropertyTaxEur) charges = charges.plus(d(r.annualPropertyTaxEur));
  }

  return { grossRent, charges };
}

export async function getRealEstateTaxBundle(
  userId: string,
  options: { marginalTaxRatePct?: number; furnished?: boolean } = {}
): Promise<RealEstateTaxBundle> {
  const properties = await loadPropertyTaxRows(userId);
  const ifi = computeIfi(toIfiAssets(properties));
  const { grossRent, charges } = aggregateRentalBase(properties);

  const comparison = compareRentalRegimes(
    {
      grossRentEur: grossRent,
      deductibleChargesEur: charges,
      marginalTaxRatePct: options.marginalTaxRatePct ?? 30,
    },
    Boolean(options.furnished)
  );

  return {
    properties,
    ifi,
    rental: {
      grossRentEur: grossRent.toFixed(2),
      deductibleChargesEur: charges.toFixed(2),
      comparison,
    },
  };
}
