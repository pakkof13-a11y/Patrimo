/**
 * P&L journalier **par classe d'actif** (vue « Décomposée » périodique).
 *
 * La vue décomposée périodique n'affichait jusqu'ici que des contributeurs
 * comptables (Δ positions / Δ cash / Δ réalisé / Δ revenus). Ce qu'on veut
 * lire, c'est autre chose : « −21 k€ sur les actions, +30 k€ sur les cryptos,
 * +2 k€ de loyers, +1,2 k€ de dividendes » sur la journée. Cela suppose une
 * valorisation **au marché** jour par jour, alors que l'historique du
 * portefeuille est volontairement valorisé au coût
 * (cf. `buildHistoryFromOccurredAt`).
 *
 * Ce module est la brique de calcul, volontairement **pure** : il ne connaît
 * ni Prisma, ni le réseau, ni les fournisseurs de cours. On lui donne, pour
 * chaque jour civil, les quantités détenues par actif, les flux du jour et les
 * cours de clôture ; il rend la valeur de marché et le P&L par classe.
 *
 * ## Définition retenue du P&L journalier
 *
 * Une simple différence de valeur de marché serait fausse : acheter 10 k€
 * d'actions un mardi ferait apparaître +10 k€ de « gain ». Le P&L d'une
 * journée est donc la variation de valeur **nette des flux** :
 *
 * ```
 * P&L(jour, classe) = Σ actifs [ q_j × close_j − q_{j-1} × close_{j-1} − flux_j ]
 *                     + revenus_j
 * ```
 *
 * où `flux_j` est le montant net investi dans la journée (achats − ventes,
 * frais inclus, tels que le ledger les comptabilise). Cette formulation couvre
 * les achats, les ventes partielles ou totales, et reste exacte quand une
 * position est ouverte et refermée dans la même journée.
 *
 * Les revenus encaissés (dividendes, coupons, loyers) sont ajoutés à la classe
 * de l'actif payeur : ils sont bien du résultat du jour, mais ils sortent de la
 * valeur de marché pour rejoindre le cash — sans ce terme, un détachement de
 * dividende apparaîtrait comme une perte sèche.
 *
 * ## Jours sans cours
 *
 * Un cours manquant (week-end, jour férié, actif non coté, fournisseur muet)
 * n'est **pas** traité comme un prix nul : le dernier cours connu est reporté.
 * Un actif dont on n'a encore jamais vu le cours est reporté comme
 * « incomplet » plutôt que valorisé à zéro — l'appelant peut alors afficher un
 * badge d'estimation au lieu d'un faux −100 %.
 */

import { d, zero, type Decimal } from "../money/decimal";

/** Jour civil Europe/Paris, format `YYYY-MM-DD`. */
export type DayKey = string;

/** Cours de clôture en EUR, par actif puis par jour civil. */
export type DailyCloseIndex = Map<string, Map<DayKey, number>>;

/** État d'une journée, extrait du rejeu du ledger. */
export type ClassDailyInput = {
  day: DayKey;
  /** Quantité détenue en fin de journée, par actif (actifs soldés omis). */
  quantityByAsset: Record<string, number>;
  /**
   * Montant net investi dans la journée, par actif, en EUR :
   * positif à l'achat, négatif à la vente. Frais inclus.
   */
  netFlowByAsset?: Record<string, number>;
  /** Revenus cash encaissés dans la journée, par actif, en EUR. */
  incomeByAsset?: Record<string, number>;
};

export type ClassDailyPnl = {
  day: DayKey;
  /** Valeur de marché en fin de journée, par classe d'actif. */
  valueByClass: Record<string, number>;
  /** P&L de la journée, par classe d'actif (flux neutralisés). */
  pnlByClass: Record<string, number>;
  /**
   * Classes dont au moins un actif détenu n'a aucun cours connu à cette date.
   * Le P&L reste calculé sur les actifs valorisables ; l'UI doit signaler
   * l'estimation plutôt que présenter le chiffre comme exact.
   */
  incompleteClasses: string[];
};

function addTo(acc: Map<string, Decimal>, key: string, value: Decimal): void {
  acc.set(key, (acc.get(key) ?? zero()).plus(value));
}

function toRecord(acc: Map<string, Decimal>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of acc) out[k] = v.toNumber();
  return out;
}

/**
 * Cours de clôture d'un actif à une date, avec report du dernier cours connu.
 * `null` si aucun cours n'a jamais été observé jusqu'à ce jour inclus.
 *
 * Le report se fait strictement vers le passé : on ne devine jamais le cours
 * d'un jour à partir d'une clôture postérieure, ce qui reviendrait à injecter
 * de l'information future dans une série historique.
 */
