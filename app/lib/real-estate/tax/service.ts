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
import {
  isFurnishedUsage,
  isRentalUsage,
} from "@/app/lib/real-estate/constants";
import {
  assessIndirectForIfi,
  expectedAnnualIncomeEur,
} from "@/app/lib/real-estate/indirect";
import {
  computeSchemeReduction,
  summarizeSchemes,
  type SchemeResult,
  type SchemesSummary,
} from "./schemes";
import { computeIfi, type IfiAsset, type IfiResult } from "./ifi";
import { remainingAmountAt } from "@/app/lib/liabilities/amortization";
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
  /** Régime déclaré sur la fiche (null si non renseigné). */
  rentalRegime: string | null;
  /** Dispositif de défiscalisation adossé au bien. */
  taxScheme: string | null;
  commitmentEndDate: string | null;
  /** Location meublée (meublé classique ou saisonnier). */
  isFurnished: boolean;
  isClassifiedTourism: boolean;
  schemeStartYear: number | null;
  schemeCommitmentYears: number | null;
  schemeBaseEur: string | null;
  schemeRatePct: string | null;
  /** Surface habitable — nécessaire au plafond Pinel de 5 500 €/m². */
  livingAreaM2: number | null;
};

/** Véhicule indirect, tel qu'affiché et pris en compte dans l'IFI. */
export type IndirectRow = {
  assetId: string;
  label: string;
  vehicle: string;
  manager: string | null;
  /** Valeur de la position, issue du journal. */
  marketValueEur: string;
  quantity: string;
  distributionRatePct: string | null;
  debtRatioPct: string | null;
  taxTransparency: string | null;
  /** Revenu annuel attendu au taux de distribution affiché. */
  expectedAnnualIncomeEur: string;
  /** Fraction retenue dans l'assiette IFI, en %. */
  ifiSharePct: string;
  ifiTaxableValueEur: string;
  ifiExcluded: boolean;
  ifiExclusionReason: string | null;
};

/** Arbitrage de régime pour un mode de location donné. */
export type RentalSection = {
  /** Nombre de biens concernés — 0 signifie « section sans objet ». */
  count: number;
  grossRentEur: string;
  deductibleChargesEur: string;
  comparison: RentalComparison;
};

/** Réduction d'un dispositif, rattachée au bien qui la porte. */
export type SchemeRow = SchemeResult & { assetId: string; label: string };

export type RealEstateTaxBundle = {
  properties: PropertyTaxRow[];
  /** Dispositifs de défiscalisation et leur plafonnement global. */
  schemes: { rows: SchemeRow[]; summary: SchemesSummary };
  /** Véhicules indirects — entrent dans l'IFI, pas dans les revenus fonciers. */
  indirect: IndirectRow[];
  ifi: IfiResult;
  /** Nu et meublé sont traités séparément — fiscalités non comparables. */
  rental: { bare: RentalSection; furnished: RentalSection };
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
            liabilities: {
              // Les champs d'amortissement viennent avec le solde : la dette
              // déductible se projette à aujourd'hui comme partout ailleurs,
              // sinon l'assiette IFI dépendrait de l'ordre de navigation.
              select: {
                remainingAmount: true,
                monthlyPayment: true,
                paymentDay: true,
                startDate: true,
                endDate: true,
                lastPaymentAppliedAt: true,
              },
            },
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
      debt = debt.plus(d(remainingAmountAt(l)));
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
      rentalRegime: detail.rentalRegime,
      taxScheme: detail.taxScheme,
      commitmentEndDate: detail.commitmentEndDate?.toISOString() ?? null,
      isFurnished: isFurnishedUsage(detail.usage),
      isClassifiedTourism: detail.isClassifiedTourism,
      schemeStartYear: detail.schemeStartYear,
      schemeCommitmentYears: detail.schemeCommitmentYears,
      schemeBaseEur: detail.schemeBaseEur?.toString() ?? null,
      schemeRatePct: detail.schemeRatePct?.toString() ?? null,
      livingAreaM2: detail.livingAreaM2,
    };
  });
}

/**
 * Charge les véhicules indirects avec leur valeur de marché du journal.
 *
 * Même principe que pour les biens directs : `getHoldings` fournit la valeur,
 * la table de détail ne porte que les caractéristiques du véhicule.
 */
