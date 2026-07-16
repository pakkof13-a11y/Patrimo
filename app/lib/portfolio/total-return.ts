/**
 * Personal performance series aligned to price history bars.
 *
 * ## Reconstruction dynamique (point par point)
 * Pour chaque barre t, le ledger est rejoué **séquentiellement** :
 *   Quantité(t), CUMP(t), cashInvesti(t) = uniquement les flux ≤ t
 * Jamais de CUMP / qty « position actuelle » injectés rétroactivement.
 *
 * ## Alignement barre ↔ transaction (critique jour 1)
 * Les barres daily Yahoo sont souvent datées à 00:00 UTC alors que l'achat
 * a lieu dans la journée. Comparer `eventT <= barT` repoussait l'achat au
 * lendemain → premier point affiché = gros Δ cours (faux « super rendement »).
 * → Daily / weekly : inclusion par jour / semaine calendaire (Europe/Paris).
 * → Intraday : horodatage strict.
 *
 * ## Deux métriques (ne pas confondre)
 *
 * ### 1) Décomposée / périodique (flux de la barre)
 *   pricePnlEur(t)    = qtyOpen(t) × (close(t) − close(t−1))
 *   realizedPnlEur(t) = Σ ventes du jour (qty × (sell − CUMP))
 *   incomePnlEur(t)   = Σ dividendes/coupons du jour
 *   periodPnlEur(t)   = price + realized + income
 *
 * qtyOpen = quantité détenue en début de barre (avant achats/ventes du jour).
 * Un renfort d'achat ne fausse donc pas le Δ prix de la journée.
 *
 * ### 2) Composée / cumulée (stock de richesse économique)
 *   totalPnlEur(t) = positionValue + dividendsCum + realizedPnlCum − cashInvestedNet
 *   cashInvestedNet = max(0, Σ achats − Σ produits de vente)
 *   Au jour du 1er achat, si close ≈ prix d'achat → totalPnl ≈ 0 ou −frais.
 *
 * ### Latente (snapshot position ouverte, KPI)
 *   latentPnlEur(t) = (close − CUMP(t)) × qty(t)
 */

export type LedgerTxLite = {
  type: string;
  occurredAt: string;
  quantity: string | null;
  unitPrice: string | null;
  fees: string;
  fxRateToEur: string;
  grossAmountEur: string;
  feesEur?: string;
  netCashImpactEur?: string;
  /** WHT EUR snapshot (dividendes) */
  withholdingTaxEur?: string | null;
  withholdingTaxRate?: string | null;
  /** Si présent, date d'impact cash (sinon occurredAt) */
  paymentDate?: string | null;
  exDate?: string | null;
};

export type PriceBar = {
  date: string;
  label: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  price?: number;
};

export type ReturnEventKind = "BUY" | "SELL" | "DIVIDEND";

export type ReturnEvent = {
  kind: ReturnEventKind;
  date: string;
  /** Align to nearest price bar date */
  barDate: string;
  label: string;
  amountEur: number;
  quantity?: number;
  unitPrice?: number;
  /** P&L réalisé de cette vente (si SELL) */
  realizedPnlEur?: number;
};

export type TotalReturnPoint = PriceBar & {
  /** qty held at bar close */
  qty: number;
  /** qty at bar open (before same-day buys/sells) */
  qtyOpen: number;
  /** CUMP unitaire EUR à la clôture */
  cumpEur: number;
  /** cost basis total restant EUR */
  costBasisEur: number;
  /** market value = qty * close */
  positionValue: number;

  /** Plus-value latente snapshot : (close - CUMP) * qty */
  latentPnlEur: number;
  latentPnlPct: number;

  /** P&L réalisé cumulé jusqu'à ce bar */
  realizedPnlCumEur: number;
  cashInvestedNet: number;
  /** @deprecated alias dividendsNetCumEur */
  dividendsCum: number;
  /** Dividendes / revenus bruts cumulés EUR */
  dividendsGrossCumEur: number;
  /** Dividendes / revenus nets cash cumulés EUR (payment) */
  dividendsNetCumEur: number;
  /** WHT cumulé EUR */
  withholdingCumEur: number;
  /**
   * Droit à recevoir (accrual) entre ex-date et payment date.
   * Compense la baisse de cours au détachement dans le total return.
   */
  dividendReceivableEur: number;

  // ── Décomposé (flux de la barre) ──────────────────────────────────────
  /** qtyOpen × Δ close */
  pricePnlEur: number;
  /** réalisé des ventes du jour uniquement */
  periodRealizedEur: number;
  /** revenus nets du jour (cash) */
  incomePnlEur: number;
  /** revenus bruts du jour */
  incomeGrossEur: number;
  /** price + realized + income net */
  periodPnlEur: number;

  // ── Composé (stock) ───────────────────────────────────────────────────
  /**
   * P&L économique cumulé (net de WHT) :
   * positionValue + dividendsNetCum + realizedPnlCum − cashInvestedNet
   */
  totalPnlEur: number;
  totalPnlPct: number;

  /**
   * @deprecated Alias de totalPnlEur (compat graphe). Préférer totalPnlEur / periodPnlEur.
   */
  totalReturnEur: number;
  totalReturnPct: number;
  events: ReturnEvent[];
};

