/**
 * Répartition par endroit — donut « compte / poche de détention » (D14.1).
 *
 * Objet distinct de T-01 `PatrimonyMetrics` (poches d'actif). Ici on ventile
 * par **lieu de détention**, pas par classe. Les écarts sont voulus :
 * crypto ≠ listed ; immo = net (valeur − CRD) ; trading ≠ résidu `autre`.
 *
 * ## Lock av (Chief, définitif)
 *
 * `av` = holdings `accountType=AV` (marketValue) + `envelopeCash` AV.
 * `lifeInsurance` (cashEuro / products / supports) est **hors** total venue.
 * Les ajouter recompterait FE-LINXEA et les UC déjà portés par le journal
 * (`service.ts` : `lifeInsuranceEur = metrics.pockets.av` = déjà les holdings).
 *
 * ## Lock trading
 *
 * `trading` = positions `Trading*` ouvertes : marge ± P&L latent
 * (`toFuturesView`). Jamais le notionnel d'un Asset `accountType=CFD`.
 *
 * ## Mapping D14.0
 *
 * - pea : Asset PEA + envelopeCash PEA
 * - cto : Asset CTO + envelopeCash CTO + or papier (preciousMetal PAPER)
 * - av  : Asset AV + envelopeCash AV — pas lifeInsurance
 * - immo : Asset IMMOBILIER ; valo = max(0, valeur − CRD lié par assetId)
 * - cash : bankAccount + savingsAccount seulement (hors envelopeCash)
 * - es : employeeSavingsLine (parts × VL)
 * - trading : Trading* ouverts, marge ± P&L
 * - crypto : Asset CRYPTO
 * - alt : privateEquity + crowdlending ACTIVE|LATE (REPAID = 0)
 * - tangible : métaux PHYSICAL + tangibleAsset
 *
 * Tranches : or papier → cto ; envelopeCash → enveloppe ; passif sans
 * assetId → hors endroits (crédit auto).
 */

import { prisma } from "../prisma";
import {
  d,
  max,
  zero,
  type Decimal,
  type DecimalInput,
} from "../money/decimal";
import { convertToEurSync, getEurRates } from "../market/fx";
import {
  savingsDisplayBalance,
  type PayoutFrequency,
  type RateType,
} from "../money/savings";
import {
  monthlyRateFromAnnual,
  remainingAmountAt,
} from "../liabilities/amortization";
import {
  toFuturesView,
  type FuturesDirection,
  type FuturesPositionInput,
} from "../crypto/futures";
import { allocatePercents } from "../ui/allocate-percents";
import { getHoldings } from "./service";

export const VENUE_KEYS = [
  "pea",
  "cto",
  "av",
  "immo",
  "cash",
  "es",
  "trading",
  "crypto",
  "alt",
  "tangible",
] as const;

export type VenueKey = (typeof VENUE_KEYS)[number];

/**
 * Texte « ? » du donut — lock produit, à exposer tel quel.
 */
export const ALLOCATION_BY_VENUE_HELP =
  "Répartition par compte et poche de détention. L’immobilier est en valeur nette (bien moins le capital restant dû) ; chaque échéance (part capital) fait monter cette part. Le patrimoine financier affiché en haut n’inclut pas l’immobilier ni les poches illiquides.";

export const VENUE_LABELS: Record<VenueKey, string> = {
  pea: "PEA",
  cto: "CTO",
  av: "Assurance-vie",
  immo: "Immobilier",
  cash: "Cash",
  es: "Épargne salariale",
  trading: "Trading",
  crypto: "Crypto",
  alt: "Alternatifs",
  tangible: "Tangible",
};

/**
 * Une teinte hex par endroit, identique light / dark.
 *
 * Source : table Métier / PDF D14 — PEA `#C4A35A` et Tangible `#6B8F71`
 * figés. Les huit autres clés n'étaient pas dans le tip : hex figés ici
 * (terre / ardoise, distinguables) pour que le donut ne dépende pas du thème.
 */
export const VENUE_COLORS: Record<VenueKey, string> = {
  pea: "#C4A35A",
  cto: "#7A5C38",
  av: "#4F6F8F",
  immo: "#C46A4A",
  cash: "#3D8B7A",
  es: "#7B5E8A",
  trading: "#B5443A",
  crypto: "#4A6FA5",
  alt: "#A67C4A",
  tangible: "#6B8F71",
};

export type VenueSlice = {
  key: VenueKey;
  label: string;
  amount: number;
  percent: number;
  color: string;
};

