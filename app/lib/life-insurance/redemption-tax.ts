/**
 * Moteur pur d'imposition d'un rachat d'assurance-vie (PFU + prélèvements sociaux).
 *
 * Module sans Prisma, sans horloge, sans I/O : chaque entrée est fournie par
 * l'appelant (collecte étape 1 + quote-part de gains déjà calculée depuis le
 * prix de revient). Aucune estimation n'est inventée ici.
 *
 * ## Périmètre
 *
 * - Impôt sur le **revenu** (PFU) et **prélèvements sociaux** sur la seule
 *   quote-part de **gains** du rachat — jamais sur le capital retiré.
 * - Abattement annuel post-8 ans (4 600 € / 9 200 €) : s'applique uniquement
 *   à l'IR, pas aux PS ; non reportable d'une année sur l'autre.
 * - Taux PFU post-8 ans : 7,5 % sur la part de gains rattachée aux versements
 *   d'avant le 27/09/2017, et 7,5 % ou 12,8 % sur le reste selon l'encours
 *   global (seuil 150 000 €). Avant 8 ans : 12,8 % sur la totalité des gains,
 *   sans abattement.
 *
 * Ce n'est **pas** un simulateur fiscal certifié : les cas particuliers
 * (option barème, rachats en perte, prélèvements sociaux déjà acquittés sur
 * fonds euro, etc.) restent hors scope.
 */

import {
  annualAllowanceEur,
  exceedsPfuOutstandingThreshold,
  PFU_OUTSTANDING_THRESHOLD_EUR,
  SOCIAL_CHARGES_RATE,
  type TaxHousehold,
} from "@/app/lib/life-insurance/fiscal";

/** Taux PFU réduit (versements pré-réforme / encours ≤ 150 k€ après 8 ans). */
export const PFU_REDUCED_RATE = 0.075;
/** Taux PFU de droit commun (12,8 %). */
export const PFU_STANDARD_RATE = 0.128;

const MONEY_EPS = 1e-6;

function parseMoney(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(",", ".");
  if (s === "") return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return n;
}

function formatMoney(n: number): string {
  const fixed = n.toFixed(8).replace(/\.?0+$/, "");
  return fixed === "-0" ? "0" : fixed;
}

function roundMoney(n: number): number {
  // Centime bancaire le plus proche — les tests raisonnent en centimes.
  return Math.round(n * 100) / 100;
}

export type RedemptionTaxInput = {
  /** Montant brut retiré (capital + gains). */
  redemptionEur: string | number;
  /**
   * Quote-part de **gains** contenue dans ce rachat.
   * Doit être ≤ redemptionEur. Jamais le gain global du contrat si le rachat
   * est partiel — l'appelant la calcule depuis le prix de revient.
   */
  gainsInRedemptionEur: string | number;
  /** Antériorité de huit ans acquise au jour du rachat. */
  hasAnteriority: boolean;
  /** Cumul des versements avant le 27/09/2017 (ce contrat). */
  premiumsBefore2017Eur: string | number;
  /** Cumul des versements à compter du 27/09/2017 (ce contrat). */
  premiumsAfter2017Eur: string | number;
  /**
   * Encours total d'assurance-vie, tous contrats du foyer.
   * Sert uniquement au seuil de 150 000 € (taux post-réforme).
   */
  totalOutstandingAllContractsEur: string | number;
  taxHousehold: TaxHousehold;
  /**
   * Abattement **déjà consommé cette année civile** sur d'autres rachats.
   * L'abattement non consommé en N **ne se reporte pas** en N+1 : pour une
   * nouvelle année, l'appelant repasse 0 (jamais le reliquat de N).
   */
  allowanceAlreadyUsedThisYearEur?: string | number;
};

export type RedemptionTaxResult = {
  ok: boolean;
  error?: string;

  redemptionEur: string;
  /** Gains soumis à PS / base avant abattement IR. */
  gainsInRedemptionEur: string;
  /** Capital retiré = rachat − gains (non imposable). */
  capitalInRedemptionEur: string;

  /** Abattement IR effectivement imputé sur ce rachat. */
  allowanceAppliedEur: string;
  /** Reliquat d'abattement encore disponible **cette année** (0 l'année suivante). */
  allowanceRemainingThisYearEur: string;
  /** Gains restant imposables à l'IR après abattement. */
  taxableGainsEur: string;

  /**
   * Taux PFU effectif moyen sur les gains imposables (0 si base nulle).
   * Utile en UI ; le détail des assiettes est dans les champs `pfu*`.
   */
  pfuEffectiveRate: number;
  /** Assiette taxée à 7,5 %. */
  pfuReducedBaseEur: string;
  /** Assiette taxée à 12,8 %. */
  pfuStandardBaseEur: string;
  pfuTaxEur: string;

  /** PS = 17,2 % × gains du rachat (avant abattement IR). */
  socialChargesEur: string;
  socialChargesRate: number;

  totalTaxEur: string;
  /** Net perçu = rachat − IR − PS. */
  netReceivedEur: string;
};

