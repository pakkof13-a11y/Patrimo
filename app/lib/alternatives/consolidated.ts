/**
 * Vue consolidée de la poche alternative.
 *
 * Les quatre familles — métaux, private equity, crowdlending, tangibles — ne
 * mesurent pas la même chose, et c'est voulu : un lingot a un PRU, un fonds a
 * une NAV et des appels de capital, un prêt a un encours et une échéance, un
 * tableau a un prix d'achat et une estimation. Ce module ne les uniformise
 * pas ; il extrait le **plus petit dénominateur réellement comparable** —
 * ce que ça vaut, ce que ça a coûté, l'écart entre les deux — pour qu'une
 * seule liste puisse les montrer côte à côte.
 *
 * Tout le reste reste propre à chaque métier et se lit dans le panneau de
 * détail. Aucun indicateur n'est inventé : quand une grandeur n'a pas de sens
 * pour une famille, elle vaut `null` et l'écran affiche un tiret.
 *
 * Module **pur** : ni Prisma, ni React, ni réseau.
 */

export type AlternativeCategory =
  | "METAL"
  | "PRIVATE_EQUITY"
  | "CROWDLENDING"
  | "TANGIBLE";

export const CATEGORY_LABEL: Record<AlternativeCategory, string> = {
  METAL: "Métaux précieux",
  PRIVATE_EQUITY: "Private Equity",
  CROWDLENDING: "Crowdlending",
  TANGIBLE: "Tangibles",
};

/** Sous-onglet correspondant — sert aux alertes et aux liens de la synthèse. */
export const CATEGORY_SUB: Record<AlternativeCategory, string> = {
  METAL: "metals",
  PRIVATE_EQUITY: "private-equity",
  CROWDLENDING: "crowdlending",
  TANGIBLE: "tangibles",
};

/**
 * Ligne consolidée.
 *
 * `investedEur` n'a pas la même définition d'une famille à l'autre, et c'est
 * assumé : prix de revient pour un métal ou un objet, capital appelé pour du
 * private equity, capital prêté pour un prêt. Ce sont les trois façons de
 * répondre à « combien ai-je engagé », et aucune n'est convertible dans une
 * autre. La colonne le dit, elle ne prétend pas à davantage.
 */
export type AlternativeInvestment = {
  id: string;
  category: AlternativeCategory;
  /** Nom principal — société, projet, dénomination du lot, objet. */
  name: string;
  /** Précision affichée sous le nom : millésime, type, format… */
  subtitle: string | null;
  /** Plateforme ou contrepartie, quand la famille en porte une. */
  platform: string | null;
  valueEur: number;
  investedEur: number;
  /** `value − invested`, `null` quand la comparaison n'a pas de sens. */
  pnlEur: number | null;
  pnlPct: number | null;
  /** Libellé court d'état — « En cours », « Détenu », « En retard »… */
  status: string;
  /** `true` pour un état qui appelle l'attention (retard, défaut). */
  statusIsAlert: boolean;
  currency: string;
};

