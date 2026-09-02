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
  fundingPaid: string | null;
  commissionPaid: string | null;
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
      fundingPaid: toNumberString(pick(raw, aliasMap, cols.funding)),
      commissionPaid: toNumberString(pick(raw, aliasMap, cols.commission)),
      closedAt: pick(raw, aliasMap, cols.closedAt),
    });
  });

  return { exchange, rows, skipped, errors };
}
