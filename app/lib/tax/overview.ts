/**
 * Vue fiscale consolidée — assemblage, jamais recalcul.
 *
 * Aurea calcule déjà beaucoup de fiscalité, mais dispersée : les plus-values
 * mobilières dans `tax/fiscal-year.ts`, l'IFI et l'arbitrage de régime locatif
 * dans `real-estate/tax/`. Ce module ne fait que les rapprocher sous une forme
 * lisible. **Aucun impôt n'y est calculé** : chaque montant vient d'un moteur
 * existant, et un chiffre absent reste absent.
 *
 * ── Ce qu'il refuse de produire ──────────────────────────────────────────
 *
 * Pas d'impôt sur le revenu. Aurea ne connaît ni les salaires, ni la
 * composition du foyer, ni le nombre de parts : il n'existe aucun barème IR
 * dans ce dépôt, et la « tranche marginale » du module immobilier est une
 * hypothèse fournie par l'utilisateur, pas une TMI déduite.
 *
 * Pas d'échéancier fiscal, pas de succession, pas de documents : rien dans le
 * modèle ne les porte.
 *
 * Pas de « cash disponible après impôts » : il faudrait un impôt total, qui
 * supposerait l'IR.
 */

import { PFU_TOTAL_RATE, ratePct } from "./rates";
import type { FiscalYearReport } from "./fiscal-year";
import type { RealEstateTaxBundlePayload } from "@/app/lib/real-estate/tax/payload";

/**
 * Statut d'un indicateur.
 *
 * `UNAVAILABLE` et `NOT_APPLICABLE` sont distincts à dessein : ne pas être
 * redevable de l'IFI est une réponse, ne pas avoir chargé le parc immobilier
 * n'en est pas une. Les confondre afficherait « 0 € » dans les deux cas.
 */
export type FiscalValueStatus =
  /** Montant calculé et exploitable. */
  | "COMPUTED"
  /** Calculé, mais indicatif par construction (assiette partielle, hypothèse). */
  | "ESTIMATED"
  /** Le calcul aboutit à « rien à payer » — c'est un résultat, pas un trou. */
  | "NOT_APPLICABLE"
  /** La donnée n'a pas pu être obtenue. */
  | "UNAVAILABLE";

export type FiscalKpi = {
  id: string;
  label: string;
  /** Null dès que le statut n'est pas un montant : l'UI ne doit pas écrire 0 €. */
  valueEur: number | null;
  status: FiscalValueStatus;
  /** Libellé affiché à la place du montant quand il n'y en a pas. */
  placeholder: string | null;
  hint: string;
  tone: "neutral" | "positive" | "negative" | "cost";
};

/** Catégorie d'une ligne fiscale — sert au regroupement et au filtre. */
export type FiscalLineKind = "ENVELOPE" | "IFI" | "RENTAL" | "SCHEME";

export type FiscalLine = {
  id: string;
  kind: FiscalLineKind;
  label: string;
  /** Nature de l'imposition, en clair. */
  regimeLabel: string;
  /** Assiette. Null quand la notion n'a pas de sens pour la ligne. */
  baseEur: number | null;
  /** Impôt estimé. Null quand le moteur ne le calcule pas. */
  taxEur: number | null;
  status: FiscalValueStatus;
  /** Ce que l'utilisateur doit savoir avant de lire le montant. */
  caveat: string | null;
  /** Compteurs d'opérations, pour les lignes qui en portent. */
  detail: string;
};

