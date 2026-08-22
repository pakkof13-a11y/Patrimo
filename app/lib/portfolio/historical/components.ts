/**
 * Reconstruction datée de chaque compartiment du patrimoine.
 *
 * Fonctions **pures** : elles reçoivent des lignes déjà chargées et rendent des
 * chronologies (`ValueTimeline`) plus les flux externes correspondants. Aucune
 * ne connaît Prisma — c'est ce qui rend les règles ci-dessous testables une par
 * une, et c'est aussi ce qui permet au moteur de tout charger en une passe.
 *
 * La règle commune à tous les compartiments, et la seule qui compte :
 *
 * > la valeur d'aujourd'hui ne descend jamais dans le passé.
 *
 * Quand une ligne n'a qu'une valeur courante et une date d'acquisition, sa
 * chronologie compte deux points — le coût à l'acquisition, la valeur courante
 * à la date où elle a été constatée (`updatedAt`) — et rien entre les deux
 * qu'un report. C'est moins flatteur qu'une pente régulière, et c'est la seule
 * chose qu'on sache réellement.
 */

import { d, zero, type Decimal } from "../../money/decimal";
import { ValueTimeline, toDayKey } from "./timeline";
import type { DayKey, ExternalFlow, ValuationComponent } from "./types";

const num = (v: { toString(): string } | null | undefined): Decimal =>
  v == null ? zero() : d(v.toString());

const dayOf = (date: Date | null | undefined): DayKey | null =>
  date ? toDayKey(date) : null;

/** Une chronologie et les flux externes qui l'ont alimentée. */
export type SleeveBuild = {
  timelines: ValueTimeline[];
  flows: ExternalFlow[];
  /** Lignes détenues mais impossibles à dater — exclues, jamais inventées. */
  undatable: number;
};

const emptyBuild = (): SleeveBuild => ({ timelines: [], flows: [], undatable: 0 });

// ── Cash explicite ───────────────────────────────────────────────────────────

export type CashAccountRow = {
  id: string;
  balanceEur: Decimal;
  createdAt: Date;
  /** Solde d'affichage courant, intérêts courus inclus le cas échéant. */
  currentEur?: Decimal;
};

export type CashEventRow = {
  accountId: string;
  occurredAt: Date;
  amountEur: Decimal;
  balanceAfterEur: Decimal;
  /** `INTEREST` est un produit, pas un apport : il ne compte pas comme flux. */
  type: string;
};

/**
 * Solde historique d'un compte de cash.
 *
 * Avec des événements, le solde est **exact** : chaque `balanceAfter` est un
 * relevé daté. Sans événement, on ne sait rien de l'histoire du compte — le
 * solde courant est alors rattaché à sa date de création et signalé comme
 * estimé. Reporter le solde d'aujourd'hui sur les mois précédents serait faux
 * dans les deux sens : il gonfle le passé quand le compte s'est rempli, il le
 * rabote quand il s'est vidé.
 */