export type AllocationByVenue = {
  slices: VenueSlice[];
  /** Σ des parts émises (amount > 0). Dénominateur des %. */
  total: number;
  asOf: string;
};

export type VenueHoldingInput = {
  id: string;
  accountType: string;
  assetClass?: string | null;
  marketValueEur: DecimalInput;
};

export type VenueEnvelopeInput = {
  envelope: string;
  balanceEur: DecimalInput;
};

export type VenueLiabilityInput = {
  assetId: string | null;
  remainingEur: DecimalInput;
};

export type VenueMetalInput = {
  format: string;
  currentValueEur: DecimalInput;
};

export type VenueCrowdlendingInput = {
  status: string;
  capitalInvestedEur: DecimalInput;
};

export type VenueTradingPositionInput = {
  isOpen: boolean;
  direction: FuturesDirection;
  leverage: DecimalInput;
  sizeContracts: DecimalInput;
  entryPrice: DecimalInput;
  markPrice: DecimalInput | null;
  marginUsed: DecimalInput | null;
};

export type AllocationByVenueInput = {
  holdings: readonly VenueHoldingInput[];
  envelopeCash: readonly VenueEnvelopeInput[];
  bankAccounts: readonly { balanceEur: DecimalInput }[];
  savingsAccounts: readonly { balanceEur: DecimalInput }[];
  employeeSavings: readonly { valueEur: DecimalInput }[];
  liabilities: readonly VenueLiabilityInput[];
  metals: readonly VenueMetalInput[];
  privateEquity: readonly { currentNavEur: DecimalInput }[];
  crowdlending: readonly VenueCrowdlendingInput[];
  tangibles: readonly { estimatedValueEur: DecimalInput }[];
  tradingPositions: readonly VenueTradingPositionInput[];
  /**
   * Contrat AV — **ignoré**. Présent pour que les tests prouvent l'identité :
   * l'ajouter ne change pas `av`.
   */
  lifeInsurance?: {
    cashEuroEur?: DecimalInput;
    productsEur?: DecimalInput;
    supportsEur?: DecimalInput;
  };
  asOf?: Date | string;
};

function emptyVenues(): Record<VenueKey, Decimal> {
  return {
    pea: zero(),
    cto: zero(),
    av: zero(),
    immo: zero(),
    cash: zero(),
    es: zero(),
    trading: zero(),
    crypto: zero(),
    alt: zero(),
    tangible: zero(),
  };
}

function asOfIso(asOf?: Date | string): string {
  if (!asOf) return new Date().toISOString();
  if (typeof asOf === "string") return asOf;
  return asOf.toISOString();
}

/** Immobilier net : max(0, valeur − CRD). Jamais une interpolation. */
export function immoNet(valueEur: DecimalInput, crdEur: DecimalInput): Decimal {
  return max(0, d(valueEur).minus(d(crdEur)));
}

/**
 * Part capital d'une échéance à taux fixe — ce qui fait monter `immoNet`.
 *
 * Même décomposition que `buildAmortizationSchedule` : intérêts = CRD × r/12,
 * capital = mensualité − intérêts (plafonné au CRD). Une échéance est un
 * palier, pas une pente entre deux dates.
 */
export function principalPaidOfInstallment(
  remainingEur: DecimalInput,
  monthlyPaymentEur: DecimalInput,
  annualPercent: DecimalInput = 0
): Decimal {
  const bal = d(remainingEur);
  const pay = d(monthlyPaymentEur);
  if (bal.lte(0) || pay.lte(0)) return zero();
  const r = monthlyRateFromAnnual(annualPercent);
  const interest = r > 0 ? bal.times(r) : zero();
  let principal = pay.minus(interest);
  if (principal.lt(0)) return zero();
  if (principal.gt(bal)) principal = bal;
  return principal;
}

/** Equity trading d'une position ouverte : marge ± P&L, jamais le notionnel. */
export function tradingEquityOf(
  position: VenueTradingPositionInput
): Decimal {
  if (!position.isOpen) return zero();
  const view = toFuturesView({
    id: "venue",
    exchange: "",
    pair: "",
    direction: position.direction,
    leverage: d(position.leverage),
    sizeContracts: d(position.sizeContracts),
    entryPrice: d(position.entryPrice),
    markPrice: position.markPrice == null ? null : d(position.markPrice),
    marginUsed: position.marginUsed == null ? null : d(position.marginUsed),
    fundingPaid: null,
    commissionPaid: null,
  } satisfies FuturesPositionInput);
  return view.marginUsed.plus(view.unrealizedPnlEur);
}

