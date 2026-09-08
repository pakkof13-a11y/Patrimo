/**
 * Agrégats de la vue d'ensemble PEA & CTO.
 *
 * Fonctions pures, sans accès réseau ni React : elles prennent la réponse de
 * `/api/securities` et produisent exactement ce que l'écran affiche. Tout le
 * calcul vit ici pour une raison — c'est la partie qu'on doit pouvoir tester,
 * et la seule où une erreur se voit sur un montant plutôt que sur un pixel.
 *
 * Aucune valeur n'est inventée : ce que la source ne fournit pas ressort à
 * `null`, et c'est à l'écran de le dire.
 */

import { securitiesEnvelopeLabel } from "./constants";

export type SecuritiesRoom = {
  ownCapEur: string;
  contributionsEur: string;
  combinedContributionsEur: string;
  remainingEur: string;
  overCapEur: string;
  usedPct: string;
  isOverCap: boolean;
  bindingCap: "OWN" | "COMBINED";
};

export type SecuritiesAccount = {
  id: string;
  envelopeType: string;
  envelopeLabel: string;
  platformId: string;
  platformName: string;
  platformLogoUrl: string | null;
  openDate: string;
  positionCount: number;
  marketValueEur: string;
  costBasisEur: string;
  unrealizedPnlEur: string;
  unrealizedPnlPct: string | null;
  cashEur: string;
  cashAttributed: boolean;
  liquidationValueEur: string;
  contributionsEur: string;
  withdrawalsEur: string;
  gainEur: string;
  maturity: {
    maturityDate: string;
    isMatured: boolean;
    ageYears: number;
    daysToMaturity: number;
  } | null;
  room: SecuritiesRoom | null;
  taxStatusLabel: string | null;
};

export type SecuritiesPosition = {
  assetId: string;
  /** `null` tant que la ligne n'est rattachée à aucun compte déclaré. */
  securitiesAccountId: string | null;
  accountType: string;
  name: string;
  ticker: string | null;
  category: string;
  logoUrl?: string | null;
  quantity?: string;
  /** Prix de revient rejoué depuis le journal — même source pour toute ligne. */
  costBasisEur: string;
  marketValueEur: string;
  unrealizedPnlEur: string;
  unrealizedPnlPct: string | null;
};

/**
 * Espèces d'enveloppe qu'aucun compte ne porte, par enveloppe (`PEA`, `CTO`).
 *
 * Servi tel quel par `/api/securities`. Vide quand tout est imputé.
 */
export type UnattributedCash = Record<string, string>;

export function sumUnattributedCash(cash: UnattributedCash): number {
  return Object.values(cash).reduce((total, v) => total + num(v), 0);
}