function invalid(message: string): RedemptionTaxResult {
  return {
    ok: false,
    error: message,
    redemptionEur: "0",
    gainsInRedemptionEur: "0",
    capitalInRedemptionEur: "0",
    allowanceAppliedEur: "0",
    allowanceRemainingThisYearEur: "0",
    taxableGainsEur: "0",
    pfuEffectiveRate: 0,
    pfuReducedBaseEur: "0",
    pfuStandardBaseEur: "0",
    pfuTaxEur: "0",
    socialChargesEur: "0",
    socialChargesRate: SOCIAL_CHARGES_RATE,
    totalTaxEur: "0",
    netReceivedEur: "0",
  };
}

/**
 * Calcule l'imposition d'un rachat d'assurance-vie.
 *
 * Pure : mêmes entrées ⇒ mêmes sorties. Ne lit ni base ni date système.
 */
export function computeRedemptionTax(
  input: RedemptionTaxInput
): RedemptionTaxResult {
  const redemption = parseMoney(input.redemptionEur);
  const gainsRaw = parseMoney(input.gainsInRedemptionEur);
  const before = parseMoney(input.premiumsBefore2017Eur);
  const after = parseMoney(input.premiumsAfter2017Eur);
  const outstanding = parseMoney(input.totalOutstandingAllContractsEur);
  const usedRaw = parseMoney(input.allowanceAlreadyUsedThisYearEur ?? 0);

  if (
    redemption === null ||
    gainsRaw === null ||
    before === null ||
    after === null ||
    outstanding === null ||
    usedRaw === null
  ) {
    return invalid("Montants invalides");
  }
  if (redemption < 0 || gainsRaw < 0 || before < 0 || after < 0 || outstanding < 0) {
    return invalid("Les montants ne peuvent pas être négatifs");
  }
  if (usedRaw < 0) {
    return invalid("Abattement déjà consommé invalide");
  }
  // Un rachat partiel ne peut pas contenir plus de gains que le montant retiré.
  if (gainsRaw - redemption > MONEY_EPS) {
    return invalid(
      "La quote-part de gains ne peut pas dépasser le montant du rachat"
    );
  }

  const gains = Math.min(gainsRaw, redemption);
  const capital = redemption - gains;

  // PS : toujours sur la totalité des gains du rachat (pas d'abattement PS).
  const socialCharges = roundMoney(gains * SOCIAL_CHARGES_RATE);

  const annualCap = annualAllowanceEur(input.taxHousehold);
  const alreadyUsed = Math.min(usedRaw, annualCap);
  const allowanceBudget = Math.max(0, annualCap - alreadyUsed);

  let allowanceApplied = 0;
  let taxableGains = gains;
  let pfuReducedBase = 0;
  let pfuStandardBase = 0;

  if (!input.hasAnteriority) {
    // Avant 8 ans : pas d'abattement, PFU 12,8 % sur la totalité des gains,
    // quel que soit l'encours et la date des versements.
    allowanceApplied = 0;
    taxableGains = gains;
    pfuReducedBase = 0;
    pfuStandardBase = taxableGains;
  } else {
    allowanceApplied = Math.min(gains, allowanceBudget);
    taxableGains = Math.max(0, gains - allowanceApplied);

    const premiumsTotal = before + after;
    const beforeShare = premiumsTotal > MONEY_EPS ? before / premiumsTotal : 0;
    const afterShare = premiumsTotal > MONEY_EPS ? after / premiumsTotal : 1;

    // Répartition des gains imposables proportionnelle aux versements.
    const gainsFromBefore = taxableGains * beforeShare;
    const gainsFromAfter = taxableGains * afterShare;

    // Part pré-réforme : toujours 7,5 % après 8 ans.
    pfuReducedBase = gainsFromBefore;
    // Part post-réforme : 7,5 % si encours global ≤ 150 k€, sinon 12,8 %.
    const postAtReduced = !exceedsPfuOutstandingThreshold(outstanding);
    if (postAtReduced) {
      pfuReducedBase += gainsFromAfter;
      pfuStandardBase = 0;
    } else {
      pfuStandardBase = gainsFromAfter;
    }

    // Sans historique de versements : tout le taxable au taux post-réforme.
    if (premiumsTotal <= MONEY_EPS) {
      if (postAtReduced) {
        pfuReducedBase = taxableGains;
        pfuStandardBase = 0;
      } else {
        pfuReducedBase = 0;
        pfuStandardBase = taxableGains;
      }
    }
  }

  pfuReducedBase = roundMoney(pfuReducedBase);
  pfuStandardBase = roundMoney(pfuStandardBase);
  // Recaler la somme des assiettes sur taxable arrondi (dérive de parts).
  const basesSum = pfuReducedBase + pfuStandardBase;
  const taxableRounded = roundMoney(taxableGains);
  if (Math.abs(basesSum - taxableRounded) > 0.02 && taxableRounded > 0) {
    // Ajuste la plus grosse assiette pour coller au taxable.
    if (pfuStandardBase >= pfuReducedBase) {
      pfuStandardBase = roundMoney(taxableRounded - pfuReducedBase);
    } else {
      pfuReducedBase = roundMoney(taxableRounded - pfuStandardBase);
    }
  }

  const pfuTax = roundMoney(
    pfuReducedBase * PFU_REDUCED_RATE + pfuStandardBase * PFU_STANDARD_RATE
  );
  const pfuEffectiveRate =
    taxableRounded > MONEY_EPS ? pfuTax / taxableRounded : 0;

  const totalTax = roundMoney(pfuTax + socialCharges);
  const netReceived = roundMoney(redemption - totalTax);
  const allowanceRemaining = Math.max(
    0,
    allowanceBudget - allowanceApplied
  );

  return {
    ok: true,
    redemptionEur: formatMoney(roundMoney(redemption)),
    gainsInRedemptionEur: formatMoney(roundMoney(gains)),
    capitalInRedemptionEur: formatMoney(roundMoney(capital)),
    allowanceAppliedEur: formatMoney(roundMoney(allowanceApplied)),
    allowanceRemainingThisYearEur: formatMoney(roundMoney(allowanceRemaining)),
    taxableGainsEur: formatMoney(taxableRounded),
    pfuEffectiveRate,
    pfuReducedBaseEur: formatMoney(pfuReducedBase),
    pfuStandardBaseEur: formatMoney(pfuStandardBase),
    pfuTaxEur: formatMoney(pfuTax),
    socialChargesEur: formatMoney(socialCharges),
    socialChargesRate: SOCIAL_CHARGES_RATE,
    totalTaxEur: formatMoney(totalTax),
    netReceivedEur: formatMoney(netReceived),
  };
}