export function closeAtOrBefore(
  closes: Map<DayKey, number> | undefined,
  day: DayKey
): number | null {
  if (!closes || closes.size === 0) return null;
  const exact = closes.get(day);
  if (exact != null && Number.isFinite(exact)) return exact;
  let best: number | null = null;
  let bestDay = "";
  for (const [k, v] of closes) {
    if (k <= day && k > bestDay && Number.isFinite(v)) {
      best = v;
      bestDay = k;
    }
  }
  return best;
}

/**
 * Construit la série journalière de valeur de marché et de P&L par classe.
 *
 * `days` doit être trié par ordre chronologique croissant ; le premier jour
 * n'a pas de veille et sort donc avec un P&L nul (aucune variation mesurable),
 * ce qui est le comportement attendu du premier point d'un graphique périodique.
 */
export function buildClassDailyPnl(
  days: ClassDailyInput[],
  classByAsset: Record<string, string>,
  closes: DailyCloseIndex,
  opts?: { fallbackClass?: string }
): ClassDailyPnl[] {
  const fallbackClass = opts?.fallbackClass ?? "AUTRE";
  const out: ClassDailyPnl[] = [];

  /** Valeur de marché par actif à la clôture de la veille. */
  let prevValueByAsset = new Map<string, Decimal>();

  for (const input of days) {
    const valueByClass = new Map<string, Decimal>();
    const pnlByClass = new Map<string, Decimal>();
    const incomplete = new Set<string>();
    const valueByAsset = new Map<string, Decimal>();

    const assetIds = new Set<string>([
      ...Object.keys(input.quantityByAsset),
      ...Object.keys(input.netFlowByAsset ?? {}),
      ...Object.keys(input.incomeByAsset ?? {}),
      ...prevValueByAsset.keys(),
    ]);

    for (const assetId of assetIds) {
      const cls = classByAsset[assetId] ?? fallbackClass;
      const qty = d(input.quantityByAsset[assetId] ?? 0);
      const close = closeAtOrBefore(closes.get(assetId), input.day);

      let value = zero();
      if (qty.isZero()) {
        // Position soldée : plus de valeur de marché, mais le P&L de la
        // journée reste dû (la vente elle-même est neutralisée par le flux).
        value = zero();
      } else if (close == null) {
        incomplete.add(cls);
        // Sans cours, on reporte la dernière valeur connue plutôt que de
        // faire disparaître la position du graphique.
        value = prevValueByAsset.get(assetId) ?? zero();
      } else {
        value = qty.times(d(close));
      }

      valueByAsset.set(assetId, value);
      if (!value.isZero()) addTo(valueByClass, cls, value);

      const prev = prevValueByAsset.get(assetId) ?? zero();
      const flow = d(input.netFlowByAsset?.[assetId] ?? 0);
      const income = d(input.incomeByAsset?.[assetId] ?? 0);
      const pnl = value.minus(prev).minus(flow).plus(income);
      if (!pnl.isZero()) addTo(pnlByClass, cls, pnl);
    }

    out.push({
      day: input.day,
      valueByClass: toRecord(valueByClass),
      // Premier jour : aucune veille, donc aucun P&L mesurable.
      pnlByClass: out.length === 0 ? {} : toRecord(pnlByClass),
      incompleteClasses: [...incomplete].sort(),
    });

    prevValueByAsset = valueByAsset;
  }

  return out;
}

/**
 * Agrège des jours en buckets (semaine, mois…) pour les plages longues.
 * La valeur retenue est celle du **dernier** jour du bucket (c'est un stock),
 * le P&L est la **somme** des jours du bucket (c'est un flux).
 */
export function aggregateClassPnl(
  daily: ClassDailyPnl[],
  bucketOf: (day: DayKey) => string
): ClassDailyPnl[] {
  const order: string[] = [];
  const byBucket = new Map<
    string,
    { last: ClassDailyPnl; pnl: Map<string, Decimal>; incomplete: Set<string> }
  >();

  for (const point of daily) {
    const key = bucketOf(point.day);
    let acc = byBucket.get(key);
    if (!acc) {
      acc = { last: point, pnl: new Map(), incomplete: new Set() };
      byBucket.set(key, acc);
      order.push(key);
    }
    acc.last = point;
    for (const [cls, v] of Object.entries(point.pnlByClass)) {
      addTo(acc.pnl, cls, d(v));
    }
    for (const cls of point.incompleteClasses) acc.incomplete.add(cls);
  }

  return order.map((key) => {
    const acc = byBucket.get(key)!;
    return {
      day: acc.last.day,
      valueByClass: acc.last.valueByClass,
      pnlByClass: toRecord(acc.pnl),
      incompleteClasses: [...acc.incomplete].sort(),
    };
  });
}
