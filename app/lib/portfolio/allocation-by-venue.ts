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
 * (`toFuturesView`), **converti en euros** depuis `quoteCurrency`. Jamais le
 * notionnel d'un Asset `accountType=CFD`.
 *
 * Le suffixe `Eur` de `unrealizedPnlEur` est un abus de langage hérité : rien
 * ne convertit dans la chaîne trading, et l'equity sort de `toFuturesView`
 * dans la devise de cotation. `tradingEquityEur` est le seul endroit où la
 * conversion a lieu.
 *
 * ## Mapping D14.0
 *
 * - pea : Asset PEA + envelopeCash PEA
 * - cto : Asset CTO + envelopeCash CTO + or papier (preciousMetal PAPER)
 * - av  : Asset AV + envelopeCash AV — pas lifeInsurance
 * - immo : immobilier au sens de `classifyHolding` — enveloppe, classe **ou**
 *   fiche immobilière rattachée (une SCPI mal étiquetée `ACTIONS` en est)
 * - cash : bankAccount + savingsAccount seulement (hors envelopeCash)
 * - es : employeeSavingsLine (parts × VL)
 * - trading : Trading* ouverts, marge ± P&L, convertis depuis quoteCurrency
 * - crypto : Asset CRYPTO
 * - alt : privateEquity + crowdlending ACTIVE|LATE (REPAID = 0)
 * - tangible : métaux PHYSICAL + tangibleAsset
 *
 * ## Dettes
 *
 * Un passif rattaché à un actif réduit l'endroit où cet actif est détenu —
 * `max(0, valeur − CRD)` — et plus seulement l'immobilier : un prêt lombard
 * adossé à un CTO ne laissait aucune trace avant D29.
 *
 * Ce qu'aucune ligne n'a pu absorber — actif vendu dont le prêt vit encore,
 * CRD supérieur à la valeur — ressort dans `unallocatedLiabilitiesEur`, hors
 * camembert et jamais tu. Un passif **sans** `assetId` (crédit auto) reste
 * hors endroits comme hors de ce compte : il n'a pas de collatéral à réduire.
 *
 * Tranches : or papier → cto ; envelopeCash → enveloppe.
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
import { classifyHolding } from "./patrimony-metrics";
import { getHoldings, loadHoldingClassificationFlags } from "./service";

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
  cash: "Liquidités",
  es: "Épargne salariale",
  trading: "Trading",
  crypto: "Crypto",
  alt: "Alternatifs",
  tangible: "Tangibles",
};

/**
 * Une teinte hex par endroit, identique light / dark.
 *
 * Source : PDF D14 (Laurent) — table Métier complète. Les mêmes hex
 * servent les deux thèmes.
 */
export const VENUE_COLORS: Record<VenueKey, string> = {
  pea: "#C4A35A",
  cto: "#8B7340",
  av: "#5B7C99",
  immo: "#7A5C4A",
  cash: "#8A93A0",
  es: "#6A7D8F",
  trading: "#8B4A4A",
  crypto: "#C47A4A",
  alt: "#8B6B7A",
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
  /**
   * Dette rattachée à un actif que le donut n'a pas pu réduire.
   *
   * Deux cas la remplissent : un `assetId` qui ne correspond à aucune ligne
   * détenue — un bien vendu dont le prêt vit encore, une position soldée — et
   * la part d'un CRD qui dépasse la valeur de sa ligne, que le plancher à zéro
   * absorbait en silence.
   *
   * Elle n'entre pas dans le camembert : celui-ci ventile ce que l'on détient,
   * et une part « passifs » y mélangerait deux natures. Mais elle ne disparaît
   * plus : l'écran qui affiche ce donut doit la mentionner, sans quoi une
   * dette s'évapore entre deux écrans.
   *
   * Une dette **sans** `assetId` — un crédit auto — reste hors de ce compte :
   * elle n'a jamais eu vocation à réduire un endroit de détention, et
   * `PatrimonyMetrics.pockets.passifs` porte déjà le total réel.
   */
  unallocatedLiabilitiesEur: number;
  /**
   * Nombre de positions de trading non converties, faute de taux.
   *
   * Non nul, il signifie que la manche « Trading » est incomplète — un écran
   * qui affiche ce camembert doit le dire. Zéro, tout a été converti.
   */
  unconvertedTradingPositions: number;
};