export async function loadIndirectRows(
  userId: string,
  holdings?: Awaited<ReturnType<typeof getHoldings>>
): Promise<IndirectRow[]> {
  const [details, rows] = await Promise.all([
    prisma.indirectRealEstateDetail.findMany({
      where: { asset: { is: { userId } } },
      include: { asset: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    holdings ? Promise.resolve(holdings) : getHoldings(userId),
  ]);

  const byAsset = new Map(rows.map((h) => [h.assetId, h]));

  return details.map((detail) => {
    const holding = byAsset.get(detail.assetId);
    const marketValue = holding?.marketValueEur ?? "0";

    const ifi = assessIndirectForIfi({
      assetId: detail.assetId,
      label: detail.asset.name,
      vehicle: detail.vehicle,
      marketValueEur: marketValue,
      realEstateSharePct: detail.realEstateSharePct?.toString() ?? null,
      ownershipStakePct: detail.ownershipStakePct?.toString() ?? null,
      ifiExcluded: detail.ifiExcluded,
    });

    return {
      assetId: detail.assetId,
      label: detail.asset.name,
      vehicle: detail.vehicle,
      manager: detail.manager,
      marketValueEur: marketValue,
      quantity: holding?.quantity ?? "0",
      distributionRatePct: detail.distributionRatePct?.toString() ?? null,
      debtRatioPct: detail.debtRatioPct?.toString() ?? null,
      taxTransparency: detail.taxTransparency,
      expectedAnnualIncomeEur: expectedAnnualIncomeEur(
        marketValue,
        detail.distributionRatePct?.toString() ?? null
      ).toFixed(2),
      ifiSharePct: ifi.sharePct.toFixed(3),
      ifiTaxableValueEur: ifi.taxableValueEur.toFixed(2),
      ifiExcluded: ifi.excluded,
      ifiExclusionReason: ifi.exclusionReason,
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

export type RentalBase = {
  grossRent: Decimal;
  charges: Decimal;
  /** Nombre de biens contribuant à cette base. */
  count: number;
  /** Au moins un meublé de tourisme classé — ouvre l'abattement majoré. */
  hasClassifiedTourism: boolean;
};

/**
 * Agrège les loyers et charges annuels, **séparément pour le nu et le meublé**.
 *
 * Les deux ne peuvent pas être additionnés : ils relèvent de fiscalités
 * distinctes (revenus fonciers contre BIC), avec des plafonds et des
 * abattements différents. Les sommer produirait un total qui franchit un
 * plafond qu'aucun des deux ne franchit réellement, et proposerait un
 * arbitrage entre régimes qui ne s'opposent pas.
 *
 * Les montants viennent de la fiche du bien (loyer mensuel déclaré) et non du
 * journal : ils décrivent la situation locative *courante*, alors que le
 * journal décrit ce qui a été encaissé. Pour choisir un régime, c'est bien la
 * situation courante annualisée qui compte.
 */
export function aggregateRentalBase(rows: readonly PropertyTaxRow[]): {
  bare: RentalBase;
  furnished: RentalBase;
} {
  const empty = (): RentalBase => ({
    grossRent: zero(),
    charges: zero(),
    count: 0,
    hasClassifiedTourism: false,
  });

  const bare = empty();
  const furnished = empty();

  for (const r of rows) {
    if (!r.isRental) continue;
    const bucket = r.isFurnished ? furnished : bare;

    if (r.monthlyRentEur) {
      bucket.grossRent = bucket.grossRent.plus(d(r.monthlyRentEur).times(12));
    }
    if (r.monthlyChargesEur) {
      bucket.charges = bucket.charges.plus(d(r.monthlyChargesEur).times(12));
    }
    if (r.annualPropertyTaxEur) {
      bucket.charges = bucket.charges.plus(d(r.annualPropertyTaxEur));
    }
    bucket.count += 1;
    if (r.isClassifiedTourism) bucket.hasClassifiedTourism = true;
  }

  return { bare, furnished };
}

export async function getRealEstateTaxBundle(
  userId: string,
  options: { marginalTaxRatePct?: number } = {}
): Promise<RealEstateTaxBundle> {
  const [properties, indirect] = await Promise.all([
    loadPropertyTaxRows(userId),
    loadIndirectRows(userId),
  ]);

  // Les véhicules indirects entrent dans la même assiette que les biens
  // directs : l'IFI porte sur le patrimoine immobilier, quel que soit le mode
  // de détention. Les lignes exclues (foncière cotée < 5 %, exclusion
  // manuelle) sont passées avec `excluded` pour rester visibles au tableau
  // sans peser sur l'assiette.
  const ifi = computeIfi([
    ...toIfiAssets(properties),
    ...indirect.map((v) => ({
      id: v.assetId,
      label: v.label,
      grossValueEur: v.marketValueEur,
      realEstateSharePct: v.ifiSharePct,
      excluded: v.ifiExcluded,
    })),
  ]);

  const { bare, furnished } = aggregateRentalBase(properties);
  const tmi = options.marginalTaxRatePct ?? 30;

  const section = (base: RentalBase, isFurnished: boolean): RentalSection => ({
    count: base.count,
    grossRentEur: base.grossRent.toFixed(2),
    deductibleChargesEur: base.charges.toFixed(2),
    comparison: compareRentalRegimes(
      {
        grossRentEur: base.grossRent,
        deductibleChargesEur: base.charges,
        marginalTaxRatePct: tmi,
        isClassifiedTourism: base.hasClassifiedTourism,
      },
      isFurnished
    ),
  });

  // Les dispositifs : un bien sans dispositif renseigné n'en produit aucun.
  // `grossRentEur` n'est passé que pour Loc'Avantages, seul dispositif dont
  // la base est le loyer et non un prix de revient immobilisé.
  const schemeRows: SchemeRow[] = properties
    .filter((p) => p.taxScheme && p.taxScheme !== "AUCUN" && p.schemeStartYear)
    .map((p) => ({
      assetId: p.assetId,
      label: p.label,
      ...computeSchemeReduction({
        scheme: p.taxScheme!,
        startYear: p.schemeStartYear!,
        commitmentYears: p.schemeCommitmentYears,
        baseEur: p.schemeBaseEur,
        surfaceM2: p.livingAreaM2,
        malrauxRatePct: p.schemeRatePct,
        locAvantagesRatePct: p.schemeRatePct,
        grossRentEur: p.monthlyRentEur ? d(p.monthlyRentEur).times(12) : null,
      }),
    }));

  return {
    properties,
    schemes: { rows: schemeRows, summary: summarizeSchemes(schemeRows) },
    indirect,
    ifi,
    rental: {
      bare: section(bare, false),
      furnished: section(furnished, true),
    },
  };
}
