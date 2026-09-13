/**
 * Import CSV des relevés de trades futures — Binance, Bybit, OKX.
 *
 * Fonction pure : lit un CSV déjà parsé, produit des lignes normalisées. Rien
 * ici ne touche Prisma, pour la même raison que les moteurs fiscaux
 * immobiliers — c'est ce qui rend les trois formats testables sans base.
 *
 * Chaque exchange exporte un « historique des trades clôturés » où une ligne
 * = une position déjà dénouée (prix d'entrée, prix de sortie, P&L réalisé).
 * C'est délibérément différent d'un import de fills bruts : reconstituer une
 * position à partir d'exécutions partielles demanderait le carnet complet
 * (réductions partielles, moyennes à la hausse) qu'aucun des trois exports
 * standard ne fournit de façon exploitable sans risque de mal reconstituer
 * l'historique.
 *
 * Les noms de colonnes varient d'un export à l'autre (langue, version) : la
 * détection se fait par alias tolérants, pas par position de colonne.
 */

import { d } from "@/app/lib/money/decimal";
import { normalizeHeader, parseCsv } from "@/app/lib/import/csv-parse";
import { parseDate } from "@/app/lib/import/normalize";
import type { FuturesImportExchange } from "./futures-constants";

export type FuturesImportRow = {
  /** Identifiant de trade côté exchange — clé d'upsert. */
  exchangeTradeId: string;
  pair: string;
  direction: "LONG" | "SHORT";
  sizeContracts: string;
  entryPrice: string;
  exitPrice: string | null;
  leverage: string | null;
  realizedPnl: string | null;
  /**
   * Funding **déjà normalisé** à la convention du dépôt : positif = payé
   * (charge), négatif = perçu (produit) — l'inverse du signe brut des exports
   * (cf. `FEE_SIGN_CONVENTION`).
   */
  fundingPaid: string | null;
  /** Commission normalisée en valeur absolue : un frais n'est jamais encaissé. */
  commissionPaid: string | null;
  /** Instant de clôture en ISO 8601 UTC (`…Z`), déjà désambiguïsé. */
  closedAt: string | null;
};

export type FuturesImportResult = {
  exchange: FuturesImportExchange;
  rows: FuturesImportRow[];
  skipped: number;
  errors: string[];
};

/** Cherche la première colonne dont le nom normalisé correspond à un alias. */
function pick(
  row: Record<string, string>,
  headerAliasMap: Map<string, string>,
  aliases: string[]
): string | null {
  for (const alias of aliases) {
    const header = headerAliasMap.get(alias);
    if (header != null && row[header] != null && row[header] !== "") {
      return row[header];
    }
  }
  return null;
}

function buildAliasMap(headers: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of headers) map.set(normalizeHeader(h), h);
  return map;
}

function toDirection(raw: string | null): "LONG" | "SHORT" | null {
  const v = (raw || "").trim().toLowerCase();
  if (["long", "buy", "b", "1"].includes(v)) return "LONG";
  if (["short", "sell", "s", "-1"].includes(v)) return "SHORT";
  return null;
}

function toNumberString(raw: string | null): string | null {
  if (raw == null) return null;
  const cleaned = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!cleaned) return null;
  const n = d(cleaned);
  return n.isFinite() ? n.toString() : null;
}

/**
 * Sens du signe des colonnes de frais, par exchange.
 *
 * `CASH_FLOW` : l'export raisonne en **mouvement de compte** — un montant
 * négatif est un débit (frais payé), un positif un crédit (funding perçu).
 * C'est le cas des trois exports couverts ici :
 *
 *  - **Binance** (`Funding Fee`, `Commission`) : lignes d'income history, où
 *    un débit est négatif. Preuve dans le dépôt : la fixture
 *    `tests/unit/crypto/futures-csv.test.ts` porte `Funding Fee = −5` et
 *    `Commission = −3` sur un trade gagnant (`Realized Profit = 3000`) — une
 *    commission ne peut pas être un encaissement, donc « négatif = payé ».
 *  - **Bybit** (`Funding`, `Fee Paid`) : mêmes signes négatifs pour un frais
 *    prélevé dans les relevés de contrat du dépôt
 *    (`tests/fixtures/import/passe2/bybit-contract.csv`).
 *  - **OKX** (`fundingFee`, `fee`) : frais rapportés en négatif, même logique
 *    de cash-flow.
 *
 * La convention de stockage d'Aurea est l'inverse pour le funding (positif =
 * payé, cf. le bloc « Convention de signe » de `app/lib/crypto/futures.ts`) :
 * l'import **retourne donc le signe**, une fois, ici. Sans cette normalisation,
 * un funding payé (exporté négatif) serait relu comme un funding perçu.
 *
 * Table explicite plutôt que règle implicite : si un exchange change de
 * convention, la correction tient en une ligne, avec la preuve à côté.
 */
