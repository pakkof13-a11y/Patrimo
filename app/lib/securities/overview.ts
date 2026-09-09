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

import {
  securitiesEnvelopeLabel,
  type CashAttribution,
} from "./constants";

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
  /** Voir `CashAttribution` : hors `ATTRIBUTED`, `cashEur` vaut zéro et ce
      zéro n'est pas un relevé. */
  cashAttribution: CashAttribution;
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

/**
 * Vrai dès qu'**une** poche non imputée porte un montant, quel qu'en soit le
 * signe.
 *
 * Se décide poche par poche, jamais sur `sumUnattributedCash` : une poche CTO
 * de +5 000 € et une poche PEA de −5 000 € somment à zéro alors que deux
 * montants réels sont entrés dans le total sans appartenir à aucun compte.
 * Un bandeau muet sur ce cas laisserait 10 000 € circuler sans mention — le
 * silence exact que ce bandeau existe pour rompre.
 */
export function hasAnyUnattributedCash(cash: UnattributedCash): boolean {
  return Object.values(cash).some((v) => num(v) !== 0);
}

export function num(v: string | number | null | undefined): number {
  const n = Number(String(v ?? "0").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Ce qu'une carte de compte affiche à la place d'un montant d'espèces, et
 * l'infobulle qui le justifie. `null` sous `ATTRIBUTED` : il y a un montant,
 * la carte l'affiche.
 *
 * Ici plutôt que dans chacun des deux écrans qui en ont besoin : ils
 * disaient déjà la même chose de deux façons, et l'un d'eux accusait le
 * PEA-PME d'un défaut de ventilation qui n'existe pas.
 */
export function cashAttributionNotice(
  attribution: CashAttribution
): { short: string; title: string } | null {
  if (attribution === "ENVELOPE_LEVEL") {
    return {
      short: "tenues par l'enveloppe",
      title:
        "La poche d'espèces est tenue par enveloppe et non par compte, et " +
        "plusieurs comptes de ce type se la partagent : on ne sait pas lequel " +
        "la détient. Son montant est donné sous la vue d'ensemble.",
    };
  }
  if (attribution === "NOT_TRACKED") {
    return {
      short: "non suivies",
      title:
        "Aucune poche d'espèces n'est tenue pour cette enveloppe. Le montant " +
        "est inconnu, pas nul.",
    };
  }
  return null;
}

/* ── Totaux de la page ────────────────────────────────────────────── */

export type OverviewTotals = {
  /** Titres + liquidités : ce que valent réellement les enveloppes. */
  totalValueEur: number;
  /** Valeur des seules lignes détenues, hors poche de liquidités. */
  positionsValueEur: number;
  /**
   * Somme algébrique des espèces : soldes de compte imputés et poches
   * d'enveloppe, créditeurs comme débiteurs. C'est la grandeur qui entre dans
   * `totalValueEur`, et c'est la bonne — un découvert diminue bien ce que vaut
   * le portefeuille.
   */
  cashEur: number;
  /**
   * Les espèces créditrices seules, et les débitrices seules.
   *
   * Un anneau de répartition ne peut pas porter de part négative : sa surface
   * répartit ce qui existe. Il lui faut donc la partie créditrice, pendant que
   * le découvert se dit en toutes lettres sous lui (doctrine D29, la même que
   * les passifs du tableau de bord).
   *
   * Les distinguer répare aussi une soustraction muette : avec une poche PEA
   * de +500 € et un CTO à −1 200 €, la somme algébrique vaut −700 € et la part
   * « Liquidités » disparaissait de l'anneau — 500 € bien réels, effacés par un
   * découvert qui n'a rien à voir avec eux.
   */
  cashPositiveEur: number;
  /** Négatif ou nul. `cashPositiveEur + cashNegativeEur === cashEur`. */
  cashNegativeEur: number;
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
  /**
   * Espèces d'enveloppe comptées au total sans appartenir à un compte.
   *
   * Somme algébrique : deux poches de signes opposés peuvent s'annuler ici
   * sans que la page n'en porte aucune. C'est `hasUnattributedCash` qui dit
   * s'il y en a, pas ce montant.
   */
  unattributedCashEur: number;
  /**
   * Au moins une poche non imputée porte un montant non nul — le bandeau doit
   * s'allumer. Jamais déduit de `unattributedCashEur`, qui peut être nul sur
   * des poches bien réelles.
   */
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
 *
 * Les trois paramètres sont **obligatoires**, et c'est le point : tant que
 * `positions` et `unattributedCash` avaient un défaut, un appel resté à un
 * seul argument — l'ancienne signature, celle des comptes seuls — compilait
 * sans une ligne rouge et rendait un portefeuille vide, prix de revient et
 * P&L à zéro. Le périmètre d'avant, en pire, et en silence. `splitByEnvelope`
 * exige déjà les siens ; les deux fonctions se lisent maintenant pareil.
 */
export function computeTotals(
  accounts: SecuritiesAccount[],
  positions: SecuritiesPosition[],
  unattributedCash: UnattributedCash
): OverviewTotals {
  const unattributedCashEur = sumUnattributedCash(unattributedCash);
  let positionsValueEur = 0;
  let cashEur = unattributedCashEur;
  let cashPositiveEur = 0;
  let cashNegativeEur = 0;
  /** Range un solde d'espèces du bon côté — voir `cashPositiveEur`. */
  const ventile = (montant: number) => {
    if (montant > 0) cashPositiveEur += montant;
    else cashNegativeEur += montant;
  };
  for (const montant of Object.values(unattributedCash)) ventile(num(montant));
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
    ventile(num(a.cashEur));
    contributionsEur += num(a.contributionsEur);
    withdrawalsEur += num(a.withdrawalsEur);
  }

  const positionCount = positions.length;

  return {
    totalValueEur: positionsValueEur + cashEur,
    positionsValueEur,
    cashEur,
    cashPositiveEur,
    cashNegativeEur,
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
    hasUnattributedCash: hasAnyUnattributedCash(unattributedCash),
  };
}

/**
 * L'aperçu n'a-t-il vraiment rien à montrer ?
 *
 * Le garde de la page testait `accounts.length === 0` seul, et masquait alors
 * tout le portefeuille : la page monte l'aperçu en premier et ne déplie la
 * gestion des comptes que sur demande, si bien que des lignes non rattachées —
 * l'état ordinaire en cours de saisie — n'étaient visibles nulle part. Une
 * poche d'enveloppe subissait le même sort, alors que le bandeau du résumé
 * promet de couvrir le cas « aucun compte n'est encore déclaré ».
 *
 * Les trois conditions sont les trois sources de chiffres de la page. Aucune,
 * et il n'y a effectivement rien à afficher.
 */
export function isOverviewEmpty(
  accounts: SecuritiesAccount[],
  positions: SecuritiesPosition[],
  totals: OverviewTotals
): boolean {
  return (
    accounts.length === 0 &&
    positions.length === 0 &&
    !totals.hasUnattributedCash
  );
}

export type UnattributedPocket = {
  envelope: string;
  label: string;
  montantEur: number;
};

/**
 * Les poches non imputées, une par une, nommées et triées.
 *
 * Le bandeau du résumé affichait `totals.unattributedCashEur`, la somme
 * algébrique. Avec une poche CTO de +5 000 € et une poche PEA de −5 000 €, le
 * drapeau s'allume — `hasAnyUnattributedCash` se décide poche par poche — mais
 * la somme vaut zéro : le bandeau annonçait « 0,00 € » tout en affirmant que
 * ce montant comptait dans le total. Il se contredisait, et 10 000 € de soldes
 * bien réels n'étaient nommés nulle part.
 *
 * L'API sert `unattributedCashByEnvelope` par enveloppe précisément pour qu'on
 * puisse les nommer ; les ré-agréger défaisait ce travail.
 *
 * Les poches à zéro sont écartées : elles existent en base sans rien porter,
 * et une ligne « PEA 0,00 € » ne dit rien à personne. C'est le même critère
 * que le drapeau, au signe près — les deux restent donc d'accord.
 */
export function unattributedPockets(
  cash: UnattributedCash,
  labelOf: (envelope: string) => string
): UnattributedPocket[] {
  return Object.entries(cash)
    .map(([envelope, montant]) => ({
      envelope,
      label: labelOf(envelope),
      montantEur: num(montant),
    }))
    .filter((p) => p.montantEur !== 0)
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
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
  /**
   * Titres + liquidités, `null` quand les liquidités sont l'inconnue.
   *
   * Hors `ATTRIBUTED`, `account.cashEur` vaut `"0"` sans que personne n'ait
   * relevé zéro. L'additionner rendait une valeur de compte qui se présentait
   * comme un total et n'en était pas un : sur un CTO dont la poche est tenue
   * par l'enveloppe, la carte affichait les seuls titres sous l'étiquette
   * « Valeur totale ». `null` force l'écran à le dire.
   */
  valueEur: number | null;
  /** Les seuls titres. Toujours connue, elle : c'est ce qui reste à montrer. */
  positionsValueEur: number;
  costBasisEur: number;
  unrealizedPnlEur: number;
  unrealizedPnlPct: number | null;
  /** Liquidités du compte, `null` hors `ATTRIBUTED` — inconnu, pas zéro. */
  cashEur: number | null;
  /** Part des liquidités dans la valeur du compte. */
  cashSharePct: number | null;
  /**
   * Ce qu'on peut encore engager. Sur un PEA, le plafond réglementaire borne
   * les versements : le disponible est la marge restante, pas le cash. Sur un
   * compte-titres, rien ne plafonne — le pouvoir d'achat est le cash, donc
   * `null` quand ce cash est inconnu : annoncer « 0,00 € » de pouvoir d'achat
   * à qui a peut-être 5 000 € en caisse est un contresens.
   */
  investableEur: number | null;
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
  const titres = num(account.marketValueEur);
  /*
    Le pivot de toute la carte : la poche est-elle relevée ?

    C'est l'attribution qui tranche, jamais le montant. Un compte `ATTRIBUTED`
    à poche vide vaut zéro euro, et ce zéro-là est un fait qui s'affiche.
  */
  const cash = account.cashAttribution === "ATTRIBUTED" ? num(account.cashEur) : null;
  const value = cash == null ? null : titres + cash;
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
    positionsValueEur: titres,
    costBasisEur: num(account.costBasisEur),
    unrealizedPnlEur: num(account.unrealizedPnlEur),
    unrealizedPnlPct:
      account.unrealizedPnlPct != null ? num(account.unrealizedPnlPct) : null,
    cashEur: cash,
    cashSharePct:
      cash != null && value != null && value > 0 ? (cash / value) * 100 : null,
    // Le plafond, lui, ne dépend pas de la poche : il reste connu.
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
 *
 * **Ce que l'anneau répartit, et ce qu'il ne répartit pas.** Il répartit le
 * brut long — les titres et les espèces créditrices — et ses parts somment à
 * 100 % de cette base. Un découvert n'y entre pas : une partition n'a pas de
 * part négative, et l'y forcer donnerait un anneau plein étiqueté « 113,6 % ».
 * Il se lit sous l'anneau, chiffré, avec la valeur nette qu'il produit :
 * `allocationNotice` écrit cette phrase, et l'exposition actions, plus loin,
 * nomme son propre dénominateur. Les deux pourcentages ne se contredisent
 * plus, ils répondent à deux questions dont chacune dit laquelle.
 *
 * La part de liquidités part de `cashPositiveEur` et non de `cashEur` : la
 * somme algébrique laissait un découvert d'une enveloppe effacer la trésorerie
 * d'une autre.
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

  if (totals.cashPositiveEur > 0) {
    byKey.set("CASH", {
      key: "CASH",
      label: "Liquidités",
      valueEur: totals.cashPositiveEur,
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

/**
 * La base de l'anneau : ce que ses parts somment.
 *
 * Titres plus espèces créditrices. Différente de `totalValueEur` dès qu'il
 * existe un découvert, et c'est tout le sujet de `allocationNotice`.
 */
export function allocationBaseEur(totals: OverviewTotals): number {
  return totals.positionsValueEur + totals.cashPositiveEur;
}

/**
 * Ce que l'anneau ne peut pas dessiner, dit en toutes lettres.
 *
 * `null` quand il n'y a rien à signaler — sans découvert, la base de l'anneau
 * est la valeur totale et les deux pourcentages de l'écran partagent déjà leur
 * dénominateur.
 *
 * Sinon la phrase porte les trois nombres qui permettent de refaire le calcul
 * à la main : le découvert, la base répartie, la valeur nette. C'est la
 * doctrine des passifs du tableau de bord (D29), appliquée ici : hors de
 * l'aire, sous les parts qu'elle explique.
 */
export function allocationNotice(
  totals: OverviewTotals,
  formatEur: (value: number) => string
): string | null {
  if (totals.cashNegativeEur >= 0) return null;
  return (
    `Découvert de ${formatEur(totals.cashNegativeEur)}, hors de l'anneau : ` +
    `une part ne peut pas être négative. L'anneau répartit ` +
    `${formatEur(allocationBaseEur(totals))} de titres et de liquidités ` +
    `créditrices ; valeur totale, découvert déduit : ` +
    `${formatEur(totals.totalValueEur)}.`
  );
}

/* ── Indicateurs clés ─────────────────────────────────────────────── */

/** Catégories considérées comme une exposition au risque actions. */
const EQUITY_LIKE = new Set(["EQUITY", "ETF", "FUND", "REIT"]);

export type KeyIndicators = {
  /**
   * Part des lignes actions/ETF/fonds dans la valeur totale des enveloppes.
   *
   * Le dénominateur est `totalValueEur`, découvert déduit : c'est une mesure
   * de levier, et elle passe légitimement 100 % quand un découvert finance des
   * titres. L'anneau, lui, répartit le brut long. Deux dénominateurs, deux
   * questions — d'où `equityValueEur` et `exposureBaseEur` ci-dessous, que
   * l'écran affiche pour que le rapprochement se fasse sans deviner.
   */
  equityExposurePct: number | null;
  /** Numérateur de `equityExposurePct`. */
  equityValueEur: number;
  /** Dénominateur de `equityExposurePct` — `totals.totalValueEur`. */
  exposureBaseEur: number;
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
    equityValueEur: equity,
    exposureBaseEur: total,
    positionCount: count,
    averageWeightPct: count > 0 ? 100 / count : null,
    largestPositionPct: total > 0 && largest > 0 ? (largest / total) * 100 : null,
    largestPositionName: largestName,
  };
}