function isImmoHolding(h: VenueHoldingInput): boolean {
  const account = String(h.accountType || "").toUpperCase();
  const cls = String(h.assetClass || "").toUpperCase();
  return account === "IMMOBILIER" || cls === "IMMOBILIER";
}

function envelopeOf(rows: readonly VenueEnvelopeInput[], key: string): Decimal {
  let total = zero();
  for (const e of rows) {
    if (String(e.envelope || "").toUpperCase() === key) {
      total = total.plus(d(e.balanceEur));
    }
  }
  return total;
}

/**
 * Ventilation pure. Aucun I/O. `lifeInsurance` n'entre jamais dans `av`.
 */
export function computeAllocationByVenue(
  input: AllocationByVenueInput
): AllocationByVenue {
  const venues = emptyVenues();
  const crdByAsset = new Map<string, Decimal>();

  for (const l of input.liabilities) {
    if (!l.assetId) continue;
    crdByAsset.set(
      l.assetId,
      (crdByAsset.get(l.assetId) ?? zero()).plus(d(l.remainingEur))
    );
  }

  for (const h of input.holdings) {
    const account = String(h.accountType || "").toUpperCase();
    const mv = d(h.marketValueEur);
    if (!mv.isFinite()) continue;

    if (account === "CFD") continue;
    if (isImmoHolding(h)) {
      const crd = crdByAsset.get(h.id) ?? zero();
      venues.immo = venues.immo.plus(immoNet(mv, crd));
      continue;
    }
    if (account === "PEA") {
      venues.pea = venues.pea.plus(mv);
      continue;
    }
    if (account === "CTO") {
      venues.cto = venues.cto.plus(mv);
      continue;
    }
    if (account === "AV") {
      venues.av = venues.av.plus(mv);
      continue;
    }
    if (account === "CRYPTO") {
      venues.crypto = venues.crypto.plus(mv);
    }
  }

  venues.pea = venues.pea.plus(envelopeOf(input.envelopeCash, "PEA"));
  venues.cto = venues.cto.plus(envelopeOf(input.envelopeCash, "CTO"));
  venues.av = venues.av.plus(envelopeOf(input.envelopeCash, "AV"));

  for (const b of input.bankAccounts) {
    venues.cash = venues.cash.plus(d(b.balanceEur));
  }
  for (const s of input.savingsAccounts) {
    venues.cash = venues.cash.plus(d(s.balanceEur));
  }

  for (const e of input.employeeSavings) {
    venues.es = venues.es.plus(d(e.valueEur));
  }

  for (const m of input.metals) {
    const v = d(m.currentValueEur);
    if (String(m.format || "").toUpperCase() === "PAPER") {
      venues.cto = venues.cto.plus(v);
    } else if (String(m.format || "").toUpperCase() === "PHYSICAL") {
      venues.tangible = venues.tangible.plus(v);
    }
  }

  for (const p of input.privateEquity) {
    venues.alt = venues.alt.plus(d(p.currentNavEur));
  }
  for (const c of input.crowdlending) {
    const status = String(c.status || "").toUpperCase();
    if (status === "REPAID") continue;
    if (status === "ACTIVE" || status === "LATE") {
      venues.alt = venues.alt.plus(d(c.capitalInvestedEur));
    }
  }

  for (const t of input.tangibles) {
    venues.tangible = venues.tangible.plus(d(t.estimatedValueEur));
  }

  for (const p of input.tradingPositions) {
    venues.trading = venues.trading.plus(tradingEquityOf(p));
  }

  const positive: { key: VenueKey; amount: Decimal }[] = [];
  for (const key of VENUE_KEYS) {
    const amount = venues[key];
    if (amount.gt(0)) positive.push({ key, amount });
  }

  const weights = positive.map((p) => p.amount.toNumber());
  const percents = allocatePercents(weights, 1);
  let total = zero();
  for (const p of positive) total = total.plus(p.amount);

  const slices: VenueSlice[] = positive.map((p, i) => ({
    key: p.key,
    label: VENUE_LABELS[p.key],
    amount: p.amount.toNumber(),
    percent: percents[i] ?? 0,
    color: VENUE_COLORS[p.key],
  }));

  return {
    slices,
    total: total.toNumber(),
    asOf: asOfIso(input.asOf),
  };
}

