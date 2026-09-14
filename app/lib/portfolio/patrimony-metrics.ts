/**
 * Contrat unique des métriques patrimoniales.
 *
 * Hero, KPI, allocation et totaux du jour lisent **le même objet**. Aucun
 * écran ne recomposée une poche : « Cotés » n'est plus le résidu
 * `brut − cash − alt − ES` (qui réintroduisait immo et AV), et l'immobilier
 * n'est plus un sous-total d'enveloppe qui laisserait une SCPI ailleurs.
 *
 * ## Poches fermées
 *
 * Chaque euro d'actif tombe dans **exactement une** poche. Les sept poches
 * d'actif partitionnent le brut ; les passifs sont à part.
 *
 * 1. **listed** — journal, `assetClass ∈ {ACTIONS, OBLIGATIONS, CRYPTO}`
 *    (clés exactes de `ASSET_CLASSES` — **pas** `OBL`) et
 *    `accountType ∉ {IMMOBILIER, AV}`. Les obligations CTO/PEA (OAT…) y
 *    restent ; un fonds euro d'AV n'y entre pas.
 * 2. **immobilier** — `accountType = IMMOBILIER` ou `assetClass = IMMOBILIER`
 *    ou fiche `RealEstateDetail` / `IndirectRealEstateDetail`. Jamais dans
 *    listed ni dans les alternatifs.
 * 3. **av** — positions `accountType = AV` (UC + fonds euro). `fondsEuro`
 *    est un sous-champ, pour Financier.
 * 4. **cash** — poches saisies (banques, livrets, enveloppes). Pas le cash
 *    fantôme du journal (APPORT).
 * 5. **alternatifs** — tables dédiées uniquement (métaux, PE, crowdlending
 *    ACTIVE|LATE, tangibles). Pas l'immobilier / SCPI déjà dans immobilier.
 * 6. **employeeSavings** — parts × VL. `esLiquid` = statut Disponible.
 * 7. **autre** — résidu des lignes du journal (CFD `AUTRE` : EURUSD, XAUUSD…).
 *    Tend vers 0 hors démo.
 * 8. **passifs** — capital restant dû.
 *
 * ## Identités (tolérance 0,01 €, Decimal.js)
 *
 * - `brut = listed + immobilier + av + cash + alternatifs + employeeSavings + autre`
 * - `net  = brut − passifs`
 * - `immobilierNet = immobilier − liabilitiesRealEstate`
 * - `financier = listed + cashInvestissement + fondsEuro + esLiquid`
 * - **V1** : `cashInvestissement =` tout le cash explicite (banques, livrets,
 *   enveloppes). Un sous-ensemble « cash d'investissement » viendra plus tard.
 * - `financier ⊆ brut`
 *
 * Preuve T-02 (preview démo) :
 * - net = 2 800 416,17 €
 * - listed = 176 706,40 € **dont obligations CTO** — sans OBLIGATIONS, listed
 *   et le résidu `autre` divergent.
 */

import { d, toFixed, zero, type Decimal, type DecimalInput } from "../money/decimal";
import { isEuroFundName } from "../life-insurance/reconcile";
import type { AssetClass } from "../constants";

/** Un centime d'euro : seuil d'identité, pas une marge de calcul. */
export const CENTIME_EUR = d("0.01");

export const PATRIMONY_ASSET_POCKETS = [
  "listed",
  "immobilier",
  "av",
  "cash",
  "alternatifs",
  "employeeSavings",
  "autre",
] as const;

export const PATRIMONY_POCKETS = [
  ...PATRIMONY_ASSET_POCKETS,
  "passifs",
] as const;

export type PatrimonyAssetPocket = (typeof PATRIMONY_ASSET_POCKETS)[number];
export type PatrimonyPocket = (typeof PATRIMONY_POCKETS)[number];

/** Poches du journal : une ligne y tombe, jamais dans cash/alt/ES/passifs. */
export type HoldingPocket = "listed" | "immobilier" | "av" | "autre";