type FeeSignConvention = "CASH_FLOW";

const FEE_SIGN_CONVENTION: Record<FuturesImportExchange, FeeSignConvention> = {
  BINANCE: "CASH_FLOW",
  BYBIT: "CASH_FLOW",
  OKX: "CASH_FLOW",
};

/**
 * Funding brut de l'exchange → convention Aurea (positif = payé).
 *
 * `null` reste `null` : une colonne funding absente du relevé n'est pas un
 * funding nul, c'est une information que l'export ne donne pas.
 */
function normalizeFundingSign(
  raw: string | null,
  exchange: FuturesImportExchange
): string | null {
  if (raw == null) return null;
  return FEE_SIGN_CONVENTION[exchange] === "CASH_FLOW"
    ? d(raw).neg().toString()
    : raw;
}

/**
 * Commission brute → valeur absolue.
 *
 * Une commission est toujours une charge : son signe dans l'export ne porte
 * qu'un sens de cash-flow, aucune information économique à préserver.
 */
function normalizeCommission(raw: string | null): string | null {
  if (raw == null) return null;
  return d(raw).abs().toString();
}

/** Fuseau explicite en fin de chaîne : « Z », « +02:00 », « UTC », « GMT ». */
const EXPLICIT_ZONE = /(?:[zZ]|[+-]\d{2}:?\d{2}|\s(?:UTC|GMT))\s*$/;

