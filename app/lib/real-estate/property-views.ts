/**
 * Vue consolidée d'un bien immobilier, prête à afficher.
 *
 * Le panneau immobilier recalculait ces mêmes grandeurs à l'intérieur d'une
 * boucle de rendu de mille cinq cents lignes : valeur de la part, dette,
 * equity, rendements. Les en sortir n'en change aucune — les fonctions de
 * calcul restent celles de `constants.ts` — mais permet enfin de les tester,
 * et à la liste comme au panneau de détail de lire les mêmes nombres.
 *
 * Module **pur** : ni Prisma, ni React, ni réseau.
 */

import {
  grossRentalYieldPct,
  isRentalUsage,
  netRentalYieldPct,
  totalAnnualFiscalBurden,
} from "./constants";

/** Ce que la route `/api/real-estate/properties` renvoie, réduit à l'utile. */
export type PropertyInput = {
  assetId: string;
  name: string;
  propertyType: string;
  usage: string;
  city: string | null;
  livingAreaM2: number | null;
  propertyValueEur: string | null;
  monthlyRentEur: string | null;
  monthlyChargesEur: string | null;
  annualPropertyTaxEur: string | null;
  annualHabitationTaxEur: string | null;
  annualCoproChargesEur: string | null;
  isCopropriete: boolean | null;
  occupancyRatePct: string | null;
  loans: Array<{ id: string; name: string; remainingAmountEur: string }>;
};

/** La position du journal correspondante — quote-part et prix de revient. */
export type PropertyHolding = {
  quantity: string;
  marketValueEur: string;
  costBasisEur: string;
};

/**
 * Statut d'exploitation d'un bien.
 *
 * `VACANT` n'est pas déduit d'un taux d'occupation nul mais d'un usage locatif
 * sans loyer renseigné : un bien loué dont on n'a pas saisi le loyer et un bien
 * réellement vide ne se distinguent pas autrement, et prétendre le contraire
 * afficherait « vacant » sur des biens qui rapportent.
 */
export type PropertyStatus = "RENTED" | "PRIMARY" | "SECONDARY" | "VACANT";

export type PropertyView = {
  assetId: string;
  name: string;
  city: string | null;
  propertyType: string;
  usage: string;
  status: PropertyStatus;
  /** Valeur du bien entier, telle que saisie ou estimée. */
  wholeValueEur: number;
  /** Valeur de **votre part** — c'est elle qui entre au patrimoine. */
  shareValueEur: number;
  costBasisEur: number;
  /**
   * Capital restant dû, jamais pondéré par la quote-part : on peut détenir la
   * moitié d'un bien tout en étant solidaire de la totalité de l'emprunt.
   */
  debtEur: number;
  /** `shareValue − debt`. */
  equityEur: number;
  /** Part de la valeur qui vous revient nette de dette, en %. */
  equitySharePct: number | null;
  grossYieldPct: number | null;
  netYieldPct: number | null;
  /** Charges et fiscalité locale annuelles retenues pour le rendement net. */
  annualFiscalBurdenEur: number;
  /** Loyer net de charges et de fiscalité locale, par mois. */
  monthlyCashFlowEur: number | null;
  isRental: boolean;
  loanCount: number;
};

export type RealEstateTotals = {
  valueEur: number;
  debtEur: number;
  equityEur: number;
  costBasisEur: number;
  /** Rendement brut moyen **pondéré par la valeur** des biens locatifs. */
  weightedGrossYieldPct: number | null;
  monthlyCashFlowEur: number;
  annualRentEur: number;
  annualChargesEur: number;
  propertyCount: number;
  rentedCount: number;
  loanCount: number;
  /** Dette rapportée à la valeur, en %. */
  debtRatioPct: number | null;
};