/**
 * Clés `assetClass` du journal qui forment **listed**.
 *
 * Exactement `ACTIONS`, `OBLIGATIONS`, `CRYPTO` — les clés de `ASSET_CLASSES`.
 * **Pas** `OBL` : ce n'est pas une valeur du modèle. Une obligation CTO/PEA
 * porte `OBLIGATIONS` ; `OBL` tomberait dans `autre` et casserait le golden
 * T-02 (listed démo = 176 706,40 €).
 */
export const LISTED_ASSET_CLASS_KEYS = [
  "ACTIONS",
  "OBLIGATIONS",
  "CRYPTO",
] as const satisfies readonly AssetClass[];

export type ListedAssetClass = (typeof LISTED_ASSET_CLASS_KEYS)[number];

export const LISTED_ASSET_CLASSES = new Set<string>(LISTED_ASSET_CLASS_KEYS);
export const LISTED_EXCLUDED_ACCOUNT_TYPES = new Set(["IMMOBILIER", "AV"]);

export type ClassifiableHolding = {
  id: string;
  assetClass: string;
  accountType: string;
  marketValueEur: DecimalInput;
  name?: string | null;
  hasRealEstateDetail?: boolean;
  hasIndirectRealEstateDetail?: boolean;
  /** `FONDS_EURO` | `UC` | `STRUCTURED` — support d'assurance-vie. */
  lifeInsuranceKind?: string | null;
  /** Flag explicite quand le `kind` n'est pas chargé mais la ligne est un fonds euro. */
  isFondsEuro?: boolean;
};

export type PatrimonyPockets = Record<PatrimonyPocket, Decimal>;

export type PatrimonyMetrics = {
  pockets: PatrimonyPockets;
  brut: Decimal;
  net: Decimal;
  financier: Decimal;
  liabilities: Decimal;
  asOf: string;
  fondsEuro: Decimal;
  esLiquid: Decimal;
  cashInvestissement: Decimal;
  /**
   * Part de `passifs` adossée à un bien de la poche `immobilier`.
   *
   * Sous-champ de `passifs`, jamais un passif de plus : `net` continue de
   * retrancher `passifs` en entier. Vaut 0 quand l'appelant ne sait pas
   * l'attribuer — et c'est alors `immobilierNet = immobilier`, ce qui est la
   * lecture prudente : on n'invente pas une dette immobilière.
   */
  liabilitiesRealEstate: Decimal;
  /**
   * Immobilier **net** : valeur des biens moins la dette qui les porte.
   *
   * Le seul chiffre que l'on doit afficher pour la poche immobilière quand un
   * total le présente comme « net ». Il n'est pas clampé à zéro : un bien plus
   * endetté que sa valeur donne un net négatif, qui est un fait. Clamper
   * effacerait la dette de l'écran, au moment précis où elle compte le plus.
   */
  immobilierNet: Decimal;
  /**
   * Poche du journal pour chaque `id` fourni. Sert les tests d'unicité ;
   * n'est pas sérialisé vers l'API.
   */
  holdingPockets: Map<string, HoldingPocket>;
};

export type PatrimonyMetricsJson = {
  pockets: Record<PatrimonyPocket, string>;
  brut: string;
  net: string;
  financier: string;
  liabilities: string;
  asOf: string;
  fondsEuro: string;
  esLiquid: string;
  cashInvestissement: string;
  liabilitiesRealEstate: string;
  immobilierNet: string;
};

export type CashMetricsInput = {
  total: DecimalInput;
  /**
   * V1 : identique au cash explicite. Passer une valeur ne sert que les
   * tests d'un sous-ensemble futur ; omis ⇒ `total`.
   */
  investissement?: DecimalInput;
};

export type EmployeeSavingsMetricsInput = {
  total: DecimalInput;
  /** Parts × VL des lignes au statut Disponible. */
  esLiquid?: DecimalInput;
};