export type PositionPnlSummary = {
  qty: number;
  cumpEur: number;
  costBasisEur: number;
  currentPriceEur: number;
  /** (price - CUMP) * qty */
  latentPnlEur: number;
  latentPnlPct: number;
  /** Σ ventes qty * (sellPrice - CUMP) */
  realizedPnlEur: number;
  hasSells: boolean;
  /** P&L total économique snapshot */
  totalPnlEur: number;
};

function n(v: string | number | null | undefined): number {
  if (v == null || v === "") return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Coût d'acquisition EUR (frais d'achat inclus → impacte le CUMP).
 * grossAmountEur = qty × prix (hors frais) ; feesEur / fees en sus.
 */
function buyCostEur(tx: LedgerTxLite): number {
  const qty = n(tx.quantity);
  const price = n(tx.unitPrice);
  const fx = n(tx.fxRateToEur) || 1;
  const feesFromEur = n(tx.feesEur);
  const feesFromOrig = n(tx.fees) * fx;
  // Préférer feesEur snapshot ; sinon fees × fx
  const fees = feesFromEur > 0 ? feesFromEur : feesFromOrig;
  const gross = n(tx.grossAmountEur);
  if (gross > 0) return gross + fees;
  if (qty > 0 && price > 0) return qty * price * fx + fees;
  return fees;
}

/** Intervalle de barre prix (évite import circulaire market ↔ portfolio). */
export type PerfBarInterval = "15m" | "1h" | "4h" | "1d" | "1wk";

export type BuildTotalReturnOptions = {
  /** Résolution des barres de cours — pilote l'alignement des txs. */
  barInterval?: PerfBarInterval;
};

function parisDayKey(msOrIso: number | string): string {
  const date = typeof msOrIso === "number" ? new Date(msOrIso) : new Date(msOrIso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function parisWeekdayMon0(msOrIso: number | string | Date): number {
  const date =
    msOrIso instanceof Date
      ? msOrIso
      : typeof msOrIso === "number"
        ? new Date(msOrIso)
        : new Date(msOrIso);
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    weekday: "short",
  }).format(date);
  const map: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return map[wd] ?? 0;
}

/** Clé lundi de la semaine (Europe/Paris) — YYYY-MM-DD. */
function parisWeekStartKey(msOrIso: number | string): string {
  const date = typeof msOrIso === "number" ? new Date(msOrIso) : new Date(msOrIso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = Number(parts.find((p) => p.type === "year")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "month")?.value ?? 0);
  const d = Number(parts.find((p) => p.type === "day")?.value ?? 0);
  const mon0 = parisWeekdayMon0(date);
  const utcNoon = Date.UTC(y, m - 1, d, 12, 0, 0);
  const monday = new Date(utcNoon - mon0 * 24 * 60 * 60 * 1000);
  const my = monday.getUTCFullYear();
  const mm = String(monday.getUTCMonth() + 1).padStart(2, "0");
  const md = String(monday.getUTCDate()).padStart(2, "0");
  return `${my}-${mm}-${md}`;
}

/**
 * Un événement ledger s'applique-t-il à cette barre de cours ?
 * - Intraday : horodatage strict (event ≤ barre)
 * - Daily (défaut) : même jour calendaire Paris ou antérieur
 * - Weekly : même semaine ISO-lundi Paris ou antérieure
 */
