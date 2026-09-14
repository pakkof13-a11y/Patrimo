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
 *   d'avant le 27/09/2017 ; la part rattachée aux versements postérieurs se
 *   partage entre 7,5 % et 12,8 % au prorata du seuil de 150 000 €.
 *   Avant 8 ans : 12,8 % sur la totalité des gains, sans abattement.
 *
 * ## Le seuil de 150 000 € porte sur les PRIMES, et se proratise
 *
 * Deux erreurs faciles, toutes deux corrigées ici :
 *
 * 1. **La base est le cumul des primes versées, pas l'encours.** Apprécier le
 *    seuil sur la valeur de rachat ferait dépendre le taux d'imposition de la
 *    performance des marchés : 60 000 € versés valant 160 000 € basculeraient à
 *    12,8 % alors que le versement reste très en deçà du seuil.
 * 2. **C'est un prorata, pas un tout-ou-rien.** La loi taxe à 7,5 % « la
 *    fraction des produits correspondant aux primes n'excédant pas 150 000 € ».
 *    Basculer la totalité à 12,8 % dès le premier euro au-delà du seuil
 *    surtaxe : sur 300 000 € de primes, la moitié des gains relève encore du
 *    taux réduit.
 *
 * Fraction au taux réduit (BOI-RPPM-RCM-20-10-20-50) :
 *
 * ```
 * (150 000 − primes avant 27/09/2017) / primes à compter du 27/09/2017
 * ```
 *
 * bornée à [0, 1], appréciée sur **l'ensemble des contrats du foyer**.
 *
 * Ce n'est **pas** un simulateur fiscal certifié : les cas particuliers
 * (option barème, rachats en perte, prélèvements sociaux déjà acquittés sur
 * fonds euro, etc.) restent hors scope.
 */