/**
 * Passifs, avec la part qu'un bien immobilier porte.
 *
 * `realEstateBacked` est le capital restant dû des prêts rattachés à un actif
 * de la poche `immobilier` (lien `Liability.assetId`). Omis ⇒ 0 : le contrat ne
 * suppose aucune dette immobilière que l'appelant n'a pas démontrée.
 *
 * Un prêt immobilier sans bien rattaché reste dans `total` et n'entre pas ici.
 * Il pèse donc bien sur `net`, mais pas sur `immobilierNet` — l'attribution se
 * fait sur un lien, jamais sur un libellé.
 */
export type LiabilitiesMetricsInput = {
  total: DecimalInput;
  realEstateBacked?: DecimalInput;
};

export type ComputePatrimonyMetricsInput = {
  holdings: ClassifiableHolding[];
  cash: DecimalInput | CashMetricsInput;
  alternatives: DecimalInput;
  employeeSavings: DecimalInput | EmployeeSavingsMetricsInput;
  liabilities: DecimalInput | LiabilitiesMetricsInput;
  asOf?: Date | string;
};

function isCashInput(v: DecimalInput | CashMetricsInput): v is CashMetricsInput {
  return typeof v === "object" && v != null && "total" in v;
}

function isEsInput(
  v: DecimalInput | EmployeeSavingsMetricsInput
): v is EmployeeSavingsMetricsInput {
  return typeof v === "object" && v != null && "total" in v;
}

function asCash(input: DecimalInput | CashMetricsInput): {
  total: Decimal;
  investissement: Decimal;
} {
  if (isCashInput(input)) {
    const total = d(input.total);
    return {
      total,
      investissement: d(input.investissement ?? total),
    };
  }
  const total = d(input);
  return { total, investissement: total };
}

function asEmployeeSavings(
  input: DecimalInput | EmployeeSavingsMetricsInput
): { total: Decimal; esLiquid: Decimal } {
  if (isEsInput(input)) {
    return { total: d(input.total), esLiquid: d(input.esLiquid ?? 0) };
  }
  return { total: d(input), esLiquid: zero() };
}

function isLiabilitiesInput(
  v: DecimalInput | LiabilitiesMetricsInput
): v is LiabilitiesMetricsInput {
  return typeof v === "object" && v != null && "total" in v;
}

function asLiabilities(input: DecimalInput | LiabilitiesMetricsInput): {
  total: Decimal;
  realEstateBacked: Decimal;
} {
  if (isLiabilitiesInput(input)) {
    return {
      total: d(input.total),
      realEstateBacked: d(input.realEstateBacked ?? 0),
    };
  }
  // Un montant nu reste accepté : passifs connus, attribution non fournie.
  return { total: d(input), realEstateBacked: zero() };
}

function emptyPockets(): PatrimonyPockets {
  return {
    listed: zero(),
    immobilier: zero(),
    av: zero(),
    cash: zero(),
    alternatifs: zero(),
    employeeSavings: zero(),
    autre: zero(),
    passifs: zero(),
  };
}

/**
 * Classe une ligne du journal dans **une** poche d'actif.
 *
 * L'ordre n'est pas cosmétique : l'immobilier gagne toujours, y compris une
 * ligne actions qui porterait une fiche `RealEstateDetail` ; l'AV gagne sur
 * listed, y compris un fonds euro obligataire. Listed ne voit que ce qui reste
 * après ces deux exclusions.
 */
export function classifyHolding(h: ClassifiableHolding): HoldingPocket {
  const accountType = String(h.accountType || "").toUpperCase();
  const assetClass = String(h.assetClass || "").toUpperCase();

  if (
    accountType === "IMMOBILIER" ||
    assetClass === "IMMOBILIER" ||
    h.hasRealEstateDetail ||
    h.hasIndirectRealEstateDetail
  ) {
    return "immobilier";
  }
  if (accountType === "AV") return "av";
  if (
    LISTED_ASSET_CLASSES.has(assetClass) &&
    !LISTED_EXCLUDED_ACCOUNT_TYPES.has(accountType)
  ) {
    return "listed";
  }
  return "autre";
}