export function eventAppliesToBar(
  eventT: number,
  barDate: string,
  barInterval?: PerfBarInterval
): boolean {
  if (!Number.isFinite(eventT)) return false;
  const barT = new Date(barDate).getTime();
  if (!Number.isFinite(barT)) return false;

  if (barInterval === "15m" || barInterval === "1h" || barInterval === "4h") {
    return eventT <= barT;
  }

  if (barInterval === "1wk") {
    const ew = parisWeekStartKey(eventT);
    const bw = parisWeekStartKey(barDate);
    if (!ew || !bw) return eventT <= barT;
    return ew <= bw;
  }

  // 1d ou inconnu : jour calendaire Paris (corrige barres Yahoo 00:00 UTC)
  const ed = parisDayKey(eventT);
  const bd = parisDayKey(barDate);
  if (!ed || !bd) return eventT <= barT;
  return ed <= bd;
}

/** Prix unitaire de vente en EUR (hors frais) pour P&L réalisé. */
function sellUnitPriceEur(tx: LedgerTxLite): number {
  const up = n(tx.unitPrice);
  const fx = n(tx.fxRateToEur) || 1;
  if (up > 0) return up * fx;
  const qty = n(tx.quantity);
  const gross = n(tx.grossAmountEur);
  if (qty > 0 && gross > 0) return gross / qty;
  return 0;
}

/** Brut revenu EUR */
function incomeGrossEur(tx: LedgerTxLite): number {
  const gross = n(tx.grossAmountEur);
  if (gross > 0) return gross;
  const net = n(tx.netCashImpactEur);
  const wht = n(tx.withholdingTaxEur);
  const fees = n(tx.feesEur);
  if (net > 0) return net + wht + fees;
  return 0;
}

/** Net cash revenu EUR (après WHT + frais courtier) — vérité performance */
function incomeNetEur(tx: LedgerTxLite): number {
  const net = n(tx.netCashImpactEur);
  if (net > 0) return net;
  const gross = incomeGrossEur(tx);
  const wht = n(tx.withholdingTaxEur);
  const fees = n(tx.feesEur);
  if (gross > 0) return Math.max(0, gross - wht - fees);
  return 0;
}

function incomeWhtEur(tx: LedgerTxLite): number {
  const w = n(tx.withholdingTaxEur);
  if (w > 0) return w;
  const rate = n(tx.withholdingTaxRate);
  const gross = incomeGrossEur(tx);
  if (rate > 0 && gross > 0) return gross * (rate > 1 ? rate / 100 : rate);
  return 0;
}

/** Date d'impact cash pour le revenu (payment date si connue) */
function incomeCashDate(tx: LedgerTxLite): string {
  return tx.paymentDate || tx.occurredAt;
}

const INCOME = new Set(["DIVIDENDE", "COUPON", "LOYER", "INTERET"]);

function alignBarDate(eventIso: string, barDates: string[]): string {
  const t = new Date(eventIso).getTime();
  for (const bd of barDates) {
    if (new Date(bd).getTime() >= t) return bd;
  }
  return barDates[barDates.length - 1] ?? eventIso;
}

/**
 * Replay ledger chronologically for CUMP + realized, without price bars.
 * Used for KPI summary when no history is loaded yet.
 */