const num = (v: string | number | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const pnlOf = (valueEur: number, investedEur: number) => ({
  pnlEur: valueEur - investedEur,
  pnlPct: investedEur > 0 ? ((valueEur - investedEur) / investedEur) * 100 : null,
});

/* ── Adaptateurs par famille ─────────────────────────────────────────── */

type MetalRow = {
  id: string;
  denomination: string;
  metal: string;
  format: string;
  quantity: string;
  purchasePriceUnit: string;
  acquisitionFees: string;
  currentValue: string;
  currency: string;
  storageLocation?: string | null;
};

export function metalToInvestment(m: MetalRow): AlternativeInvestment {
  // Prix de revient du lot : quantité × PRU, frais d'acquisition compris.
  const investedEur =
    num(m.quantity) * num(m.purchasePriceUnit) + num(m.acquisitionFees);
  const valueEur = num(m.currentValue);
  return {
    id: m.id,
    category: "METAL",
    name: m.denomination,
    subtitle: `${m.metal} · ${m.format}`,
    platform: m.storageLocation ?? null,
    valueEur,
    investedEur,
    ...pnlOf(valueEur, investedEur),
    status: "Détenu",
    statusIsAlert: false,
    currency: m.currency || "EUR",
  };
}

type PeRow = {
  id: string;
  companyName: string;
  peType: string;
  sector?: string | null;
  vehicleName?: string | null;
  currentNav: string;
  calledCapital: string;
  investedTotal: string;
  currency: string;
};

export function peToInvestment(p: PeRow): AlternativeInvestment {
  /*
    Capital appelé, avec repli sur `parts × PRU`.

    Le champ n'est pas toujours saisi sur les lignes anciennes ; le service
    applique déjà ce repli pour ses multiples, et diverger ici ferait afficher
    un TVPI et un P&L calculés sur deux bases différentes.
  */
  const called = num(p.calledCapital);
  const investedEur = called > 0 ? called : num(p.investedTotal);
  const valueEur = num(p.currentNav);
  return {
    id: p.id,
    category: "PRIVATE_EQUITY",
    name: p.companyName,
    subtitle: p.vehicleName || p.sector || p.peType,
    platform: p.vehicleName ?? null,
    valueEur,
    investedEur,
    ...pnlOf(valueEur, investedEur),
    status: "En cours",
    statusIsAlert: false,
    currency: p.currency || "EUR",
  };
}

type ClRow = {
  id: string;
  projectName: string;
  platform: string | null;
  capitalInvested: string;
  effectiveRemainingCapital: string;
  interestReceivedToDate: string;
  annualYieldPercent: string;
  status: string;
  currency: string;
};

const CL_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Actif",
  LATE: "En retard",
  REPAID: "Remboursé",
  DEFAULT: "Défaut",
};

export function crowdlendingToInvestment(c: ClRow): AlternativeInvestment {
  /*
    Un prêt ne « vaut » pas comme un actif : ce qu'on détient est le capital
    restant dû. Un prêt soldé vaut zéro sans être une perte — son capital est
    revenu — et un prêt en défaut vaut zéro en l'étant. Le P&L est donc mesuré
    sur les **intérêts perçus**, pas sur l'écart valeur/capital, qui
    afficherait −100 % sur chaque prêt remboursé.
  */
  const valueEur = num(c.effectiveRemainingCapital);
  const investedEur = num(c.capitalInvested);
  const interests = num(c.interestReceivedToDate);
  const isClosed = c.status === "REPAID" || c.status === "DEFAULT";

  const pnlEur = c.status === "DEFAULT" ? interests - investedEur : interests;

  return {
    id: c.id,
    category: "CROWDLENDING",
    name: c.projectName,
    subtitle: `${num(c.annualYieldPercent).toLocaleString("fr-FR", {
      maximumFractionDigits: 2,
    })} %`,
    platform: c.platform,
    valueEur: isClosed ? 0 : valueEur,
    investedEur,
    pnlEur,
    pnlPct: investedEur > 0 ? (pnlEur / investedEur) * 100 : null,
    status: CL_STATUS_LABEL[c.status] ?? c.status,
    statusIsAlert: c.status === "LATE" || c.status === "DEFAULT",
    currency: c.currency || "EUR",
  };
}

type TangibleRow = {
  id: string;
  brandOrArtist: string;
  modelName: string;
  category: string;
  yearOrVintage?: string | null;
  purchasePrice: string;
  acquisitionFees?: string | null;
  estimatedValue: string;
  currency: string;
  storageLocation?: string | null;
};