import {
  annualAllowanceEur,
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
   * Cumul des versements **avant** le 27/09/2017, tous contrats du foyer.
   *
   * Sert au seuil de 150 000 €, qu'il vient réduire : la fraction au taux
   * réduit se calcule sur ce qu'il reste de l'enveloppe après les versements
   * pré-réforme.
   */
  totalPremiumsBefore2017AllContractsEur: string | number;
  /**
   * Cumul des versements **à compter** du 27/09/2017, tous contrats du foyer.
   *
   * Dénominateur de la fraction au taux réduit. C'est bien un cumul de primes,
   * jamais un encours : la valeur de rachat n'entre pas dans ce calcul.
   */
  totalPremiumsAfter2017AllContractsEur: string | number;
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

/**
 * Fraction des gains post-réforme relevant du taux réduit de 7,5 %.
 *
 * ```
 * (150 000 − primes avant 27/09/2017) / primes à compter du 27/09/2017
 * ```
 *
 * bornée à [0, 1], sur l'ensemble des contrats du foyer.
 *
 * Deux bornes qui ne sont pas des détails :
 * - numérateur négatif (les seuls versements pré-réforme dépassent déjà le
 *   seuil) ⇒ 0, tout le post-réforme au taux plein ;
 * - dénominateur nul (aucun versement post-réforme) ⇒ 1 par convention, mais
 *   la base à laquelle il s'applique est alors elle-même nulle.
 */
export function reducedRateShareOfPostReformGains(
  totalPremiumsBefore2017Eur: number,
  totalPremiumsAfter2017Eur: number
): number {
  if (totalPremiumsAfter2017Eur <= MONEY_EPS) return 1;
  const room = PFU_OUTSTANDING_THRESHOLD_EUR - totalPremiumsBefore2017Eur;
  if (room <= 0) return 0;
  return Math.min(1, room / totalPremiumsAfter2017Eur);
}

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
  const allBefore = parseMoney(input.totalPremiumsBefore2017AllContractsEur);
  const allAfter = parseMoney(input.totalPremiumsAfter2017AllContractsEur);
  const usedRaw = parseMoney(input.allowanceAlreadyUsedThisYearEur ?? 0);

  if (
    redemption === null ||
    gainsRaw === null ||
    before === null ||
    after === null ||
    allBefore === null ||
    allAfter === null ||
    usedRaw === null
  ) {
    return invalid("Montants invalides");
  }
  if (
    redemption < 0 ||
    gainsRaw < 0 ||
    before < 0 ||
    after < 0 ||
    allBefore < 0 ||
    allAfter < 0
  ) {
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

    // 1) Répartition des gains du CONTRAT entre régime pré- et post-réforme,
    //    au prorata de ses propres versements.
    //
    //    Sans historique de versements sur ce contrat, tout bascule en
    //    post-réforme : c'est l'hypothèse la plus chargée, et un simulateur ne
    //    doit pas promettre un impôt plus faible que la réalité faute de
    //    données.
    const premiumsTotal = before + after;
    const beforeShare = premiumsTotal > MONEY_EPS ? before / premiumsTotal : 0;
    const gainsFromBefore = taxableGains * beforeShare;
    const gainsFromAfter = taxableGains - gainsFromBefore;

    // 2) Les gains pré-réforme sont à 7,5 % après huit ans, sans condition de
    //    seuil : celui-ci ne concerne que les versements postérieurs.
    pfuReducedBase = gainsFromBefore;

    // 3) Les gains post-réforme se partagent au prorata du seuil de 150 000 €,
    //    apprécié sur les PRIMES de tous les contrats du foyer.
    const reducedShare = reducedRateShareOfPostReformGains(allBefore, allAfter);
    pfuReducedBase += gainsFromAfter * reducedShare;
    pfuStandardBase = gainsFromAfter * (1 - reducedShare);
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
  /**
   * Assiette imposable maximale du contrat : `max(0, valeur − revient)`.
   *
   * Ce n'est **pas** la plus-value latente : en moins-value elle vaut 0, là où
   * `latentPnlEur` est négatif. Les deux s'affichent côte à côte, sous deux
   * libellés distincts — le premier dit ce que porte la position, le second
   * ce qu'un rachat peut au plus imposer.
   */
  latentGainEur: string;
  /**
   * Plus-value latente **signée** : `valeur − revient`, négative en
   * moins-value. C'est le même nombre que les autres écrans (« Plus-value
   * latente » de la vue contrat) affichent depuis le journal — les supports
   * ont toujours un `costBasisEur`, la somme de leurs `unrealizedPnlEur` lui est
   * identique. "0" quand la position est inconnue.
   */
  latentPnlEur: string;
  /**
   * Le montant réellement rachetable, plafonné à l'encours.
   *
   * Il était calculé en interne et jamais rendu : la fonction plafonnait les
   * gains, répondait `ok: true`, et l'appelant continuait avec sa saisie
   * d'origine. Un rachat de 200 000 € sur une position de 100 000 € affichait
   * donc « net perçu 195 060 € » pour un contrat qui n'en détient que la
   * moitié. L'appelant doit calculer son impôt et son net sur **ce** montant.
   */
  cappedRedemptionEur: string;
} {
  const redemption = parseMoney(input.redemptionEur);
  const value = parseMoney(input.positionValueEur);
  const cost = parseMoney(input.costBasisEur);

  /*
    Le gain latent, son ratio et le plafond de rachat sont des propriétés de la
    **position** — `value − cost`, `latent / value`, `value` — pas de la saisie.
    Ils étaient rendus à « 0 » sur un rachat illisible ou négatif : une saisie
    de « -1 » sur une position à 20 000 € de plus-value réaffichait « Gain
    latent 0 € », le défaut que la branche « rachat > encours » avait déjà
    cessé de produire. Ils ne sont inconnus que si la position l'est.
  */
  const positionKnown =
    value !== null && cost !== null && value >= 0 && cost >= 0;
  const latentPnl = positionKnown ? (value as number) - (cost as number) : 0;
  const latentGain = Math.max(0, latentPnl);
  const gainRatio =
    positionKnown && (value as number) > MONEY_EPS
      ? latentGain / (value as number)
      : 0;
  const positionFacts = {
    gainRatio,
    latentGainEur: formatMoney(roundMoney(latentGain)),
    latentPnlEur: formatMoney(roundMoney(latentPnl)),
    // Le maximum rachetable : l'encours lui-même, comme sur un refus pour
    // dépassement. "0" quand la position est inconnue — l'appelant ne
    // l'affiche pas comme plafond (il ne le montre que s'il est > 0).
    cappedRedemptionEur: positionKnown
      ? formatMoney(roundMoney(value as number))
      : "0",
  };

  if (redemption === null || value === null || cost === null) {
    return {
      ok: false,
      error: "Montants invalides",
      gainsInRedemptionEur: "0",
      capitalInRedemptionEur: "0",
      ...positionFacts,
    };
  }
  if (redemption < 0 || value < 0 || cost < 0) {
    return {
      ok: false,
      error: "Les montants ne peuvent pas être négatifs",
      gainsInRedemptionEur: "0",
      capitalInRedemptionEur: "0",
      ...positionFacts,
    };
  }
  const cappedRedemption = Math.min(redemption, value > MONEY_EPS ? value : redemption);
  // Rachat total (ou ≥ valeur) : tout le gain latent. Sinon proportionnel.
  const fullExit = value <= MONEY_EPS || redemption >= value - MONEY_EPS;
  const gains = fullExit
    ? latentGain
    : Math.min(cappedRedemption, cappedRedemption * gainRatio);
  const capital = Math.max(0, Math.min(redemption, cappedRedemption) - gains);

  /*
    Un rachat supérieur à l'encours est refusé, pas rogné en silence.

    Le plafonnement existait déjà pour les gains — `cappedRedemption` — mais la
    fonction répondait `ok: true` sans dire qu'elle avait coupé. Le panneau
    calculait alors l'impôt et le net sur le montant saisi, et annonçait un net
    perçu supérieur à ce que le contrat détient : 195 060 € sur une position de
    100 000 €.

    `ok: false` avec une raison affichable est la seule sortie honnête : on ne
    peut pas racheter ce qui n'est pas là, et décider que l'utilisateur voulait
    dire « tout » serait une correction de saisie que rien ne fonde. Le montant
    plafonné part quand même dans la réponse, pour que l'écran puisse le
    proposer.
  */
  if (redemption > value + MONEY_EPS) {
    /*
      « l'encours disponible », pas « l'encours du support » : cette fonction
      ne sait pas si `positionValueEur` est un support ou la somme de trois. En
      périmètre « Tout le contrat (agrégat) », le panneau lui passe le total, et
      l'ancien libellé désignait un support unique qui n'existait pas. Le mot
      neutre est vrai dans les deux cas ; le montant, lui, l'a toujours été.
    */
    return {
      ok: false,
      error: `Rachat supérieur à l'encours disponible (${formatMoney(roundMoney(value))} €)`,
      gainsInRedemptionEur: "0",
      capitalInRedemptionEur: "0",
      ...positionFacts,
      cappedRedemptionEur: formatMoney(roundMoney(value)),
    };
  }

  return {
    ok: true,
    gainsInRedemptionEur: formatMoney(roundMoney(gains)),
    capitalInRedemptionEur: formatMoney(roundMoney(capital)),
    ...positionFacts,
    cappedRedemptionEur: formatMoney(roundMoney(cappedRedemption)),
  };
}

/** Borne qui a retenu une quote-part de gains saisie à la main. */
export type GainsOverrideClampedBy = "none" | "redemption" | "latentGain";

export type GainsOverrideClamp = {
  /** Quote-part retenue pour le calcul, après plafonnement. */
  gainsEur: string;
  /** Ce que l'utilisateur avait saisi (≥ 0, illisible ⇒ 0). */
  requestedEur: string;
  /** Plafond qui a joué, ou "none" si la saisie est passée telle quelle. */
  clampedBy: GainsOverrideClampedBy;
  /** Valeur du plafond qui a joué ("0" si aucun). */
  capEur: string;
};

/**
 * Plafonne une quote-part de gains saisie à la main.
 *
 * Deux bornes, toutes deux des faits et non des choix :
 * - le **rachat** : un retrait ne contient pas plus de gains que d'euros ;
 * - le **gain latent** du contrat (`latentGainEur`) : un rachat, même total,
 *   n'impose pas plus de gains que la position n'en porte.
 *
 * Le panneau ne bornait qu'au rachat. Sur 100 000 € de valeur pour 80 000 €
 * de revient (20 000 € de gain latent), un rachat de 60 000 € avec « 50 000 »
 * saisi partait imposer 50 000 € de gains — 7 410 € d'impôt sur 30 000 € de
 * gain qui n'existent pas.
 *
 * `latentGainEur: null` = position inconnue (contrat sans support rattaché au
 * journal) : seule la borne du rachat joue, puisque c'est précisément pour ce
 * cas que la saisie manuelle existe. Ne pas confondre avec "0", qui est un
 * gain latent connu et nul.
 *
 * Quand les deux bornes sont dépassées, on nomme la plus basse ; à égalité,
 * le gain latent — c'est lui qui renseigne sur le contrat.
 */
export function clampGainsOverride(input: {
  overrideEur: string | number;
  redemptionEur: string | number;
  latentGainEur: string | number | null;
}): GainsOverrideClamp {
  const requested = Math.max(0, parseMoney(input.overrideEur) ?? 0);
  const redemption = Math.max(0, parseMoney(input.redemptionEur) ?? 0);
  const latent =
    input.latentGainEur === null
      ? null
      : Math.max(0, parseMoney(input.latentGainEur) ?? 0);

  let gains = Math.min(requested, redemption);
  if (latent !== null) gains = Math.min(gains, latent);

  let clampedBy: GainsOverrideClampedBy = "none";
  let cap = 0;
  if (requested - gains > MONEY_EPS) {
    const latentBinds = latent !== null && latent <= redemption;
    clampedBy = latentBinds ? "latentGain" : "redemption";
    cap = latentBinds ? (latent as number) : redemption;
  }

  return {
    gainsEur: formatMoney(roundMoney(gains)),
    requestedEur: formatMoney(roundMoney(requested)),
    clampedBy,
    capEur: formatMoney(roundMoney(cap)),
  };
}