export function buildCashSleeve(
  accounts: CashAccountRow[],
  events: CashEventRow[]
): SleeveBuild {
  if (accounts.length === 0) return emptyBuild();

  const byAccount = new Map<string, CashEventRow[]>();
  for (const e of events) {
    const list = byAccount.get(e.accountId);
    if (list) list.push(e);
    else byAccount.set(e.accountId, [e]);
  }

  const timelines: ValueTimeline[] = [];
  const flows: ExternalFlow[] = [];

  for (const acc of accounts) {
    const evts = (byAccount.get(acc.id) ?? []).sort(
      (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
    );
    const current = acc.currentEur ?? acc.balanceEur;

    if (evts.length === 0) {
      timelines.push(
        ValueTimeline.from([
          { day: dayOf(acc.createdAt), valueEur: current, observed: false },
        ])
      );
      // Le compte entre dans le périmètre avec son solde : c'est un apport,
      // pas un gain — sans quoi l'ouverture d'un livret ferait une performance.
      flows.push({
        day: dayOf(acc.createdAt) ?? "",
        amountEur: current,
        component: "cash",
      });
      continue;
    }

    timelines.push(
      ValueTimeline.from(
        evts.map((e) => ({
          day: dayOf(e.occurredAt),
          valueEur: e.balanceAfterEur,
          observed: true,
        }))
      )
    );

    for (const e of evts) {
      const day = dayOf(e.occurredAt);
      if (!day) continue;
      // Les intérêts crédités sont de la performance : le compte gagne de la
      // valeur sans qu'un euro extérieur soit entré.
      if (e.type === "INTEREST") continue;
      // L'ouverture pose le solde initial — capital apporté, pas produit.
      flows.push({ day, amountEur: e.amountEur, component: "cash" });
    }
  }

  return { timelines, flows, undatable: 0 };
}

// ── Actifs alternatifs ───────────────────────────────────────────────────────

export type MetalRow = {
  id: string;
  acquiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Prix de revient total du lot, frais d'acquisition inclus. */
  costEur: Decimal;
  currentValueEur: Decimal;
};

/**
 * Métaux précieux.
 *
 * Le cours du métal existe (`MetalSpotPrice`) mais n'est collecté que depuis
 * peu et jour par jour : il ne remonte pas à l'acquisition. On s'en tient donc
 * aux deux points réellement connus — le prix payé à la date d'achat, la valeur
 * constatée à la date de sa dernière saisie. Le jour où l'historique de cours
 * couvrira la période, cette fonction pourra le consommer sans que le reste du
 * moteur bouge.
 */
export function buildMetalsSleeve(rows: MetalRow[]): SleeveBuild {
  return buildCostThenValuationSleeve(
    rows.map((r) => ({
      acquiredAt: r.acquiredAt ?? r.createdAt,
      costEur: r.costEur,
      valuations: [{ day: dayOf(r.updatedAt), valueEur: r.currentValueEur }],
      datedByFallback: r.acquiredAt == null,
    })),
    "alternatives"
  );
}

export type PrivateEquityRow = {
  id: string;
  investmentDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Capital réellement appelé et versé. */
  calledCapitalEur: Decimal;
  currentNavEur: Decimal;
  valuations: Array<{ valuedAt: Date; navEur: Decimal }>;
};

/**
 * Private equity.
 *
 * Quand des NAV datées existent, elles font foi : c'est exactement le constat
 * périodique que le compartiment attend. À défaut, la ligne vaut le capital
 * appelé depuis l'investissement, jusqu'à la NAV courante datée de sa dernière
 * saisie — une participation ne prend pas de valeur tant que personne ne l'a
 * revalorisée.
 */
export function buildPrivateEquitySleeve(rows: PrivateEquityRow[]): SleeveBuild {
  return buildCostThenValuationSleeve(
    rows.map((r) => ({
      acquiredAt: r.investmentDate ?? r.createdAt,
      costEur: r.calledCapitalEur,
      valuations:
        r.valuations.length > 0
          ? r.valuations.map((v) => ({ day: dayOf(v.valuedAt), valueEur: v.navEur }))
          : [{ day: dayOf(r.updatedAt), valueEur: r.currentNavEur }],
      datedByFallback: r.investmentDate == null,
    })),
    "alternatives"
  );
}

export type CrowdlendingRow = {
  id: string;
  startDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  capitalInvestedEur: Decimal;
  remainingCapitalEur: Decimal;
  status: string;
};

/**
 * Crowdlending.
 *
 * Le capital prêté vaut sa valeur nominale tant qu'il court. Ce qui change au
 * fil de l'eau, c'est le **capital restant dû** : les amortissements le font
 * baisser, un défaut l'efface. Les intérêts encaissés ne sont pas ajoutés ici —
 * ils ont rejoint le cash, et les compter deux fois gonflerait le patrimoine.
 */
export function buildCrowdlendingSleeve(rows: CrowdlendingRow[]): SleeveBuild {
  const timelines: ValueTimeline[] = [];
  const flows: ExternalFlow[] = [];
  let undatable = 0;

  for (const r of rows) {
    const start = dayOf(r.startDate ?? r.createdAt);
    if (!start) {
      undatable += 1;
      continue;
    }

    const closed = r.status === "REPAID" || r.status === "DEFAULT";
    // Une ligne close ne vaut plus rien : le capital est revenu (REPAID) ou
    // perdu (DEFAULT). Le distinguer relève du P&L, pas de la valorisation.
    const currentEur = closed
      ? zero()
      : r.remainingCapitalEur.gt(0)
        ? r.remainingCapitalEur
        : r.capitalInvestedEur;

    timelines.push(
      ValueTimeline.from([
        { day: start, valueEur: r.capitalInvestedEur, observed: true },
        { day: dayOf(r.updatedAt), valueEur: currentEur, observed: false },
      ])
    );
    flows.push({ day: start, amountEur: r.capitalInvestedEur, component: "alternatives" });
  }

  return { timelines, flows, undatable };
}

export type TangibleRow = {
  id: string;
  purchaseDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Prix d'achat, frais d'acquisition inclus. */
  costEur: Decimal;
  estimatedValueEur: Decimal;
  valuations: Array<{ valuedAt: Date; valueEur: Decimal }>;
};

/**
 * Actifs tangibles.
 *
 * Reprend la logique du journal de valorisations déjà en place
 * (`tangibles/valuation-history.ts`) : avant acquisition rien, à l'acquisition
 * le prix payé, ensuite la dernière expertise connue. Un objet sans aucune
 * revalorisation reste à son prix d'achat — c'est la seule valeur défendable.
 */
export function buildTangiblesSleeve(rows: TangibleRow[]): SleeveBuild {
  return buildCostThenValuationSleeve(
    rows.map((r) => ({
      acquiredAt: r.purchaseDate ?? r.createdAt,
      costEur: r.costEur,
      valuations:
        r.valuations.length > 0
          ? r.valuations.map((v) => ({ day: dayOf(v.valuedAt), valueEur: v.valueEur }))
          : // Sans expertise datée, la valeur estimée n'est constatée qu'au jour
            // de sa saisie. Elle ne remonte pas jusqu'à l'achat.
            [{ day: dayOf(r.updatedAt), valueEur: r.estimatedValueEur }],
      datedByFallback: r.purchaseDate == null,
    })),
    "alternatives"
  );
}

// ── Épargne salariale ────────────────────────────────────────────────────────

export type EmployeeSavingsRow = {
  id: string;
  contributionDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Montant versé, quand l'utilisateur l'a saisi. */
  contributedEur: Decimal | null;
  /** `parts × VL` courant. */
  currentEur: Decimal;
};

/**
 * Épargne salariale.
 *
 * Aucun historique de VL n'est stocké : la ligne ne connaît que sa VL du jour.
 * On tient donc le versement depuis sa date d'origine, puis la valeur courante
 * à la date de sa dernière mise à jour. Quand le montant versé n'a pas été
 * saisi, la valeur courante sert de repli pour la période d'attente — c'est une
 * estimation, et elle est signalée comme telle.
 */
export function buildEmployeeSavingsSleeve(rows: EmployeeSavingsRow[]): SleeveBuild {
  return buildCostThenValuationSleeve(
    rows.map((r) => ({
      acquiredAt: r.contributionDate ?? r.createdAt,
      costEur: r.contributedEur ?? r.currentEur,
      valuations: [{ day: dayOf(r.updatedAt), valueEur: r.currentEur }],
      datedByFallback: r.contributionDate == null || r.contributedEur == null,
    })),
    "employeeSavings"
  );
}

// ── Passifs ──────────────────────────────────────────────────────────────────

export type LiabilityRow = {
  id: string;
  startDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  initialAmountEur: Decimal;
  remainingAmountEur: Decimal;
  events: Array<{ eventDate: Date; remainingAfterEur: Decimal | null }>;
};

/**
 * Capital restant dû, jour par jour.
 *
 * Les `LiabilityEvent` portent `remainingAfter` : chaque échéance prélevée est
 * un relevé daté du capital dû, donc un point exact. La dette est ancrée à son
 * montant initial au départ du prêt, sans quoi elle apparaîtrait le jour de la
 * première échéance et le patrimoine net ferait une marche.
 *
 * Contracter un emprunt n'appauvrit pas : le capital emprunté arrive au même
 * moment à l'actif. Le rembourser n'enrichit pas davantage — la dette baisse,
 * le cash aussi. Aucun de ces mouvements n'est donc un flux externe au sens du
 * moteur ; ils s'annulent dans le patrimoine net.
 */
export function buildLiabilitiesSleeve(rows: LiabilityRow[]): SleeveBuild {
  const timelines: ValueTimeline[] = [];
  let undatable = 0;

  for (const r of rows) {
    const entries: Array<{ day: DayKey | null; valueEur: Decimal; observed: boolean }> = [];

    const start = dayOf(r.startDate);
    if (start) entries.push({ day: start, valueEur: r.initialAmountEur, observed: true });

    for (const e of r.events) {
      if (e.remainingAfterEur == null) continue;
      entries.push({ day: dayOf(e.eventDate), valueEur: e.remainingAfterEur, observed: true });
    }

    if (entries.length === 0) {
      // Ni date de départ ni échéance datée : le solde courant est le seul fait
      // connu, rattaché au jour de sa dernière écriture.
      const day = dayOf(r.updatedAt) ?? dayOf(r.createdAt);
      if (!day) {
        undatable += 1;
        continue;
      }
      entries.push({ day, valueEur: r.remainingAmountEur, observed: false });
    } else {
      // Le solde courant ferme la chronologie : entre la dernière échéance
      // enregistrée et aujourd'hui, c'est lui qui fait foi.
      entries.push({
        day: dayOf(r.updatedAt),
        valueEur: r.remainingAmountEur,
        observed: false,
      });
    }

    timelines.push(ValueTimeline.from(entries));
  }

  return { timelines, flows: [], undatable };
}

// ── Fabrique commune « coût puis valorisations » ─────────────────────────────

type CostThenValuationInput = {
  acquiredAt: Date | null;
  costEur: Decimal;
  valuations: Array<{ day: DayKey | null; valueEur: Decimal }>;
  /** La date d'acquisition a été devinée : la ligne est estimée, pas exacte. */
  datedByFallback: boolean;
};

/**
 * Le patron partagé par les métaux, le private equity, les tangibles et
 * l'épargne salariale : un coût d'entrée daté, puis des constats de valeur.
 *
 * Une valorisation antérieure à l'acquisition est ignorée — elle décrirait un
 * objet qu'on ne détenait pas encore.
 */
function buildCostThenValuationSleeve(
  inputs: CostThenValuationInput[],
  component: ValuationComponent
): SleeveBuild {
  const timelines: ValueTimeline[] = [];
  const flows: ExternalFlow[] = [];
  let undatable = 0;

  for (const input of inputs) {
    const acquired = dayOf(input.acquiredAt);
    if (!acquired) {
      undatable += 1;
      continue;
    }

    const entries: Array<{ day: DayKey | null; valueEur: Decimal; observed: boolean }> = [
      { day: acquired, valueEur: input.costEur, observed: !input.datedByFallback },
    ];

    for (const v of input.valuations) {
      /*
        Le jour de l'acquisition, c'est le prix payé qui fait foi.

        Une valorisation datée du même jour est presque toujours un repli — la
        valeur courante rattachée à `updatedAt` d'une ligne saisie et estimée
        d'un seul geste. La laisser gagner ferait apparaître l'écart entre le
        prix et l'estimation comme une plus-value réalisée en une journée,
        alors que rien n'a bougé : l'objet vient d'entrer dans le patrimoine.
      */
      if (!v.day || v.day <= acquired) continue;
      entries.push({ day: v.day, valueEur: v.valueEur, observed: true });
    }

    timelines.push(ValueTimeline.from(entries));
    // L'entrée d'un bien dans le patrimoine est un apport à son coût, jamais
    // une performance : sans ce flux, acquérir 2 M€ d'art se lirait +2 M€ de
    // plus-value le jour de l'achat.
    flows.push({ day: acquired, amountEur: input.costEur, component });
  }

  return { timelines, flows, undatable };
}

export { num as toDecimal, dayOf as toDayKeyOrNull };