/** « 2024-03-15 », « 2024-03-15 12:30:45 », « 2024-03-15T12:30 » — sans fuseau. */
const NAIVE_ISO =
  /^(\d{4}-\d{2}-\d{2})(?:[ T,]\s*(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/;

/**
 * Horodatage d'un relevé futures → instant. Deux pièges propres à ces exports :
 *
 *  - Binance et Bybit datent souvent en **epoch millisecondes** transmis comme
 *    chaîne (« 1710505845000 ») : `new Date("1710505845000")` ne parse pas, et
 *    le repli datait le trade d'aujourd'hui — un trade de 2024 entrait en 2026.
 *    `parseDate` sait déjà lire un epoch secondes ou millisecondes.
 *  - « 2024-03-15 12:30:45 » n'a pas de fuseau : le moteur le lit en heure
 *    locale du serveur. Les trois exchanges horodatent en UTC (la colonne
 *    Binance s'appelle même `Date(UTC)`) → on ancre explicitement en UTC,
 *    sinon le fuseau du serveur déplace le trade d'un jour.
 *
 * Renvoie `null` quand la date n'est pas lisible : pas de date inventée.
 */
export function parseFuturesTimestamp(
  raw: string | null | undefined
): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Epoch secondes ou millisecondes donné comme chaîne.
  if (/^\d{10,13}$/.test(s)) return parseDate(s);

  // Fuseau explicite : la chaîne se suffit à elle-même.
  if (EXPLICIT_ZONE.test(s)) return parseDate(s);

  const iso = s.match(NAIVE_ISO);
  if (iso) {
    const [, day, hour, min, sec] = iso;
    // Date seule : `new Date("2024-03-15")` est déjà minuit UTC.
    if (!hour) return parseDate(day!);
    return parseDate(
      `${day}T${hour.padStart(2, "0")}:${min}:${sec ?? "00"}Z`
    );
  }

  /*
    Autres formats sans fuseau (JJ/MM/AAAA hh:mm, « 15 Mar 2024 »…) :
    `parseDate` construit ces cadrans en heure locale. On réancre le même
    cadran en UTC plutôt que de réécrire ces formats ici.
  */
  const wall = parseDate(s);
  if (!wall) return null;
  return new Date(wall.getTime() - wall.getTimezoneOffset() * 60_000);
}

/**
 * Alias de colonnes par exchange.
 *
 * Volontairement une simple table par exchange plutôt qu'une détection
 * générique : chaque export a son vocabulaire propre (« Closed PnL » chez
 * Bybit, « Realized Profit » chez Binance, « pnl » chez OKX) et une table se
 * corrige d'une ligne quand un exchange change son format, sans logique à
 * ré-auditer.
 */
const COLUMN_ALIASES: Record<
  FuturesImportExchange,
  {
    tradeId: string[];
    pair: string[];
    direction: string[];
    size: string[];
    entry: string[];
    exit: string[];
    leverage: string[];
    pnl: string[];
    funding: string[];
    commission: string[];
    closedAt: string[];
  }
> = {
  BINANCE: {
    tradeId: ["order_id", "orderid", "trade_id", "tradeid"],
    pair: ["symbol", "pair"],
    direction: ["side", "position_side"],
    size: ["quantity", "qty", "amount"],
    entry: ["price", "avg_price", "entry_price"],
    exit: ["closing_price", "exit_price"],
    leverage: ["leverage"],
    pnl: ["realized_profit", "closed_pnl"],
    funding: ["funding_fee"],
    commission: ["commission", "fee"],
    closedAt: ["date", "time", "date_time_utc"],
  },
  BYBIT: {
    tradeId: ["order_no", "orderno", "order_id"],
    pair: ["contracts", "symbol"],
    direction: ["direction", "side"],
    size: ["qty", "closed_size"],
    entry: ["avg_entry_price", "entry_price"],
    exit: ["avg_exit_price", "exit_price"],
    leverage: ["leverage"],
    pnl: ["closed_pnl"],
    funding: ["funding", "funding_fee"],
    commission: ["fee", "trading_fee"],
    closedAt: ["created_time", "closed_time"],
  },
  OKX: {
    // Les en-têtes OKX sont en camelCase sans espaces (« ordId », « instId »…) :
    // `normalizeHeader` se contente de les mettre en minuscules, sans scinder
    // les mots — d'où des alias collés plutôt que séparés par underscore.
    tradeId: ["ordid", "ord_id"],
    pair: ["instrument", "instid", "inst_id"],
    direction: ["side", "postype", "pos_type"],
    size: ["size", "sz"],
    entry: ["avg_entry_price", "openavgpx", "open_avg_px"],
    exit: ["avg_exit_price", "closeavgpx", "close_avg_px"],
    leverage: ["leverage", "lever"],
    pnl: ["pnl", "realizedpnl", "realized_pnl"],
    funding: ["fundingfee", "funding_fee"],
    commission: ["fee"],
    closedAt: ["opentime", "open_time", "createtime", "create_time"],
  },
};

/**
 * Parse un CSV pour un exchange donné.
 *
 * Une ligne sans identifiant de trade, sans paire ou sans prix d'entrée
 * exploitable est ignorée plutôt que de faire échouer tout l'import : un
 * export contient souvent des lignes de synthèse ou des trades spot mêlés aux
 * futures.
 */
export function parseFuturesCsv(
  text: string,
  exchange: FuturesImportExchange
): FuturesImportResult {
  const parsed = parseCsv(text);
  const aliasMap = buildAliasMap(parsed.headers);
  const cols = COLUMN_ALIASES[exchange];

  const rows: FuturesImportRow[] = [];
  const errors: string[] = [];
  let skipped = 0;

  parsed.rows.forEach((raw, idx) => {
    const tradeId = pick(raw, aliasMap, cols.tradeId);
    const pair = pick(raw, aliasMap, cols.pair);
    const entry = toNumberString(pick(raw, aliasMap, cols.entry));
    const size = toNumberString(pick(raw, aliasMap, cols.size));
    const direction = toDirection(pick(raw, aliasMap, cols.direction));

    if (!tradeId || !pair || !entry || !size) {
      skipped += 1;
      return;
    }
    if (!direction) {
      errors.push(`Ligne ${idx + 2} : sens (long/short) non reconnu`);
      skipped += 1;
      return;
    }

    rows.push({
      exchangeTradeId: tradeId.trim(),
      pair: pair.trim().toUpperCase(),
      direction,
      sizeContracts: d(size).abs().toString(),
      entryPrice: entry,
      exitPrice: toNumberString(pick(raw, aliasMap, cols.exit)),
      leverage: toNumberString(pick(raw, aliasMap, cols.leverage)),
      realizedPnl: toNumberString(pick(raw, aliasMap, cols.pnl)),
      /*
        Signes normalisés ici, une seule fois : la base stocke la convention
        Aurea (funding positif = payé, commission ≥ 0), pas le signe brut de
        l'exchange, que les trois lecteurs auraient alors dû réinterpréter
        chacun à leur façon — c'est exactement la divergence corrigée.
      */
      fundingPaid: normalizeFundingSign(
        toNumberString(pick(raw, aliasMap, cols.funding)),
        exchange
      ),
      commissionPaid: normalizeCommission(
        toNumberString(pick(raw, aliasMap, cols.commission))
      ),
      closedAt:
        parseFuturesTimestamp(pick(raw, aliasMap, cols.closedAt))?.toISOString() ??
        null,
    });
  });

  return { exchange, rows, skipped, errors };
}