export function computePositionPnlSummary(
  transactions: LedgerTxLite[],
  currentPriceEur: number
): PositionPnlSummary {
  let qty = 0;
  let costBasis = 0;
  let realized = 0;
  let cashIn = 0;
  let cashOut = 0;
  let dividendsNet = 0;
  let hasSells = false;

  const txs = [...transactions].sort(
    (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
  );

  for (const tx of txs) {
    if (tx.type === "ACHAT") {
      const q = n(tx.quantity);
      if (q <= 0) continue;
      const cost = buyCostEur(tx);
      costBasis += cost;
      cashIn += cost;
      qty += q;
    } else if (tx.type === "VENTE") {
      const q = n(tx.quantity);
      if (q <= 0 || qty <= 0) continue;
      hasSells = true;
      const sold = Math.min(q, qty);
      const cump = costBasis / qty;
      const sellPx = sellUnitPriceEur(tx);
      realized += sold * (sellPx - cump);
      cashOut += sellPx * sold;
      costBasis = Math.max(0, costBasis - cump * sold);
      qty = Math.max(0, qty - sold);
      if (qty < 1e-12) {
        qty = 0;
        costBasis = 0;
      }
    } else if (tx.type === "SPLIT") {
      const ratio = n(tx.quantity);
      if (ratio > 0 && qty > 0) qty *= ratio;
      // costBasis inchangé
    } else if (INCOME.has(tx.type)) {
      dividendsNet += incomeNetEur(tx);
    }
  }

  const cumpEur = qty > 1e-12 ? costBasis / qty : 0;
  const price = Number.isFinite(currentPriceEur) ? currentPriceEur : 0;
  const positionValue = qty * price;
  const cashInvestedNet = Math.max(0, cashIn - cashOut);
  const latentPnlEur = qty * (price - cumpEur);
  const latentPnlPct = costBasis > 1e-9 ? (latentPnlEur / costBasis) * 100 : 0;
  const totalPnlEur = positionValue + dividendsNet + realized - cashInvestedNet;

  return {
    qty,
    cumpEur,
    costBasisEur: costBasis,
    currentPriceEur: price,
    latentPnlEur,
    latentPnlPct,
    realizedPnlEur: realized,
    hasSells,
    totalPnlEur,
  };
}

/** Timeline d'événements pour trades + accrual/pay dividendes + split */
type TimelineEv =
  | { kind: "BUY" | "SELL" | "SPLIT"; t: number; tx: LedgerTxLite }
  | {
      kind: "DIV_ACCRUE" | "DIV_PAY";
      t: number;
      tx: LedgerTxLite;
      gross: number;
      net: number;
      wht: number;
      /** true si un accrual a déjà compté le net */
      hadAccrue: boolean;
    };

function incomeLabel(type: string): string {
  if (type === "DIVIDENDE") return "Dividende";
  if (type === "COUPON") return "Coupon";
  if (type === "LOYER") return "Loyer";
  return "Intérêt";
}

function buildIncomeTimeline(transactions: LedgerTxLite[]): TimelineEv[] {
  const out: TimelineEv[] = [];
  for (const tx of transactions) {
    if (tx.type === "ACHAT" || tx.type === "VENTE") {
      out.push({
        kind: tx.type === "ACHAT" ? "BUY" : "SELL",
        t: new Date(tx.occurredAt).getTime(),
        tx,
      });
      continue;
    }
    if (tx.type === "SPLIT") {
      out.push({
        kind: "SPLIT",
        t: new Date(tx.occurredAt).getTime(),
        tx,
      });
      continue;
    }
    if (!INCOME.has(tx.type)) continue;
    const gross = incomeGrossEur(tx);
    const net = incomeNetEur(tx);
    const wht = incomeWhtEur(tx);
    const payIso = incomeCashDate(tx);
    const payT = new Date(payIso).getTime();
    const exIso = tx.exDate || null;
    const exT = exIso ? new Date(exIso).getTime() : NaN;
    const useAccrual =
      Number.isFinite(exT) && Number.isFinite(payT) && exT < payT;

    if (useAccrual) {
      out.push({
        kind: "DIV_ACCRUE",
        t: exT,
        tx,
        gross,
        net,
        wht,
        hadAccrue: false,
      });
      out.push({
        kind: "DIV_PAY",
        t: payT,
        tx,
        gross,
        net,
        wht,
        hadAccrue: true,
      });
    } else {
      out.push({
        kind: "DIV_PAY",
        t: payT,
        tx,
        gross,
        net,
        wht,
        hadAccrue: false,
      });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Build personal performance series + event markers from price bars + ledger txs.
 * Chaque point porte periodPnl (flux) et totalPnl (stock cumulé).
 * Dividendes : accrual à l'ex-date (receivable) puis cash à la payment date.
 *
 * Options.barInterval : aligne les txs sur les barres (daily/week vs intraday).
 */
export function buildTotalReturnSeries(
  priceBars: PriceBar[],
  transactions: LedgerTxLite[],
  options?: BuildTotalReturnOptions
): { series: TotalReturnPoint[]; events: ReturnEvent[]; summary: PositionPnlSummary } {
  if (priceBars.length === 0) {
    const summary = computePositionPnlSummary(transactions, 0);
    return { series: [], events: [], summary };
  }

  const barInterval = options?.barInterval;
  const bars = [...priceBars].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const barDates = bars.map((b) => b.date);
  const timeline = buildIncomeTimeline(transactions);

  // État position dynamique — reconstitué barre par barre (jamais de snapshot global)
  let qty = 0;
  let costBasis = 0;
  let cashIn = 0;
  let cashOut = 0;
  let dividendsGross = 0;
  let dividendsNetCash = 0;
  let receivable = 0;
  let withholdingCum = 0;
  let realizedCum = 0;
  let hasSells = false;
  let ti = 0;
  let prevClose: number | null = null;

  const events: ReturnEvent[] = [];
  const series: TotalReturnPoint[] = [];

  for (const bar of bars) {
    const dayEvents: ReturnEvent[] = [];

    // Snapshot d'ouverture (avant les flux du jour) → Δ prix pur
    const qtyOpen = qty;
    const openCloseRef = prevClose;

    let periodRealized = 0;
    let periodIncomeNet = 0;
    let periodIncomeGross = 0;

    while (ti < timeline.length) {
      const ev = timeline[ti]!;
      // Inclusion calendaire (daily/week) ou horodatage strict (intraday)
      if (!eventAppliesToBar(ev.t, bar.date, barInterval)) break;

      if (ev.kind === "BUY") {
        const tx = ev.tx;
        const q = n(tx.quantity);
        const cost = buyCostEur(tx);
        if (q > 0) {
          qty += q;
          costBasis += cost;
          cashIn += cost;
        }
        const re: ReturnEvent = {
          kind: "BUY",
          date: tx.occurredAt,
          barDate: alignBarDate(tx.occurredAt, barDates),
          label: "Achat / renforcement",
          amountEur: cost,
          quantity: q,
          unitPrice: n(tx.unitPrice),
        };
        events.push(re);
        dayEvents.push(re);
      } else if (ev.kind === "SELL") {
        const tx = ev.tx;
        const q = n(tx.quantity);
        const sellPx = sellUnitPriceEur(tx);
        let realizedThis = 0;
        if (q > 0 && qty > 0) {
          hasSells = true;
          const sold = Math.min(q, qty);
          const cump = costBasis / qty;
          realizedThis = sold * (sellPx - cump);
          periodRealized += realizedThis;
          realizedCum += realizedThis;
          cashOut += sellPx * sold;
          costBasis = Math.max(0, costBasis - cump * sold);
          qty = Math.max(0, qty - sold);
          if (qty < 1e-12) {
            qty = 0;
            costBasis = 0;
          }
        }
        const re: ReturnEvent = {
          kind: "SELL",
          date: tx.occurredAt,
          barDate: alignBarDate(tx.occurredAt, barDates),
          label: "Vente",
          amountEur: sellPx * q,
          quantity: q,
          unitPrice: sellPx,
          realizedPnlEur: realizedThis,
        };
        events.push(re);
        dayEvents.push(re);
      } else if (ev.kind === "SPLIT") {
        const ratio = n(ev.tx.quantity);
        if (ratio > 0 && qty > 0) {
          qty *= ratio;
        }
        const re: ReturnEvent = {
          kind: "BUY",
          date: ev.tx.occurredAt,
          barDate: alignBarDate(ev.tx.occurredAt, barDates),
          label: `Split ×${ratio}`,
          amountEur: 0,
          quantity: ratio,
        };
        events.push(re);
        dayEvents.push(re);
      } else if (ev.kind === "DIV_ACCRUE") {
        // Droit à recevoir : compense la baisse de cours au détachement
        receivable += ev.net;
        periodIncomeNet += ev.net;
        periodIncomeGross += ev.gross;
        dividendsGross += ev.gross;
        withholdingCum += ev.wht;
        const re: ReturnEvent = {
          kind: "DIVIDEND",
          date: txIso(ev.t),
          barDate: alignBarDate(txIso(ev.t), barDates),
          label: `${incomeLabel(ev.tx.type)} (détachement)`,
          amountEur: ev.net,
        };
        events.push(re);
        dayEvents.push(re);
      } else if (ev.kind === "DIV_PAY") {
        if (ev.hadAccrue) {
          // Conversion receivable → cash (total return stable)
          receivable = Math.max(0, receivable - ev.net);
          dividendsNetCash += ev.net;
          // pas de periodIncome supplémentaire (déjà compté à l'ex-date)
        } else {
          dividendsGross += ev.gross;
          dividendsNetCash += ev.net;
          withholdingCum += ev.wht;
          periodIncomeNet += ev.net;
          periodIncomeGross += ev.gross;
        }
        const re: ReturnEvent = {
          kind: "DIVIDEND",
          date: txIso(ev.t),
          barDate: alignBarDate(txIso(ev.t), barDates),
          label: ev.hadAccrue
            ? `${incomeLabel(ev.tx.type)} (paiement)`
            : incomeLabel(ev.tx.type),
          amountEur: ev.net,
        };
        events.push(re);
        dayEvents.push(re);
      }
      ti++;
    }

    const close = Number(bar.close ?? bar.price) || 0;
    const cumpEur = qty > 1e-12 ? costBasis / qty : 0;
    const positionValue = qty * close;
    const latentPnlEur = qty * (close - cumpEur);
    const latentPnlPct = costBasis > 1e-9 ? (latentPnlEur / costBasis) * 100 : 0;
    const cashInvestedNet = Math.max(0, cashIn - cashOut);

    const pricePnlEur =
      openCloseRef != null && qtyOpen > 0
        ? qtyOpen * (close - openCloseRef)
        : 0;
    const periodPnlEur = pricePnlEur + periodRealized + periodIncomeNet;

    // total = MTM + cash div + receivable + réalisé − investi
    const totalPnlEur =
      positionValue +
      dividendsNetCash +
      receivable +
      realizedCum -
      cashInvestedNet;
    const totalPnlPct =
      cashInvestedNet > 1e-9 ? (totalPnlEur / cashInvestedNet) * 100 : 0;

    series.push({
      ...bar,
      close,
      price: close,
      qty,
      qtyOpen,
      cumpEur,
      costBasisEur: costBasis,
      positionValue,
      latentPnlEur,
      latentPnlPct,
      realizedPnlCumEur: realizedCum,
      cashInvestedNet,
      dividendsCum: dividendsNetCash,
      dividendsGrossCumEur: dividendsGross,
      dividendsNetCumEur: dividendsNetCash,
      withholdingCumEur: withholdingCum,
      dividendReceivableEur: receivable,
      pricePnlEur,
      periodRealizedEur: periodRealized,
      incomePnlEur: periodIncomeNet,
      incomeGrossEur: periodIncomeGross,
      periodPnlEur,
      totalPnlEur,
      totalPnlPct,
      totalReturnEur: totalPnlEur,
      totalReturnPct: totalPnlPct,
      events: dayEvents,
    });

    prevClose = close;
  }

  // Drain remaining timeline events after last bar (summary only)
  while (ti < timeline.length) {
    const ev = timeline[ti]!;
    if (ev.kind === "BUY") {
      const q = n(ev.tx.quantity);
      if (q > 0) {
        qty += q;
        costBasis += buyCostEur(ev.tx);
        cashIn += buyCostEur(ev.tx);
      }
    } else if (ev.kind === "SELL") {
      const q = n(ev.tx.quantity);
      if (q > 0 && qty > 0) {
        hasSells = true;
        const sold = Math.min(q, qty);
        const cump = costBasis / qty;
        const sellPx = sellUnitPriceEur(ev.tx);
        realizedCum += sold * (sellPx - cump);
        cashOut += sellPx * sold;
        costBasis = Math.max(0, costBasis - cump * sold);
        qty = Math.max(0, qty - sold);
        if (qty < 1e-12) {
          qty = 0;
          costBasis = 0;
        }
      }
    } else if (ev.kind === "SPLIT") {
      const ratio = n(ev.tx.quantity);
      if (ratio > 0 && qty > 0) qty *= ratio;
    } else if (ev.kind === "DIV_ACCRUE") {
      receivable += ev.net;
      dividendsGross += ev.gross;
      withholdingCum += ev.wht;
    } else if (ev.kind === "DIV_PAY") {
      if (ev.hadAccrue) {
        receivable = Math.max(0, receivable - ev.net);
        dividendsNetCash += ev.net;
      } else {
        dividendsGross += ev.gross;
        dividendsNetCash += ev.net;
        withholdingCum += ev.wht;
      }
    }
    ti++;
  }

  const lastClose = series[series.length - 1]?.close ?? 0;
  const cumpEur = qty > 1e-12 ? costBasis / qty : 0;
  const positionValue = qty * lastClose;
  const cashInvestedNet = Math.max(0, cashIn - cashOut);
  const latentPnlEur = qty * (lastClose - cumpEur);
  const latentPnlPct = costBasis > 1e-9 ? (latentPnlEur / costBasis) * 100 : 0;
  const totalPnlEur =
    positionValue +
    dividendsNetCash +
    receivable +
    realizedCum -
    cashInvestedNet;

  const summary: PositionPnlSummary = {
    qty,
    cumpEur,
    costBasisEur: costBasis,
    currentPriceEur: lastClose,
    latentPnlEur,
    latentPnlPct,
    realizedPnlEur: realizedCum,
    hasSells,
    totalPnlEur,
  };

  return { series, events, summary };
}

function txIso(ms: number): string {
  try {
    return new Date(ms).toISOString();
  } catch {
    return new Date().toISOString();
  }
}