export const num = (v: string | number | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function statusOf(p: PropertyInput): PropertyStatus {
  const usage = (p.usage ?? "").toUpperCase();
  if (usage.includes("PRINCIPAL")) return "PRIMARY";
  if (usage.includes("SECONDAIRE")) return "SECONDARY";
  if (isRentalUsage(p.usage)) {
    return num(p.monthlyRentEur) > 0 ? "RENTED" : "VACANT";
  }
  return "SECONDARY";
}

export function buildPropertyView(
  p: PropertyInput,
  holding: PropertyHolding | undefined
): PropertyView {
  const shareValueEur = num(holding?.marketValueEur);
  const costBasisEur = num(holding?.costBasisEur);
  const debtEur = p.loans.reduce((s, l) => s + num(l.remainingAmountEur), 0);
  const wholeValueEur = num(p.propertyValueEur);
  const isRental = isRentalUsage(p.usage);

  const grossYieldPct = grossRentalYieldPct({
    monthlyRentEur: num(p.monthlyRentEur) || null,
    occupancyRatePct: p.occupancyRatePct ? num(p.occupancyRatePct) : null,
    propertyValueEur: wholeValueEur || null,
  });

  const annualFiscalBurdenEur = totalAnnualFiscalBurden({
    usage: p.usage,
    annualPropertyTaxEur: num(p.annualPropertyTaxEur) || null,
    annualHabitationTaxEur: num(p.annualHabitationTaxEur) || null,
    isCopropriete: p.isCopropriete,
    annualCoproChargesEur: num(p.annualCoproChargesEur) || null,
  });

  const netYieldPct = netRentalYieldPct({
    monthlyRentEur: num(p.monthlyRentEur) || null,
    monthlyChargesEur: num(p.monthlyChargesEur) || null,
    totalAnnualFiscalBurdenEur: annualFiscalBurdenEur,
    occupancyRatePct: p.occupancyRatePct ? num(p.occupancyRatePct) : null,
    // Rapporté à ce que vous avez engagé sur votre part.
    costBasisEur: costBasisEur || null,
  });

  /*
    Cash-flow mensuel : loyer encaissé, moins les charges courantes, moins la
    fiscalité locale ramenée au mois. La mensualité d'emprunt n'en est pas
    déduite — elle n'est pas connue ici, et un cash-flow « avant crédit »
    annoncé comme net serait le chiffre le plus trompeur de l'écran.
  */
  const occupancy = p.occupancyRatePct ? num(p.occupancyRatePct) / 100 : 1;
  const rent = num(p.monthlyRentEur);
  const monthlyCashFlowEur =
    isRental && rent > 0
      ? rent * occupancy - num(p.monthlyChargesEur) - annualFiscalBurdenEur / 12
      : null;

  const equityEur = shareValueEur - debtEur;

  return {
    assetId: p.assetId,
    name: p.name,
    city: p.city,
    propertyType: p.propertyType,
    usage: p.usage,
    status: statusOf(p),
    wholeValueEur,
    shareValueEur,
    costBasisEur,
    debtEur,
    equityEur,
    equitySharePct: shareValueEur > 0 ? (equityEur / shareValueEur) * 100 : null,
    grossYieldPct,
    netYieldPct,
    annualFiscalBurdenEur,
    monthlyCashFlowEur,
    isRental,
    loanCount: p.loans.length,
  };
}

/**
 * Biens du plus gros au plus petit encours.
 *
 * C'est l'ordre dans lequel on lit une exposition : ce qui pèse d'abord. À
 * valeur égale, l'ordre alphabétique évite qu'un rafraîchissement réordonne la
 * liste sous le curseur.
 */
export function buildPropertyViews(
  properties: PropertyInput[],
  holdings: Map<string, PropertyHolding>
): PropertyView[] {
  return properties
    .map((p) => buildPropertyView(p, holdings.get(p.assetId)))
    .sort((a, b) => {
      if (b.shareValueEur !== a.shareValueEur) {
        return b.shareValueEur - a.shareValueEur;
      }
      return a.name.localeCompare(b.name, "fr-FR");
    });
}

/**
 * Agrégats du parc.
 *
 * Le rendement moyen est **pondéré par la valeur** et ne porte que sur les
 * biens locatifs : une moyenne simple donnerait au garage à 38 000 € le même
 * poids qu'à l'immeuble à 285 000 €, et un bien sans loyer renseigné y
 * entrerait comme un rendement nul, ce qu'il n'est pas — il est inconnu.
 */
export function computeRealEstateTotals(
  views: PropertyView[],
  properties: PropertyInput[]
): RealEstateTotals {
  let valueEur = 0;
  let debtEur = 0;
  let costBasisEur = 0;
  let monthlyCashFlowEur = 0;
  let rentedCount = 0;
  let loanCount = 0;

  let yieldWeight = 0;
  let yieldSum = 0;

  for (const v of views) {
    valueEur += v.shareValueEur;
    debtEur += v.debtEur;
    costBasisEur += v.costBasisEur;
    loanCount += v.loanCount;
    if (v.status === "RENTED") rentedCount += 1;
    if (v.monthlyCashFlowEur != null) monthlyCashFlowEur += v.monthlyCashFlowEur;
    /*
      Seuls les biens locatifs entrent dans le rendement moyen.

      La fonction de rendement ne connaît que le loyer et la valeur : elle
      rendrait un taux pour une résidence principale dont un loyer aurait été
      saisi par erreur, et ce taux se retrouverait dans la moyenne du parc.
      L'usage tranche, pas la présence d'un montant.
    */
    if (v.isRental && v.grossYieldPct != null && v.shareValueEur > 0) {
      yieldWeight += v.shareValueEur;
      yieldSum += v.grossYieldPct * v.shareValueEur;
    }
  }

  const byId = new Map(properties.map((p) => [p.assetId, p]));
  let annualRentEur = 0;
  let annualChargesEur = 0;
  for (const v of views) {
    const p = byId.get(v.assetId);
    if (!p || !v.isRental) continue;
    const occupancy = p.occupancyRatePct ? num(p.occupancyRatePct) / 100 : 1;
    annualRentEur += num(p.monthlyRentEur) * occupancy * 12;
    annualChargesEur += num(p.monthlyChargesEur) * 12 + v.annualFiscalBurdenEur;
  }

  return {
    valueEur,
    debtEur,
    equityEur: valueEur - debtEur,
    costBasisEur,
    weightedGrossYieldPct: yieldWeight > 0 ? yieldSum / yieldWeight : null,
    monthlyCashFlowEur,
    annualRentEur,
    annualChargesEur,
    propertyCount: views.length,
    rentedCount,
    loanCount,
    debtRatioPct: valueEur > 0 ? (debtEur / valueEur) * 100 : null,
  };
}

/** Répartition de la valeur par statut d'exploitation. */
export function splitByStatus(
  views: PropertyView[]
): Array<{ status: PropertyStatus; label: string; valueEur: number; sharePct: number | null }> {
  const LABELS: Record<PropertyStatus, string> = {
    PRIMARY: "Résidence principale",
    RENTED: "Locatif",
    SECONDARY: "Secondaire / autre",
    VACANT: "Vacant",
  };
  const ORDER: PropertyStatus[] = ["PRIMARY", "RENTED", "SECONDARY", "VACANT"];

  const byStatus = new Map<PropertyStatus, number>();
  let total = 0;
  for (const v of views) {
    byStatus.set(v.status, (byStatus.get(v.status) ?? 0) + v.shareValueEur);
    total += v.shareValueEur;
  }

  return ORDER.filter((s) => (byStatus.get(s) ?? 0) > 0).map((status) => {
    const valueEur = byStatus.get(status) ?? 0;
    return {
      status,
      label: LABELS[status],
      valueEur,
      sharePct: total > 0 ? (valueEur / total) * 100 : null,
    };
  });
}