export function tangibleToInvestment(t: TangibleRow): AlternativeInvestment {
  const investedEur = num(t.purchasePrice) + num(t.acquisitionFees);
  const valueEur = num(t.estimatedValue);
  return {
    id: t.id,
    category: "TANGIBLE",
    name: `${t.brandOrArtist} ${t.modelName}`.trim(),
    subtitle: t.yearOrVintage || t.category,
    platform: t.storageLocation ?? null,
    valueEur,
    investedEur,
    ...pnlOf(valueEur, investedEur),
    status: "Détenu",
    statusIsAlert: false,
    currency: t.currency || "EUR",
  };
}

/* ── Consolidation ───────────────────────────────────────────────────── */

export type AlternativesSources = {
  metals?: MetalRow[];
  privateEquity?: PeRow[];
  crowdlending?: ClRow[];
  tangibles?: TangibleRow[];
};

/**
 * Toutes les positions, du plus gros encours au plus petit.
 *
 * C'est l'ordre dans lequel on lit une exposition : ce qui pèse d'abord. À
 * encours égal, l'ordre alphabétique évite qu'un rafraîchissement réordonne la
 * liste sous le curseur.
 */
export function buildConsolidatedInvestments(
  sources: AlternativesSources
): AlternativeInvestment[] {
  const out: AlternativeInvestment[] = [
    ...(sources.metals ?? []).map(metalToInvestment),
    ...(sources.privateEquity ?? []).map(peToInvestment),
    ...(sources.crowdlending ?? []).map(crowdlendingToInvestment),
    ...(sources.tangibles ?? []).map(tangibleToInvestment),
  ];

  return out.sort((a, b) => {
    if (b.valueEur !== a.valueEur) return b.valueEur - a.valueEur;
    return a.name.localeCompare(b.name, "fr-FR");
  });
}

export type AlternativesTotals = {
  valueEur: number;
  investedEur: number;
  pnlEur: number;
  /** `pnl / invested`, `null` si rien n'a été engagé. */
  pnlPct: number | null;
  count: number;
  /** Répartition par famille, familles vides exclues. */
  byCategory: Array<{
    category: AlternativeCategory;
    label: string;
    valueEur: number;
    sharePct: number | null;
    count: number;
  }>;
};

/**
 * Agrégats de la poche.
 *
 * La performance consolidée est calculée sur les seules positions dont le
 * couple valeur / engagé est comparable — c'est-à-dire toutes, chaque
 * adaptateur ayant déjà ramené sa famille à une définition défendable. Ce
 * qu'on ne fait **pas**, c'est moyenner des taux : un rendement de prêt et une
 * plus-value de lingot ne se moyennent pas, et l'écran n'affiche donc pas de
 * « rendement moyen » de la poche.
 */
export function computeAlternativesTotals(
  investments: AlternativeInvestment[]
): AlternativesTotals {
  let valueEur = 0;
  let investedEur = 0;
  let pnlEur = 0;

  const byCat = new Map<AlternativeCategory, { valueEur: number; count: number }>();

  for (const i of investments) {
    valueEur += i.valueEur;
    investedEur += i.investedEur;
    if (i.pnlEur != null) pnlEur += i.pnlEur;

    const cur = byCat.get(i.category) ?? { valueEur: 0, count: 0 };
    cur.valueEur += i.valueEur;
    cur.count += 1;
    byCat.set(i.category, cur);
  }

  const ORDER: AlternativeCategory[] = [
    "METAL",
    "PRIVATE_EQUITY",
    "CROWDLENDING",
    "TANGIBLE",
  ];

  return {
    valueEur,
    investedEur,
    pnlEur,
    pnlPct: investedEur > 0 ? (pnlEur / investedEur) * 100 : null,
    count: investments.length,
    byCategory: ORDER.filter((c) => (byCat.get(c)?.count ?? 0) > 0).map((c) => {
      const e = byCat.get(c)!;
      return {
        category: c,
        label: CATEGORY_LABEL[c],
        valueEur: e.valueEur,
        sharePct: valueEur > 0 ? (e.valueEur / valueEur) * 100 : null,
        count: e.count,
      };
    }),
  };
}