/**
 * Classe d'allocation : l'immobilier du contrat, pas l'`assetClass` brute.
 *
 * Sans ce recoupement, une SCPI mal étiquetée `ACTIONS` resterait dans le
 * camembert Actions alors que `pockets.immobilier` l'a déjà rangée.
 */
export function allocationAssetClass(h: ClassifiableHolding): string {
  if (classifyHolding(h) === "immobilier") return "IMMOBILIER";
  return h.assetClass || "AUTRE";
}

export function isFondsEuroHolding(h: ClassifiableHolding): boolean {
  if (classifyHolding(h) !== "av") return false;
  if (h.isFondsEuro) return true;
  if (String(h.lifeInsuranceKind || "").toUpperCase() === "FONDS_EURO") {
    return true;
  }
  return Boolean(h.name && isEuroFundName(h.name));
}

export function classifyHoldings(
  holdings: ClassifiableHolding[]
): Map<string, HoldingPocket> {
  const out = new Map<string, HoldingPocket>();
  for (const h of holdings) {
    out.set(h.id, classifyHolding(h));
  }
  return out;
}

function asOfIso(asOf?: Date | string): string {
  if (!asOf) return new Date().toISOString();
  if (typeof asOf === "string") return asOf;
  return asOf.toISOString();
}

/**
 * Construit le contrat. Pure : aucun I/O, aucun arrondi hors Decimal.
 */
export function computePatrimonyMetrics(
  input: ComputePatrimonyMetricsInput
): PatrimonyMetrics {
  const pockets = emptyPockets();
  const holdingPockets = classifyHoldings(input.holdings);
  let fondsEuro = zero();

  for (const h of input.holdings) {
    const mv = d(h.marketValueEur);
    const pocket = holdingPockets.get(h.id) ?? classifyHolding(h);
    pockets[pocket] = pockets[pocket].plus(mv);
    if (pocket === "av" && isFondsEuroHolding(h)) {
      fondsEuro = fondsEuro.plus(mv);
    }
  }

  const cash = asCash(input.cash);
  const es = asEmployeeSavings(input.employeeSavings);
  const liabilities = asLiabilities(input.liabilities);
  pockets.cash = cash.total;
  pockets.alternatifs = d(input.alternatives);
  pockets.employeeSavings = es.total;
  pockets.passifs = liabilities.total;

  let brut = zero();
  for (const key of PATRIMONY_ASSET_POCKETS) {
    brut = brut.plus(pockets[key]);
  }
  const net = brut.minus(pockets.passifs);
  const financier = pockets.listed
    .plus(cash.investissement)
    .plus(fondsEuro)
    .plus(es.esLiquid);

  return {
    pockets,
    brut,
    net,
    financier,
    liabilities: pockets.passifs,
    asOf: asOfIso(input.asOf),
    fondsEuro,
    esLiquid: es.esLiquid,
    cashInvestissement: cash.investissement,
    liabilitiesRealEstate: liabilities.realEstateBacked,
    immobilierNet: pockets.immobilier.minus(liabilities.realEstateBacked),
    holdingPockets,
  };
}

export function serializePatrimonyMetrics(
  m: PatrimonyMetrics,
  places = 8
): PatrimonyMetricsJson {
  const pockets = {} as Record<PatrimonyPocket, string>;
  for (const key of PATRIMONY_POCKETS) {
    pockets[key] = toFixed(m.pockets[key], places);
  }
  return {
    pockets,
    brut: toFixed(m.brut, places),
    net: toFixed(m.net, places),
    financier: toFixed(m.financier, places),
    liabilities: toFixed(m.liabilities, places),
    asOf: m.asOf,
    fondsEuro: toFixed(m.fondsEuro, places),
    esLiquid: toFixed(m.esLiquid, places),
    cashInvestissement: toFixed(m.cashInvestissement, places),
    liabilitiesRealEstate: toFixed(m.liabilitiesRealEstate, places),
    immobilierNet: toFixed(m.immobilierNet, places),
  };
}