const num = (v: string | number | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Enveloppes entrant dans l'estimation PFU — miroir de `fiscal-year.ts`. */
const PFU_ENVELOPES = new Set(["CTO", "CRYPTO", "CFD"]);
/** Enveloppes à régime propre, volontairement hors PFU estimé. */
const SPECIAL_ENVELOPES = new Set(["PEA", "AV"]);

export function envelopeRegimeLabel(accountType: string): string {
  const k = accountType.toUpperCase();
  if (PFU_ENVELOPES.has(k)) return `PFU ${ratePct(PFU_TOTAL_RATE)}`;
  if (k === "PEA") return "Régime PEA";
  if (k === "AV") return "Régime assurance-vie";
  if (k === "IMMOBILIER") return "Revenus fonciers";
  return "Suivi";
}

export const REGIME_LABELS: Record<string, string> = {
  MICRO_FONCIER: "Micro-foncier",
  REEL_FONCIER: "Réel foncier",
  MICRO_BIC: "Micro-BIC",
  REEL_BIC: "Réel BIC",
};

export const SCHEME_LABELS: Record<string, string> = {
  PINEL: "Pinel",
  PINEL_PLUS: "Pinel+",
  DENORMANDIE: "Denormandie",
  MALRAUX: "Malraux",
  MONUMENT_HISTORIQUE: "Monument historique",
  LOC_AVANTAGES: "Loc'Avantages",
  CENSI_BOUVARD: "Censi-Bouvard",
};

// ─── Indicateurs ─────────────────────────────────────────────────────────────

export function buildFiscalKpis(
  report: FiscalYearReport | null,
  realEstate: RealEstateTaxBundlePayload | null
): FiscalKpi[] {
  const kpis: FiscalKpi[] = [];

  if (report) {
    const t = report.totals;

    kpis.push({
      id: "realized",
      label: "Plus-values réalisées",
      valueEur: t.realizedPnlEur,
      status: t.unresolvedSellCount > 0 ? "ESTIMATED" : "COMPUTED",
      placeholder: null,
      hint:
        t.unresolvedSellCount > 0
          ? `Sous-évalué · ${t.unresolvedSellCount} vente${t.unresolvedSellCount > 1 ? "s" : ""} sans prix de revient`
          : "Ventes de l'année, toutes enveloppes",
      tone: t.realizedPnlEur >= 0 ? "positive" : "negative",
    });

    kpis.push({
      id: "income",
      label: "Revenus encaissés",
      valueEur: t.dividendsNetEur,
      status: "COMPUTED",
      placeholder: null,
      hint: "Nets de retenue à la source et de frais",
      tone: "positive",
    });

    kpis.push({
      id: "pfu",
      label: `PFU estimé (${ratePct(PFU_TOTAL_RATE)})`,
      valueEur: t.estimatedPfuEur,
      status: "ESTIMATED",
      placeholder: null,
      hint: "CTO, crypto et CFD · gains positifs",
      tone: "cost",
    });
  } else {
    kpis.push({
      id: "realized",
      label: "Plus-values réalisées",
      valueEur: null,
      status: "UNAVAILABLE",
      placeholder: "Non disponible",
      hint: "Le rapport de l'année n'a pas pu être chargé",
      tone: "neutral",
    });
  }

  /*
    IFI : trois issues distinctes. Ne pas dépasser le seuil est une réponse
    utile ; ne pas avoir de parc immobilier chargé n'en est pas une.
  */
  if (!realEstate) {
    kpis.push({
      id: "ifi",
      label: "IFI",
      valueEur: null,
      status: "UNAVAILABLE",
      placeholder: "Non calculé",
      hint: "Assiette immobilière non chargée",
      tone: "neutral",
    });
  } else if (!realEstate.ifi.liable) {
    kpis.push({
      id: "ifi",
      label: "IFI",
      valueEur: null,
      status: "NOT_APPLICABLE",
      placeholder: "Non redevable",
      hint: `Assiette nette sous le seuil de ${(1_300_000).toLocaleString("fr-FR")} €`,
      tone: "neutral",
    });
  } else {
    kpis.push({
      id: "ifi",
      label: "IFI",
      valueEur: num(realEstate.ifi.taxEur),
      status: "COMPUTED",
      placeholder: null,
      hint: `Assiette nette ${Math.round(num(realEstate.ifi.netTaxableEur)).toLocaleString("fr-FR")} €`,
      tone: "cost",
    });
  }

  /*
    Réductions d'impôt : c'est le seul montant de ce module qui **diminue**
    l'impôt, et il est réellement calculé (plafonnement global compris).
  */
  const reduction = realEstate
    ? num(realEstate.schemes.summary.effectiveAnnualEur)
    : 0;
  if (realEstate && realEstate.schemes.rows.length > 0) {
    kpis.push({
      id: "reductions",
      label: "Réductions d'impôt",
      valueEur: reduction,
      status: "COMPUTED",
      placeholder: null,
      hint: `${realEstate.schemes.rows.length} dispositif${realEstate.schemes.rows.length > 1 ? "s" : ""} · après plafonnement`,
      tone: "positive",
    });
  } else if (report) {
    kpis.push({
      id: "wht",
      label: "Retenue à la source",
      valueEur: report.totals.withholdingTaxEur,
      status: "COMPUTED",
      placeholder: null,
      hint: "Déjà prélevée à l'étranger, hors crédit d'impôt",
      tone: "cost",
    });
  }

  return kpis;
}

// ─── Lignes fiscales ─────────────────────────────────────────────────────────

export function buildFiscalLines(
  report: FiscalYearReport | null,
  realEstate: RealEstateTaxBundlePayload | null
): FiscalLine[] {
  const lines: FiscalLine[] = [];

  for (const b of report?.byEnvelope ?? []) {
    const k = b.accountType.toUpperCase();
    const inPfu = PFU_ENVELOPES.has(k);
    const base = Math.max(0, b.realizedPnlEur) + Math.max(0, b.dividendsNetEur);

    lines.push({
      id: `envelope:${b.accountType}`,
      kind: "ENVELOPE",
      label: b.label,
      regimeLabel: envelopeRegimeLabel(b.accountType),
      baseEur: inPfu ? base : null,
      /*
        Hors CTO / crypto / CFD, aucun impôt n'est estimé — et c'est
        volontaire. PEA et assurance-vie ont des régimes que ce module ne
        simule pas ; leur appliquer le PFU produirait un chiffre faux.
      */
      taxEur: inPfu ? base * Number(PFU_TOTAL_RATE) : null,
      /*
        Le PFU reste « estimé » même sans vente orpheline : il ignore les
        abattements, l'option pour le barème et les crédits d'impôt. Le
        présenter comme calculé serait un abus de confiance.
      */
      status: inPfu ? "ESTIMATED" : "NOT_APPLICABLE",
      caveat:
        b.unresolvedSellCount > 0
          ? `${b.unresolvedSellCount} vente${b.unresolvedSellCount > 1 ? "s" : ""} sans prix de revient connu — le réalisé est sous-évalué.`
          : SPECIAL_ENVELOPES.has(k)
            ? "Régime spécial : le suivi est affiché, l'imposition n'est pas simulée."
            : null,
      detail: `${b.sellCount} vente${b.sellCount > 1 ? "s" : ""} · ${b.incomeCount} revenu${b.incomeCount > 1 ? "s" : ""}`,
    });
  }

  if (realEstate) {
    const ifi = realEstate.ifi;
    if (ifi.lines.length > 0) {
      lines.push({
        id: "ifi",
        kind: "IFI",
        label: "Impôt sur la fortune immobilière",
        regimeLabel: "Barème IFI",
        baseEur: num(ifi.netTaxableEur),
        taxEur: ifi.liable ? num(ifi.taxEur) : null,
        status: ifi.liable ? "COMPUTED" : "NOT_APPLICABLE",
        caveat: ifi.liable
          ? null
          : "Assiette nette sous le seuil de 1 300 000 € : aucun IFI dû.",
        detail: `${ifi.lines.length} bien${ifi.lines.length > 1 ? "s" : ""} · ${Math.round(num(ifi.totalDeductibleDebtEur)).toLocaleString("fr-FR")} € de dettes déduites`,
      });
    }

    for (const [mode, section] of [
      ["bare", realEstate.rental.bare],
      ["furnished", realEstate.rental.furnished],
    ] as const) {
      if (section.count === 0) continue;
      const best = section.outcomes.find((o) => o.regime === section.bestRegime);
      lines.push({
        id: `rental:${mode}`,
        kind: "RENTAL",
        label: mode === "bare" ? "Location nue" : "Location meublée",
        regimeLabel: section.bestRegime
          ? (REGIME_LABELS[section.bestRegime] ?? section.bestRegime)
          : "Régime non déterminé",
        baseEur: best ? num(best.taxableIncomeEur) : num(section.grossRentEur),
        taxEur: best ? num(best.totalTaxEur) : null,
        status: best ? "ESTIMATED" : "UNAVAILABLE",
        caveat:
          "Dépend de la tranche marginale, que vous renseignez : Aurea ne la déduit pas de vos revenus.",
        // « loyers bruts » se lisait comme un encaissement ; c'est le loyer
        // contractuel annualisé (monthlyRentEur × 12) qui sert de base au
        // comparateur de régimes, jamais le journal. Voir RentalDetail.
        detail: `${section.count} bien${section.count > 1 ? "s" : ""} · ${Math.round(num(section.grossRentEur)).toLocaleString("fr-FR")} € de loyer contractuel annualisé`,
      });
    }

    for (const row of realEstate.schemes.rows) {
      lines.push({
        id: `scheme:${row.assetId}:${row.scheme}`,
        kind: "SCHEME",
        label: row.label,
        regimeLabel: SCHEME_LABELS[row.scheme] ?? row.scheme,
        baseEur: num(row.eligibleBaseEur),
        /* Une réduction est un impôt en moins : le signe le dit. */
        taxEur: row.finished ? null : -num(row.annualReductionEur),
        status: row.finished ? "NOT_APPLICABLE" : "COMPUTED",
        caveat: row.finished
          ? "Dispositif arrivé à son terme : plus aucune réduction imputable."
          : row.baseWasCapped
            ? "Base plafonnée par le dispositif."
            : null,
        detail: row.finished
          ? `Terminé · ${row.yearsElapsed} an${row.yearsElapsed > 1 ? "s" : ""}`
          : `${row.yearsRemaining} an${row.yearsRemaining > 1 ? "s" : ""} restant${row.yearsRemaining > 1 ? "s" : ""}`,
      });
    }
  }

  return lines;
}

// ─── Opportunités ────────────────────────────────────────────────────────────

/**
 * Pistes d'optimisation **réellement calculées**.
 *
 * Chaque entrée doit s'appuyer sur un moteur existant. Une opportunité
 * plausible mais non chiffrée est affichée sans montant plutôt qu'avec un
 * chiffre inventé — et une opportunité sans support est simplement absente.
 */
export type FiscalOpportunity = {
  id: string;
  title: string;
  description: string;
  /** Null quand l'économie n'est pas calculable : ne rien afficher alors. */
  savingEur: number | null;
  lineId: string | null;
};

export function buildFiscalOpportunities(
  report: FiscalYearReport | null,
  realEstate: RealEstateTaxBundlePayload | null
): FiscalOpportunity[] {
  const out: FiscalOpportunity[] = [];

  if (realEstate) {
    for (const [mode, section] of [
      ["bare", realEstate.rental.bare],
      ["furnished", realEstate.rental.furnished],
    ] as const) {
      const saving = num(section.savingVsNextEur);
      if (section.count === 0 || saving <= 0 || !section.bestRegime) continue;
      out.push({
        id: `regime:${mode}`,
        title: `Régime ${REGIME_LABELS[section.bestRegime] ?? section.bestRegime} — ${mode === "bare" ? "location nue" : "location meublée"}`,
        description:
          "Écart d'impôt avec le régime suivant, à loyers et charges inchangés.",
        savingEur: saving,
        lineId: `rental:${mode}`,
      });
    }

    const cappedAway = num(realEstate.schemes.summary.cappedAwayEur);
    if (cappedAway > 0) {
      out.push({
        id: "scheme-cap",
        title: "Plafonnement global des niches fiscales",
        description: `${Math.round(cappedAway).toLocaleString("fr-FR")} € de réduction ne sont pas imputables cette année.`,
        savingEur: null,
        lineId: null,
      });
    }
  }

  /*
    Moins-values reportables : le montant est réel, l'économie ne l'est pas.
    Elle dépendrait des plus-values des dix années suivantes, que personne ne
    connaît. On expose donc le report, jamais un gain chiffré.
  */
  if (report && report.totals.realizedPnlEur < 0) {
    out.push({
      id: "loss-carry",
      title: "Moins-value nette de l'année",
      description:
        "Imputable sur les plus-values de même nature des dix années suivantes, si elle est déclarée.",
      savingEur: null,
      lineId: null,
    });
  }

  if (report && report.totals.withholdingTaxEur > 0) {
    out.push({
      id: "wht-credit",
      title: "Retenue à la source étrangère",
      description:
        "Peut ouvrir droit à un crédit d'impôt selon la convention applicable. Aurea ne le calcule pas.",
      savingEur: null,
      lineId: null,
    });
  }

  return out;
}

// ─── Série pluriannuelle ─────────────────────────────────────────────────────

export type FiscalHistoryPoint = {
  year: number;
  realizedPnlEur: number;
  dividendsNetEur: number;
  estimatedPfuEur: number;
};

export function buildFiscalHistory(
  reports: FiscalYearReport[] | null | undefined
): FiscalHistoryPoint[] {
  if (!reports || reports.length === 0) return [];
  return reports
    .map((r) => ({
      year: r.year,
      realizedPnlEur: r.totals.realizedPnlEur,
      dividendsNetEur: r.totals.dividendsNetEur,
      estimatedPfuEur: r.totals.estimatedPfuEur,
    }))
    .sort((a, b) => a.year - b.year);
}