export function num(v: string | number | null | undefined): number {
  const n = Number(String(v ?? "0").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/* ── Totaux de la page ────────────────────────────────────────────── */

export type OverviewTotals = {
  /** Titres + liquidités : ce que valent réellement les enveloppes. */
  totalValueEur: number;
  /** Valeur des seules lignes détenues, hors poche de liquidités. */
  positionsValueEur: number;
  cashEur: number;
  costBasisEur: number;
  unrealizedPnlEur: number;
  /** Rapporté au capital engagé, `null` si rien n'a été investi. */
  unrealizedPnlPct: number | null;
  contributionsEur: number;
  withdrawalsEur: number;
  positionCount: number;
  accountCount: number;
  /** Lignes détenues qu'aucun compte déclaré ne porte encore. */
  positionsWithoutAccountCount: number;
  /** Espèces d'enveloppe comptées au total sans appartenir à un compte. */
  unattributedCashEur: number;
  /** Une part du cash n'a pas pu être rattachée à un compte précis. */
  hasUnattributedCash: boolean;
};

/**
 * Totaux de la page — sur **toutes** les lignes titres.
 *
 * Deux périmètres cohabitaient : ces totaux ne sommaient que les positions
 * rattachées à un compte déclaré, quand le camembert et les indicateurs
 * partaient de toutes les lignes. Un PEA de 10 000 € plus 10 000 € de lignes
 * CTO non rattachées donnait une exposition actions de 200 % et deux totaux
 * contradictoires côte à côte. Pire : le capital non rattaché — l'état normal
 * en cours de saisie — n'apparaissait nulle part.
 *
 * Un seul périmètre désormais, le plus large : toutes les lignes titres,
 * rattachées ou non. Les lignes orphelines sont comptées à part
 * (`positionsWithoutAccountCount`) pour que l'écran puisse inviter à les
 * rattacher, jamais retirées du total.
 *
 * Les versements et retraits restent, eux, des faits de compte : une ligne
 * sans compte n'a pas de versement déclaré, et rien ne le lui invente.
 *
 * `unattributedCash` porte les poches d'enveloppe qu'aucun compte ne porte
 * (`fiscal-service.unattributedEnvelopeCash`). Chacune entre **une fois** dans
 * le total : elles sont tenues par enveloppe, pas par compte, et les répartir
 * entre les comptes d'une même enveloppe les compterait autant de fois qu'il
 * y a de comptes.
 */
export function computeTotals(
  accounts: SecuritiesAccount[],
  positions: SecuritiesPosition[] = [],
  unattributedCash: UnattributedCash = {}
): OverviewTotals {
  const unattributedCashEur = sumUnattributedCash(unattributedCash);
  let positionsValueEur = 0;
  let cashEur = unattributedCashEur;
  let costBasisEur = 0;
  let unrealizedPnlEur = 0;
  let contributionsEur = 0;
  let withdrawalsEur = 0;
  let positionsWithoutAccountCount = 0;

  for (const p of positions) {
    positionsValueEur += num(p.marketValueEur);
    costBasisEur += num(p.costBasisEur);
    unrealizedPnlEur += num(p.unrealizedPnlEur);
    if (!p.securitiesAccountId) positionsWithoutAccountCount += 1;
  }

  for (const a of accounts) {
    // Seules les espèces imputées à ce compte : la poche non imputable est
    // déjà entrée une fois, plus haut.
    cashEur += num(a.cashEur);
    contributionsEur += num(a.contributionsEur);
    withdrawalsEur += num(a.withdrawalsEur);
  }

  const positionCount = positions.length;

  return {
    totalValueEur: positionsValueEur + cashEur,
    positionsValueEur,
    cashEur,
    costBasisEur,
    unrealizedPnlEur,
    unrealizedPnlPct:
      costBasisEur > 0 ? (unrealizedPnlEur / costBasisEur) * 100 : null,
    contributionsEur,
    withdrawalsEur,
    positionCount,
    accountCount: accounts.length,
    positionsWithoutAccountCount,
    unattributedCashEur,
    hasUnattributedCash: unattributedCashEur > 0,
  };
}

/* ── Répartition par enveloppe ────────────────────────────────────── */

export type EnvelopeSplit = {
  envelopeType: string;
  label: string;
  valueEur: number;
  /** Part du total des enveloppes titres, `null` si le total est nul. */
  sharePct: number | null;
  accountCount: number;
};

/**
 * Regroupe les comptes par type d'enveloppe. La page en montre deux (PEA,
 * CTO), mais rien ici ne suppose qu'il n'y en a que deux : un PEA-PME ou un
 * second CTO apparaîtrait sans changer une ligne de calcul.
 *
 * Le dénominateur est celui de la page, reçu et non recalculé : toutes les
 * parts affichées à l'écran se rapportent au même ensemble, et ces rangées le
 * couvrent entièrement — lignes rattachées, lignes qui ne le sont pas encore,
 * espèces imputées et poches d'enveloppe. Elles somment donc à 100 %.
 *
 * Elles partaient auparavant des seuls comptes, comme les totaux. Garder cette
 * base pendant que le total s'élargit aurait déplacé le défaut du camembert
 * vers ces rangées, au lieu de le supprimer.
 */
export function splitByEnvelope(
  accounts: SecuritiesAccount[],
  positions: SecuritiesPosition[],
  unattributedCash: UnattributedCash,
  totals: OverviewTotals
): EnvelopeSplit[] {
  const total = totals.totalValueEur;
  const byType = new Map<string, EnvelopeSplit>();

  const envelopeOfAccount = new Map(accounts.map((a) => [a.id, a.envelopeType]));
  const labelOfEnvelope = new Map(
    accounts.map((a) => [a.envelopeType, a.envelopeLabel || a.envelopeType])
  );

  const add = (key: string, value: number, accountCount = 0) => {
    const prev = byType.get(key);
    if (prev) {
      prev.valueEur += value;
      prev.accountCount += accountCount;
      return;
    }
    byType.set(key, {
      envelopeType: key,
      label: labelOfEnvelope.get(key) ?? securitiesEnvelopeLabel(key),
      valueEur: value,
      sharePct: null,
      accountCount,
    });
  };

  /*
    Les lignes d'abord, comptes ou non.

    Une ligne rattachée prend l'enveloppe de son compte — c'est le PEA-PME qui
    l'exige, lui dont les actifs portent `accountType: "PEA"` faute d'une
    valeur propre. Une ligne orpheline prend celle qu'elle porte : sans compte
    déclaré, elle appartient quand même à une enveloppe fiscale, et la ranger
    ailleurs qu'avec ses semblables serait inventer un troisième périmètre
    après en avoir supprimé un.
  */
  for (const p of positions) {
    const key =
      (p.securitiesAccountId
        ? envelopeOfAccount.get(p.securitiesAccountId)
        : null) ?? p.accountType;
    add(key, num(p.marketValueEur));
  }

  // Les comptes ensuite : leurs espèces imputées, et le décompte des cartes.
  for (const a of accounts) {
    add(a.envelopeType, num(a.cashEur), 1);
  }

  // Enfin les poches qu'aucun compte ne porte, rangées dans leur enveloppe.
  for (const [envelope, amount] of Object.entries(unattributedCash)) {
    const value = num(amount);
    if (value !== 0) add(envelope, value);
  }

  const out = [...byType.values()];
  for (const e of out) {
    e.sharePct = total > 0 ? (e.valueEur / total) * 100 : null;
  }
  // PEA d'abord — l'enveloppe fiscale prime sur le compte ordinaire dans la
  // lecture, et l'ordre doit être stable d'un chargement à l'autre.
  return out.sort((a, b) => {
    if (a.envelopeType === b.envelopeType) return 0;
    if (a.envelopeType === "PEA") return -1;
    if (b.envelopeType === "PEA") return 1;
    return a.envelopeType.localeCompare(b.envelopeType, "fr");
  });
}

/* ── Vue d'un compte ──────────────────────────────────────────────── */

export type AccountView = {
  account: SecuritiesAccount;
  /**
   * Titre de la carte : le nom de l'établissement, pas le sigle de
   * l'enveloppe. Deux PEA chez deux courtiers doivent se distinguer au
   * premier coup d'œil, et « PEA » deux fois ne le permet pas.
   */
  title: string;
  subtitle: string;
  valueEur: number;
  costBasisEur: number;
  unrealizedPnlEur: number;
  unrealizedPnlPct: number | null;
  cashEur: number;
  /** Part des liquidités dans la valeur du compte. */
  cashSharePct: number | null;
  /**
   * Ce qu'on peut encore engager. Sur un PEA, le plafond réglementaire borne
   * les versements : le disponible est la marge restante, pas le cash. Sur un
   * compte-titres, rien ne plafonne — le pouvoir d'achat est le cash.
   */
  investableEur: number;
  investableLabel: string;
  /** true si `investableEur` vient du plafond et non de la trésorerie. */
  investableIsCapped: boolean;
  positions: SecuritiesPosition[];
};

export function buildAccountView(
  account: SecuritiesAccount,
  positions: SecuritiesPosition[],
  opts?: { topCount?: number }
): AccountView {
  const topCount = opts?.topCount ?? 5;
  const value = num(account.marketValueEur) + num(account.cashEur);
  const cash = num(account.cashEur);
  const capped = account.room != null;

  const held = positions
    .filter((p) => p.securitiesAccountId === account.id)
    .sort((a, b) => num(b.marketValueEur) - num(a.marketValueEur))
    .slice(0, topCount);

  return {
    account,
    title: account.platformName || account.envelopeLabel,
    subtitle: account.envelopeLabel || account.envelopeType,
    valueEur: value,
    costBasisEur: num(account.costBasisEur),
    unrealizedPnlEur: num(account.unrealizedPnlEur),
    unrealizedPnlPct:
      account.unrealizedPnlPct != null ? num(account.unrealizedPnlPct) : null,
    cashEur: cash,
    cashSharePct: value > 0 ? (cash / value) * 100 : null,
    investableEur: capped
      ? Math.max(0, num(account.room!.remainingEur))
      : cash,
    investableLabel: capped ? "Disponible à investir" : "Pouvoir d'achat",
    investableIsCapped: capped,
    positions: held,
  };
}

/**
 * Poids d'une ligne dans son compte — calculé sur la valeur des titres, pas
 * sur la valeur du compte : additionner les poids doit donner 100 % des
 * positions, et la poche de liquidités n'est pas une position.
 */
export function positionWeightPct(
  position: SecuritiesPosition,
  account: SecuritiesAccount
): number | null {
  const base = num(account.marketValueEur);
  if (base <= 0) return null;
  return (num(position.marketValueEur) / base) * 100;
}

/* ── Répartition par classe d'actifs ──────────────────────────────── */

export type AllocationSlice = {
  key: string;
  label: string;
  valueEur: number;
  sharePct: number;
};

/**
 * Répartition des enveloppes titres, liquidités comprises.
 *
 * Le cash apparaît comme une part à part entière : une allocation qui
 * l'ignorerait afficherait « 100 % actions » sur un compte dont la moitié
 * dort en liquidités, ce qui est précisément l'information qu'on cherche.
 */
export function computeAllocation(
  positions: SecuritiesPosition[],
  totals: OverviewTotals,
  labelOf: (category: string) => string
): AllocationSlice[] {
  const byKey = new Map<string, AllocationSlice>();

  for (const p of positions) {
    const key = p.category || "UNCLASSIFIED";
    const prev = byKey.get(key);
    const value = num(p.marketValueEur);
    if (prev) prev.valueEur += value;
    else byKey.set(key, { key, label: labelOf(key), valueEur: value, sharePct: 0 });
  }

  if (totals.cashEur > 0) {
    byKey.set("CASH", {
      key: "CASH",
      label: "Liquidités",
      valueEur: totals.cashEur,
      sharePct: 0,
    });
  }

  const total = [...byKey.values()].reduce((a, s) => a + s.valueEur, 0);
  const out = [...byKey.values()]
    .filter((s) => s.valueEur > 0)
    .map((s) => ({ ...s, sharePct: total > 0 ? (s.valueEur / total) * 100 : 0 }))
    .sort((a, b) => b.valueEur - a.valueEur);

  return out;
}

/* ── Indicateurs clés ─────────────────────────────────────────────── */

/** Catégories considérées comme une exposition au risque actions. */
const EQUITY_LIKE = new Set(["EQUITY", "ETF", "FUND", "REIT"]);

export type KeyIndicators = {
  /** Part des lignes actions/ETF/fonds dans la valeur totale des enveloppes. */
  equityExposurePct: number | null;
  positionCount: number;
  /** 100 / nombre de lignes — repère de concentration, pas une moyenne pondérée. */
  averageWeightPct: number | null;
  /** Poids de la plus grosse ligne : ce que « moyenne » ne dit jamais. */
  largestPositionPct: number | null;
  largestPositionName: string | null;
};

export function computeKeyIndicators(
  positions: SecuritiesPosition[],
  totals: OverviewTotals
): KeyIndicators {
  let equity = 0;
  let largest = 0;
  let largestName: string | null = null;

  for (const p of positions) {
    const v = num(p.marketValueEur);
    if (EQUITY_LIKE.has((p.category || "").toUpperCase())) equity += v;
    if (v > largest) {
      largest = v;
      largestName = p.name;
    }
  }

  const total = totals.totalValueEur;
  const count = positions.length;

  return {
    equityExposurePct: total > 0 ? (equity / total) * 100 : null,
    positionCount: count,
    averageWeightPct: count > 0 ? 100 / count : null,
    largestPositionPct: total > 0 && largest > 0 ? (largest / total) * 100 : null,
    largestPositionName: largestName,
  };
}