export function sumAssetPockets(pockets: PatrimonyPockets): Decimal {
  return PATRIMONY_ASSET_POCKETS.reduce(
    (acc, key) => acc.plus(pockets[key]),
    zero()
  );
}

export function withinCentime(a: DecimalInput, b: DecimalInput): boolean {
  return d(a).minus(d(b)).abs().lte(CENTIME_EUR);
}

export type PatrimonyIdentityCheck = {
  brutVsPockets: Decimal;
  netVsBrutMinusPassifs: Decimal;
  financierMinusBrut: Decimal;
  immoNetVsImmoMinusDette: Decimal;
  /** `liabilitiesRealEstate − passifs` : doit rester ≤ 0. */
  detteImmoMinusPassifs: Decimal;
  ok: boolean;
};

/**
 * Vérifie les identités du contrat, à un centime près.
 *
 * `financierMinusBrut` doit rester ≤ 0,01 : Financier est un sous-ensemble
 * du brut, jamais un total parallèle. `detteImmoMinusPassifs` porte la même
 * exigence sur la dette attribuée : la part immobilière est un sous-ensemble
 * des passifs, et en annoncer plus que le total signalerait une double
 * attribution — l'immobilier se lirait net d'une dette que personne ne doit.
 */
export function checkPatrimonyIdentities(
  m: PatrimonyMetrics
): PatrimonyIdentityCheck {
  const brutVsPockets = m.brut.minus(sumAssetPockets(m.pockets)).abs();
  const netVsBrutMinusPassifs = m.net
    .minus(m.brut.minus(m.pockets.passifs))
    .abs();
  const financierMinusBrut = m.financier.minus(m.brut);
  const immoNetVsImmoMinusDette = m.immobilierNet
    .minus(m.pockets.immobilier.minus(m.liabilitiesRealEstate))
    .abs();
  const detteImmoMinusPassifs = m.liabilitiesRealEstate.minus(m.pockets.passifs);
  const ok =
    brutVsPockets.lte(CENTIME_EUR) &&
    netVsBrutMinusPassifs.lte(CENTIME_EUR) &&
    financierMinusBrut.lte(CENTIME_EUR) &&
    immoNetVsImmoMinusDette.lte(CENTIME_EUR) &&
    detteImmoMinusPassifs.lte(CENTIME_EUR);
  return {
    brutVsPockets,
    netVsBrutMinusPassifs,
    financierMinusBrut,
    immoNetVsImmoMinusDette,
    detteImmoMinusPassifs,
    ok,
  };
}

/**
 * Table lisible des 8 poches + 3 agrégats — debug T-02 / logs opt-in.
 *
 * `PATRIMONY_METRICS_DEBUG=1` la pousse sur stderr depuis `getPortfolioBundle`.
 */
export function formatPatrimonyPocketTable(m: PatrimonyMetrics): string {
  const eur = (v: Decimal) =>
    `${Number(toFixed(v, 2)).toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} €`;
  const lines = [
    "PatrimonyMetrics — poches fermées",
    `asOf ${m.asOf}`,
    ...PATRIMONY_POCKETS.map((k) => `  ${k.padEnd(16)} ${eur(m.pockets[k])}`),
    `  ${"brut".padEnd(16)} ${eur(m.brut)}`,
    `  ${"net".padEnd(16)} ${eur(m.net)}`,
    `  ${"financier".padEnd(16)} ${eur(m.financier)}`,
    `  ${"fondsEuro".padEnd(16)} ${eur(m.fondsEuro)}`,
    `  ${"esLiquid".padEnd(16)} ${eur(m.esLiquid)}`,
    `  ${"cashInvest.".padEnd(16)} ${eur(m.cashInvestissement)}`,
    `  ${"detteImmo".padEnd(16)} ${eur(m.liabilitiesRealEstate)}`,
    `  ${"immobilierNet".padEnd(16)} ${eur(m.immobilierNet)}`,
  ];
  return lines.join("\n");
}