function decStr(v: { toString(): string } | null | undefined): string {
  return v?.toString() ?? "0";
}

/**
 * Charge le patrimoine d'un utilisateur et ventile par endroit.
 *
 * `lifeInsurance` n'est pas lu : le total `av` vient des holdings AV et
 * de l'envelopeCash AV uniquement.
 */
export async function allocationByVenue(
  userId: string
): Promise<AllocationByVenue> {
  const rates = await getEurRates();
  const eur = (amount: DecimalInput, currency: string | null | undefined) =>
    d(convertToEurSync(amount, currency || "EUR", rates));

  const [
    holdings,
    envelopes,
    banks,
    savings,
    esLines,
    liabilities,
    metals,
    pe,
    cl,
    tangibles,
    tradingRows,
  ] = await Promise.all([
    getHoldings(userId, "EUR", rates),
    prisma.envelopeCash.findMany({ where: { userId } }),
    prisma.bankAccount.findMany({ where: { userId } }),
    prisma.savingsAccount.findMany({ where: { userId } }),
    prisma.employeeSavingsLine.findMany({ where: { userId } }),
    prisma.liability.findMany({ where: { userId } }),
    prisma.preciousMetalPosition.findMany({ where: { userId } }),
    prisma.privateEquityPosition.findMany({ where: { userId } }),
    prisma.crowdlendingPosition.findMany({ where: { userId } }),
    prisma.tangibleAsset.findMany({ where: { userId } }),
    prisma.tradingPosition.findMany({ where: { userId, isOpen: true } }),
  ]);

  const savingsEur = savings.map((s) => {
    const rateType = (s.rateType === "APR" ? "APR" : "APY") as RateType;
    const freq = (
      ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(s.payoutFrequency || "")
        ? s.payoutFrequency
        : "DAILY"
    ) as PayoutFrequency;
    const clock = s.lastPayoutAt || s.lastAccruedAt || new Date();
    const { displayBalance } = savingsDisplayBalance(
      s.balance.toString(),
      s.apyPercent.toString(),
      clock,
      new Date(),
      rateType,
      freq
    );
    return { balanceEur: eur(displayBalance, s.currency) };
  });

  return computeAllocationByVenue({
    holdings: holdings.map((h) => ({
      id: h.assetId,
      accountType: h.accountType,
      assetClass: h.assetClass,
      marketValueEur: h.marketValueEur,
    })),
    envelopeCash: envelopes.map((e) => ({
      envelope: e.envelope,
      balanceEur: eur(decStr(e.balance), e.currency),
    })),
    bankAccounts: banks.map((b) => ({
      balanceEur: eur(decStr(b.balance), b.currency),
    })),
    savingsAccounts: savingsEur,
    employeeSavings: esLines.map((r) => ({
      valueEur: eur(
        d(r.units.toString()).times(d(r.nav.toString())),
        r.currency
      ),
    })),
    liabilities: liabilities.map((l) => ({
      assetId: l.assetId,
      remainingEur: eur(remainingAmountAt(l), l.currency),
    })),
    metals: metals.map((m) => ({
      format: m.format,
      currentValueEur: eur(decStr(m.currentValue), m.currency),
    })),
    privateEquity: pe.map((p) => ({
      currentNavEur: eur(decStr(p.currentNav), p.currency),
    })),
    crowdlending: cl.map((c) => ({
      status: c.status,
      capitalInvestedEur: eur(decStr(c.capitalInvested), c.currency),
    })),
    tangibles: tangibles.map((t) => ({
      estimatedValueEur: eur(decStr(t.estimatedValue), t.currency),
    })),
    tradingPositions: tradingRows.map((p) => ({
      isOpen: p.isOpen,
      direction: (p.direction === "SHORT" ? "SHORT" : "LONG") as FuturesDirection,
      leverage: decStr(p.leverage),
      sizeContracts: decStr(p.sizeContracts),
      entryPrice: decStr(p.entryPrice),
      markPrice: p.markPrice == null ? null : decStr(p.markPrice),
      marginUsed: p.marginUsed == null ? null : decStr(p.marginUsed),
    })),
  });
}

export function venueColor(key: VenueKey): string {
  return VENUE_COLORS[key];
}

export function venueLabel(key: VenueKey): string {
  return VENUE_LABELS[key];
}

/** Somme des parts émises — identité Σ venues = total donut. */
export function sumVenueAmounts(result: AllocationByVenue): number {
  return result.slices.reduce((s, x) => s + x.amount, 0);
}