/** Seuil d'encours réexporté pour les tests / l'UI du simulateur. */
export { PFU_OUTSTANDING_THRESHOLD_EUR };

/**
 * Quote-part de gains dans un rachat partiel, proportionnelle au P&L latent.
 *
 * ```
 * ratio = max(0, valeur − prix de revient) / valeur
 * gains = min(rachat, rachat × ratio)
 * ```
 *
 * Un rachat total (montant ≥ valeur) reprend tout le gain latent positif.
 * En moins-value latente, les gains imposables sont nuls (pas de crédit d'impôt
 * inventé ici).
 */
export function gainsInPartialRedemption(input: {
  redemptionEur: string | number;
  positionValueEur: string | number;
  costBasisEur: string | number;
}): {
  ok: boolean;
  error?: string;
  gainsInRedemptionEur: string;
  capitalInRedemptionEur: string;
  gainRatio: number;
  latentGainEur: string;
} {
  const redemption = parseMoney(input.redemptionEur);
  const value = parseMoney(input.positionValueEur);
  const cost = parseMoney(input.costBasisEur);
  if (redemption === null || value === null || cost === null) {
    return {
      ok: false,
      error: "Montants invalides",
      gainsInRedemptionEur: "0",
      capitalInRedemptionEur: "0",
      gainRatio: 0,
      latentGainEur: "0",
    };
  }
  if (redemption < 0 || value < 0 || cost < 0) {
    return {
      ok: false,
      error: "Les montants ne peuvent pas être négatifs",
      gainsInRedemptionEur: "0",
      capitalInRedemptionEur: "0",
      gainRatio: 0,
      latentGainEur: "0",
    };
  }

  const latentGain = Math.max(0, value - cost);
  const gainRatio = value > MONEY_EPS ? latentGain / value : 0;
  const cappedRedemption = Math.min(redemption, value > MONEY_EPS ? value : redemption);
  // Rachat total (ou ≥ valeur) : tout le gain latent. Sinon proportionnel.
  const fullExit = value <= MONEY_EPS || redemption >= value - MONEY_EPS;
  const gains = fullExit
    ? latentGain
    : Math.min(cappedRedemption, cappedRedemption * gainRatio);
  const capital = Math.max(0, Math.min(redemption, cappedRedemption) - gains);

  return {
    ok: true,
    gainsInRedemptionEur: formatMoney(roundMoney(gains)),
    capitalInRedemptionEur: formatMoney(roundMoney(capital)),
    gainRatio,
    latentGainEur: formatMoney(roundMoney(latentGain)),
  };
}