export type VenueHoldingInput = {
  id: string;
  accountType: string;
  assetClass?: string | null;
  marketValueEur: DecimalInput;
  /** Fiche immobilier direct rattachée — cf. `classifyHolding`. */
  hasRealEstateDetail?: boolean;
  /** Fiche immobilier indirect (SCPI, SCI) rattachée. */
  hasIndirectRealEstateDetail?: boolean;
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
  /**
   * Devise de cotation de l'instrument — `USDT` sur un BTC/USDT-PERP.
   *
   * Marge, prix d'entrée et prix de marché y sont tous libellés : quand
   * `marginUsed` n'est pas déclaré, il est reconstruit comme
   * `notionnel / levier`, donc mécaniquement dans cette devise.
   */
  quoteCurrency: string;
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
  /**
   * Equity des positions ouvertes, **déjà en euros**.
   *
   * Comme toutes les autres manches : la conversion se fait au chargement, pas
   * ici. C'était l'exception du module — marge et P&L entraient bruts, dans
   * leur devise de cotation, et un perpétuel BTC/USDT à 10 000 USDT de marge
   * pesait 10 000 € dans un camembert en euros, faussant au passage le
   * pourcentage de toutes les autres manches puisque le total changeait.
   */
  tradingPositions: readonly { equityEur: DecimalInput }[];
  /**
   * Positions écartées faute de taux pour leur devise de cotation.
   *
   * Comptées au chargement (`tradingEquityEur` rend `null`), reportées telles
   * quelles : la manche est alors incomplète, et le résultat le dit.
   */
  unconvertedTradingPositions?: number;
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

/**
 * Equity d'une position, ramenée en euros — ou `null` si rien ne la fonde.
 *
 * `tradingEquityOf` rend une equity dans la **devise de cotation** : le nom
 * `unrealizedPnlEur` que lui passe `toFuturesView` est un abus de langage
 * hérité, aucune conversion n'a lieu nulle part dans la chaîne trading. Cette
 * fonction est le seul endroit où elle se produit.
 *
 * `null` quand la devise n'a pas de taux — c'est le cas des stablecoins, et
 * `USDT` est précisément la cotation du perpétuel le plus courant. Trois
 * réponses étaient possibles et deux sont refusées : compter la position à
 * parité inventerait un taux qu'aucune source ne fonde (`fx.ts` a justement
 * retiré ce repli), et laisser l'exception remonter ferait tomber le donut
 * entier pour une ligne. Reste la troisième : la position n'est pas comptée,
 * et le résultat dit combien il y en a. UNKNOWN n'est ni ZERO ni ERROR.
 */
export function tradingEquityEur(
  position: VenueTradingPositionInput,
  rates: Record<string, number>
): Decimal | null {
  const equity = tradingEquityOf(position);
  if (equity.isZero()) return equity;
  try {
    return d(
      convertToEurSync(equity, position.quoteCurrency || "EUR", rates)
    );
  } catch {
    return null;
  }
}

/**
 * Immobilier au sens du contrat, pas au sens de l'étiquette.
 *
 * Ce test ne regardait que `accountType` et `assetClass`. `classifyHolding`,
 * lui, retient aussi les lignes portant une fiche immobilière — et son
 * commentaire dit pourquoi ces deux drapeaux existent : « une SCPI mal
 * étiquetée `ACTIONS` » serait rangée ailleurs. Elle l'était ici.
 *
 * Ce que cela coûtait : une SCPI détenue en CTO, étiquetée `ACTIONS`, portant
 * une `IndirectRealEstateDetail` et financée à crédit tombait dans `cto` à sa
 * valeur brute. La branche immobilière n'étant jamais atteinte, le CRD n'était
 * jamais soustrait et le donut se trouvait surévalué du prêt entier — pendant
 * que la bande d'indicateurs, servie par `PatrimonyMetrics`, rangeait la même
 * ligne dans l'immobilier. Deux écrans, deux classements, un seul actif.
 *
 * On délègue au classifieur plutôt que d'en recopier la règle : deux
 * définitions de l'immobilier, c'est déjà une de trop.
 */
function isImmoHolding(h: VenueHoldingInput): boolean {
  return (
    classifyHolding({
      id: h.id,
      accountType: h.accountType,
      assetClass: String(h.assetClass ?? ""),
      marketValueEur: h.marketValueEur,
      hasRealEstateDetail: h.hasRealEstateDetail,
      hasIndirectRealEstateDetail: h.hasIndirectRealEstateDetail,
    }) === "immobilier"
  );
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

  /*
    Une dette réduit l'endroit où dort son collatéral, quel qu'il soit.

    La carte des CRD était construite pour tous les passifs portant un
    `assetId`, mais n'était consultée que dans la branche immobilière. Un prêt
    lombard adossé à un CTO ne réduisait donc rien, et un prêt dont l'actif
    n'est plus détenu — un bien vendu — disparaissait entièrement : le total
    montait, et avec lui les dix pourcentages, sans que rien ne l'indique.

    Ce qui reste non absorbé est compté à part et publié
    (`unallocatedLiabilitiesEur`) : le camembert ne porte pas de part
    « passifs », mais il ne fait plus semblant que cette dette n'existe pas.
  */
  const crdRestant = new Map(crdByAsset);

  /**
   * Retranche le CRD adossé à cette ligne, sans jamais la rendre négative.
   *
   * `immoNet` porte la formule — c'est elle qui est testée — et n'a d'immo que
   * le nom : « max(0, valeur − dette » vaut pour n'importe quel collatéral.
   * Ce qui n'a pas pu être absorbé reste dans `crdRestant`, et sera compté
   * hors camembert.
   */
  const netOfCrd = (assetId: string, mv: Decimal): Decimal => {
    const crd = crdRestant.get(assetId);
    if (!crd || crd.lte(0)) return mv;
    const absorbe = mv.lt(crd) ? mv : crd;
    crdRestant.set(assetId, crd.minus(absorbe));
    return immoNet(mv, crd);
  };

  for (const h of input.holdings) {
    const account = String(h.accountType || "").toUpperCase();
    const mv = d(h.marketValueEur);
    if (!mv.isFinite()) continue;

    /*
      L'endroit est décidé avant de toucher au CRD : une ligne qui n'atterrit
      nulle part — un CFD, une enveloppe inconnue — ne doit pas consommer une
      dette au passage. La dette resterait alors invisible faute d'endroit à
      réduire, ce qui est précisément le silence qu'on retire.
    */
    let key: VenueKey | null = null;
    if (account === "CFD") key = null;
    else if (isImmoHolding(h)) key = "immo";
    else if (account === "PEA") key = "pea";
    else if (account === "CTO") key = "cto";
    else if (account === "AV") key = "av";
    else if (account === "CRYPTO") key = "crypto";
    if (!key) continue;

    venues[key] = venues[key].plus(netOfCrd(h.id, mv));
  }

  let unallocatedLiabilities = zero();
  for (const reste of crdRestant.values()) {
    if (reste.gt(0)) unallocatedLiabilities = unallocatedLiabilities.plus(reste);
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
    venues.trading = venues.trading.plus(d(p.equityEur));
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
    unallocatedLiabilitiesEur: unallocatedLiabilities.toNumber(),
    unconvertedTradingPositions: input.unconvertedTradingPositions ?? 0,
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
    classificationFlags,
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
    /*
      Les fiches immobilières décident du classement autant que l'étiquette de
      la ligne — c'est le même chargement que `getPatrimonyMetrics` utilise,
      pas une seconde règle.
    */
    loadHoldingClassificationFlags(userId),
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

  /*
    Trading : la seule manche qui entrait brute, dans sa devise de cotation.
    Elle est convertie ici, comme toutes les autres — et une position dont la
    devise n'a pas de taux (USDT, USDC) est écartée et comptée, jamais comptée
    à parité ni passée en silence.
  */
  let unconvertedTradingPositions = 0;
  const tradingEquities: { equityEur: string }[] = [];
  for (const p of tradingRows) {
    const equity = tradingEquityEur(
      {
        isOpen: p.isOpen,
        direction: (p.direction === "SHORT" ? "SHORT" : "LONG") as FuturesDirection,
        leverage: decStr(p.leverage),
        sizeContracts: decStr(p.sizeContracts),
        entryPrice: decStr(p.entryPrice),
        markPrice: p.markPrice == null ? null : decStr(p.markPrice),
        marginUsed: p.marginUsed == null ? null : decStr(p.marginUsed),
        quoteCurrency: p.quoteCurrency,
      },
      rates
    );
    if (equity == null) {
      unconvertedTradingPositions += 1;
      continue;
    }
    tradingEquities.push({ equityEur: equity.toString() });
  }

  return computeAllocationByVenue({
    holdings: holdings.map((h) => ({
      id: h.assetId,
      accountType: h.accountType,
      assetClass: h.assetClass,
      marketValueEur: h.marketValueEur,
      hasRealEstateDetail: classificationFlags.realEstateAssetIds.has(h.assetId),
      hasIndirectRealEstateDetail:
        classificationFlags.indirectRealEstateAssetIds.has(h.assetId),
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
    tradingPositions: tradingEquities,
    unconvertedTradingPositions,
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
