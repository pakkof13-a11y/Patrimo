/**
 * Time-Weighted Return (TWR) — série de performance neutralisant les flux.
 *
 * ## Pourquoi un module séparé ?
 * `buildTotalReturnSeries` (total-return.ts) expose un rendement **money-weighted**
 * (MWR) : `totalPnlPct = totalPnlEur / cashInvestedNet`. Ce ratio divise le gain
 * économique cumulé par le capital net investi → il est mécaniquement sensible à
 * la **taille et au timing** des apports (un renfort juste avant une hausse gonfle
 * le %). Il n'est donc pas comparable à un indice.
 *
 * Le TWR découpe l'horizon à **chaque flux externe** (achat / vente), calcule le
 * rendement de chaque sous-période sur la valeur de marché *avant* le flux, puis
 * **chaîne géométriquement** : `TWR = Π(1 + rᵢ) − 1`. Le résultat est indépendant
 * des apports → il isole la performance de l'actif dans le temps.
 *
 * ## Conventions (GIPS-like, position mono-actif)
 * - Valeur : `V(t) = qty(t) × close(t) + dividendes nets cumulés` (poche cash interne).
 * - Flux externes : ACHAT = `+coût` (entrée), VENTE = `−produit net` (sortie).
 * - Dividendes / coupons / loyers / intérêts = **revenu interne** (poche cash),
 *   *pas* un flux externe → ils augmentent le rendement (logique total return).
 * - SPLIT : ajuste la quantité, aucun flux.
 * - Ancre après flux = `V_avant + flux externe` → les frais de transaction
 *   apparaissent naturellement comme un drag sur la sous-période suivante.
 *
 * TypeScript pur, aucune dépendance externe, **ne mute jamais les entrées**
 * (`priceBars` / `transactions` sont copiés avant tri).
 */

import {
  eventAppliesToBar,
  type LedgerTxLite,
  type PerfBarInterval,
  type PriceBar,
} from "@/app/lib/portfolio/total-return";

/** Une sous-période TWR = intervalle entre deux flux externes (ou début/fin). */
export type TwrSubPeriod = {
  startDate: string;
  endDate: string;
  /** Valeur de marché au début de la sous-période (après le flux d'ouverture). */
  startValue: number;
  /** Valeur de marché à la fin (avant le flux de clôture). */
  endValue: number;
  /** Flux externe net à la clôture (apport +, retrait −). 0 pour la sous-période finale. */
  flow: number;
  /** Rendement de la sous-période : `endValue / startValue − 1`. */
  subReturn: number;
};

/** Point TWR aligné sur une barre de cours. */
export type TwrPoint = {
  date: string;
  label: string;
  close: number;
  /** Facteur de croissance cumulé `Π(1 + rᵢ)`, sous-période ouverte incluse. */
  twrFactor: number;
  /** TWR cumulé (fraction) = `twrFactor − 1`. */
  twrCum: number;
  /** TWR cumulé (%) = `twrCum × 100`. */
  twrPct: number;
  /** Quantité détenue à la clôture de la barre. */
  qty: number;
  /** Valeur de marché (`qty × close` + dividendes nets cumulés). */
  positionValue: number;
};

export type BuildTwrOptions = {
  /** Résolution des barres — pilote l'alignement tx ↔ barre (cf. eventAppliesToBar). */
  barInterval?: PerfBarInterval;
};

function n(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/** Coût d'acquisition EUR (frais inclus) — cash déployé lors d'un ACHAT. */
function buyCostEur(tx: LedgerTxLite): number {
  const qty = n(tx.quantity);
  const price = n(tx.unitPrice);
  const fx = n(tx.fxRateToEur) || 1;
  const feesFromEur = n(tx.feesEur);
  const feesFromOrig = n(tx.fees) * fx;
  const fees = feesFromEur > 0 ? feesFromEur : feesFromOrig;
  const gross = n(tx.grossAmountEur);
  if (gross > 0) return gross + fees;
  if (qty > 0 && price > 0) return qty * price * fx + fees;
  return fees;
}

/** Produit net EUR (frais déduits) — cash récupéré lors d'une VENTE. */
function sellProceedsEur(tx: LedgerTxLite): number {
  const up = n(tx.unitPrice);
  const fx = n(tx.fxRateToEur) || 1;
  const qty = n(tx.quantity);
  const feesFromEur = n(tx.feesEur);
  const feesFromOrig = n(tx.fees) * fx;
  const fees = feesFromEur > 0 ? feesFromEur : feesFromOrig;
  if (up > 0 && qty > 0) return Math.max(0, up * fx * qty - fees);
  const gross = n(tx.grossAmountEur);
  if (gross > 0) return Math.max(0, gross - fees);
  return 0;
}

/** Revenu net EUR (après WHT + frais) — vérité cash du dividende / coupon. */
function incomeNetEur(tx: LedgerTxLite): number {
  const net = n(tx.netCashImpactEur);
  if (net > 0) return net;
  const gross = n(tx.grossAmountEur);
  const wht = n(tx.withholdingTaxEur);
  const fees = n(tx.feesEur);
  if (gross > 0) return Math.max(0, gross - wht - fees);
  return 0;
}

const INCOME_TYPES = new Set(["DIVIDENDE", "COUPON", "LOYER", "INTERET"]);

type TwrEvent =
  | { kind: "BUY" | "SELL" | "SPLIT"; t: number; tx: LedgerTxLite }
  | { kind: "INCOME"; t: number; tx: LedgerTxLite; net: number };

/** Timeline chronologique des flux + revenus (dividende à la payment date). */
function buildEvents(transactions: LedgerTxLite[]): TwrEvent[] {
  const out: TwrEvent[] = [];
  for (const tx of transactions) {
    if (tx.type === "ACHAT") {
      out.push({ kind: "BUY", t: new Date(tx.occurredAt).getTime(), tx });
    } else if (tx.type === "VENTE") {
      out.push({ kind: "SELL", t: new Date(tx.occurredAt).getTime(), tx });
    } else if (tx.type === "SPLIT") {
      out.push({ kind: "SPLIT", t: new Date(tx.occurredAt).getTime(), tx });
    } else if (INCOME_TYPES.has(tx.type)) {
      const iso = tx.paymentDate || tx.occurredAt;
      out.push({
        kind: "INCOME",
        t: new Date(iso).getTime(),
        tx,
        net: incomeNetEur(tx),
      });
    }
  }
  return out
    .filter((e) => Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t);
}

/**
 * Reconstruit la série TWR barre par barre + la liste des sous-périodes.
 *
 * Chaque sous-période est bornée par un flux externe (ACHAT / VENTE). Le TWR
 * cumulé rapporté à chaque barre inclut la sous-période encore ouverte, si bien
 * que la courbe est continue même entre deux flux.
 */
export function buildTwrSeries(
  priceBars: PriceBar[],
  transactions: LedgerTxLite[],
  options?: BuildTwrOptions
): { points: TwrPoint[]; subPeriods: TwrSubPeriod[] } {
  if (priceBars.length === 0) return { points: [], subPeriods: [] };

  const barInterval = options?.barInterval;
  const bars = [...priceBars].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const events = buildEvents(transactions);

  // État reconstitué séquentiellement (jamais de snapshot global rétroactif)
  let qty = 0;
  let divCash = 0;
  let anchor = 0; // valeur au début de la sous-période ouverte
  let anchorDate = bars[0]!.date;
  let anchorSet = false; // capital engagé au moins une fois
  let factorClosed = 1; // Π(1 + rᵢ) des sous-périodes déjà fermées
  let ei = 0;

  const points: TwrPoint[] = [];
  const subPeriods: TwrSubPeriod[] = [];

  for (const bar of bars) {
    const close = Number(bar.close ?? bar.price) || 0;

    while (ei < events.length) {
      const ev = events[ei]!;
      if (!eventAppliesToBar(ev.t, bar.date, barInterval)) break;

      // Revenu interne — augmente la valeur, ne casse pas de sous-période
      if (ev.kind === "INCOME") {
        divCash += ev.net;
        ei++;
        continue;
      }
      // Split — ajuste la quantité, aucun flux
      if (ev.kind === "SPLIT") {
        const ratio = n(ev.tx.quantity);
        if (ratio > 0 && qty > 0) qty *= ratio;
        ei++;
        continue;
      }

      // Flux externe (BUY / SELL) → borne de sous-période
      const valueBefore = qty * close + divCash;
      let flow = 0;
      if (ev.kind === "BUY") {
        const q = n(ev.tx.quantity);
        if (q > 0) {
          qty += q;
          flow = buyCostEur(ev.tx);
        }
      } else {
        const q = n(ev.tx.quantity);
        if (q > 0 && qty > 0) {
          const sold = Math.min(q, qty);
          qty = Math.max(0, qty - sold);
          if (qty < 1e-12) qty = 0;
          flow = -sellProceedsEur(ev.tx);
        }
      }

      // Clôture la sous-période ouverte (si un capital était déjà engagé)
      if (anchorSet && anchor > 1e-9) {
        const subReturn = valueBefore / anchor - 1;
        factorClosed *= 1 + subReturn;
        subPeriods.push({
          startDate: anchorDate,
          endDate: bar.date,
          startValue: anchor,
          endValue: valueBefore,
          flow,
          subReturn,
        });
      }

      // Nouvelle ancre = valeur avant + flux externe (drag frais sur la suite)
      anchor = valueBefore + flow;
      anchorDate = bar.date;
      anchorSet = anchorSet || anchor > 1e-9;
      ei++;
    }

    const positionValue = qty * close + divCash;
    const openReturn =
      anchorSet && anchor > 1e-9 ? positionValue / anchor - 1 : 0;
    const twrFactor = factorClosed * (1 + openReturn);
    const twrCum = twrFactor - 1;

    points.push({
      date: bar.date,
      label: bar.label,
      close,
      twrFactor,
      twrCum,
      twrPct: twrCum * 100,
      qty,
      positionValue,
    });
  }

  // Sous-période finale (encore ouverte) → close au dernier bar pour la liste
  const lastBar = bars[bars.length - 1]!;
  const lastClose = Number(lastBar.close ?? lastBar.price) || 0;
  const lastValue = qty * lastClose + divCash;
  if (anchorSet && anchor > 1e-9 && anchorDate !== lastBar.date) {
    subPeriods.push({
      startDate: anchorDate,
      endDate: lastBar.date,
      startValue: anchor,
      endValue: lastValue,
      flow: 0,
      subReturn: lastValue / anchor - 1,
    });
  }

  return { points, subPeriods };
}
