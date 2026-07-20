import { normalizeHeader } from "./csv-parse";
import type { TxType } from "../accounting/types";

export type ImportFormatId =
  | "patrimo"
  | "generic"
  | "binance"
  | "boursorama"
  | "revolut"
  | "coinbase"
  | "fortuneo"
  | "trade_republic"
  | "interactive_brokers"
  | "cryptocom"
  | "cryptocom_transfer"
  | "nexo"
  | "ascendex"
  | "ledger_live"
  | "dynamic";

export type ColumnRole =
  | "date"
  | "type"
  | "ticker"
  | "name"
  | "quantity"
  | "unitPrice"
  | "fees"
  | "currency"
  | "cashAmount"
  | "notes"
  | "assetClass"
  | "side" // buy/sell for binance-like
  | "description" // free-text for Revolut / Coinbase inference
  | "product" // Revolut product column
  | "platform" // courtier / plateforme
  | "ignore";

export type FormatPreset = {
  id: ImportFormatId;
  label: string;
  description: string;
  /** Possible header aliases (normalized) → role */
  aliases: Record<string, ColumnRole>;
};

export const IMPORT_FORMATS: FormatPreset[] = [
  {
    id: "patrimo",
    label: "Modèle Patrimo (recommandé)",
    description:
      "Colonnes : date, type, ticker, name, quantity, unit_price, fees, currency, cash_amount, notes, asset_class",
    aliases: {
      date: "date",
      date_operation: "date",
      occurred_at: "date",
      type: "type",
      type_operation: "type",
      operation: "type",
      ticker: "ticker",
      symbol: "ticker",
      isin: "ticker",
      name: "name",
      nom: "name",
      actif: "name",
      quantity: "quantity",
      quantite: "quantity",
      qty: "quantity",
      parts: "quantity",
      unit_price: "unitPrice",
      prix: "unitPrice",
      prix_unitaire: "unitPrice",
      price: "unitPrice",
      cours: "unitPrice",
      fees: "fees",
      frais: "fees",
      commission: "fees",
      currency: "currency",
      devise: "currency",
      cash_amount: "cashAmount",
      montant: "cashAmount",
      amount: "cashAmount",
      notes: "notes",
      commentaire: "notes",
      libelle: "notes",
      asset_class: "assetClass",
      platform: "platform",
      plateforme: "platform",
      broker: "platform",
      courtier: "platform",
      account: "platform",
      compte: "platform",
      classe: "assetClass",
    },
  },
  {
    id: "generic",
    label: "Générique (auto-détection)",
    description: "Détecte automatiquement les colonnes courantes FR/EN",
    aliases: {
      date: "date",
      datetime: "date",
      date_time: "date",
      date_operation: "date",
      trade_date: "date",
      time: "date",
      utc_time: "date",
      type: "type",
      operation: "type",
      side: "side",
      buy_sell: "side",
      sens: "side",
      ticker: "ticker",
      symbol: "ticker",
      coin: "ticker",
      pair: "ticker",
      market: "ticker",
      isin: "ticker",
      name: "name",
      asset: "name",
      product: "name",
      nom: "name",
      quantity: "quantity",
      qty: "quantity",
      amount: "quantity",
      executed: "quantity",
      size: "quantity",
      quantite: "quantity",
      price: "unitPrice",
      unit_price: "unitPrice",
      prix: "unitPrice",
      avg_price: "unitPrice",
      fee: "fees",
      fees: "fees",
      fee_amount: "fees",
      commission: "fees",
      frais: "fees",
      currency: "currency",
      fee_coin: "currency",
      quote_currency: "currency",
      devise: "currency",
      total: "cashAmount",
      total_amount: "cashAmount",
      cash: "cashAmount",
      montant: "cashAmount",
      notes: "notes",
      remark: "notes",
      description: "notes",
      libelle: "notes",
    },
  },
  {
    id: "binance",
    label: "Binance (Trade History)",
    description: "Export Spot Trade History (Date, Pair, Side, Price, Executed, Amount, Fee)",
    aliases: {
      date_utc_: "date",
      date_utc: "date",
      date: "date",
      utc_time: "date",
      pair: "ticker",
      market: "ticker",
      symbol: "ticker",
      side: "side",
      type: "side",
      price: "unitPrice",
      executed: "quantity",
      amount: "cashAmount",
      fee: "fees",
      trading_fee: "fees",
      fee_coin: "notes",
    },
  },
  {
    id: "boursorama",
    label: "Boursorama (opérations)",
    description: "Exports type opérations (Date, Libellé, Code, Quantité, Prix, Montant)",
    aliases: {
      date: "date",
      date_operation: "date",
      date_valeur: "date",
      libelle: "name",
      label: "name",
      operation: "type",
      type: "type",
      code: "ticker",
      isin: "ticker",
      ticker: "ticker",
      valeur: "name",
      quantite: "quantity",
      quantity: "quantity",
      prix: "unitPrice",
      cours: "unitPrice",
      price: "unitPrice",
      montant: "cashAmount",
      montant_brut: "cashAmount",
      frais: "fees",
      commission: "fees",
      devise: "currency",
      currency: "currency",
    },
  },
  {
    id: "revolut",
    label: "Revolut (compte / trading / crypto)",
    description:
      "Statement compte (Type, Product, Amount…) ; export crypto FR (Symbol, Type, Quantity, Price, Value, Fees, Date) ; export Invest (Ticker, Price per share)",
    aliases: {
      // Dates
      date: "date",
      started_date: "date",
      completed_date: "date",
      date_started: "date",
      date_completed: "date",
      completed_date_utc: "date",
      // Type / side
      type: "type",
      side: "side",
      // Asset
      ticker: "ticker",
      symbol: "ticker",
      product: "product",
      // Description (infer exchange direction)
      description: "description",
      // Qty / price
      quantity: "quantity",
      qty: "quantity",
      price_per_share: "unitPrice",
      price: "unitPrice",
      // Money — Value = notional crypto statement FR
      amount: "cashAmount",
      total_amount: "cashAmount",
      total: "cashAmount",
      value: "cashAmount",
      fee: "fees",
      fees: "fees",
      currency: "currency",
      // Notes
      notes: "notes",
      state: "notes",
      balance: "ignore",
      id: "ignore",
      fx_rate: "ignore",
    },
  },
  {
    id: "ledger_live",
    label: "Ledger Live (operations export)",
    description:
      "Export Ledger Live « operations » (Operation Date, Status, Currency Ticker, Operation Type IN/OUT/FEES/REWARD, Operation Amount/Fees, Account Name, Countervalue…)",
    aliases: {
      operation_date: "date",
      date: "date",
      status: "ignore", // filtré dans map-rows (Failed)
      currency_ticker: "ticker",
      operation_type: "type",
      type: "type",
      operation_amount: "quantity",
      amount: "quantity",
      operation_fees: "fees",
      fees: "fees",
      operation_hash: "notes",
      hash: "notes",
      account_name: "platform",
      account: "platform",
      account_xpub: "ignore",
      xpub: "ignore",
      countervalue_ticker: "currency",
      countervalue_at_operation_date: "cashAmount",
      countervalue_at_csv_export: "ignore",
      countervalue: "cashAmount",
    },
  },
  {
    id: "coinbase",
    label: "Coinbase (Transaction history)",
    description:
      "Export Transaction history Coinbase (Timestamp, Transaction Type, Asset, Quantity, Price/Spot Price, Fees) — y compris format 2024–2026 avec ID et Price at Transaction",
    aliases: {
      timestamp: "date",
      date_time: "date",
      created_at: "date",
      time: "date",
      date: "date",
      transaction_type: "type",
      type: "type",
      side: "side",
      asset: "ticker",
      currency: "currency", // may be asset ticker on some exports — handled later
      product: "ticker",
      size: "quantity",
      size_unit: "ignore",
      quantity_transacted: "quantity",
      quantity: "quantity",
      // Ancien export
      spot_price_at_transaction: "unitPrice",
      spot_price_currency: "currency",
      // Nouveau export 2024–2026 (Price at Transaction, Price Currency)
      price_at_transaction: "unitPrice",
      price_currency: "currency",
      price: "unitPrice",
      subtotal: "cashAmount",
      // Préférer Subtotal pour FMV ; Total reste disponible si Subtotal absent
      total_inclusive_of_fees_and_or_spread: "cashAmount",
      total: "cashAmount",
      fees_and_or_spread: "fees",
      fee: "fees",
      fees: "fees",
      notes: "notes",
      notes_: "notes",
      portfolio: "ignore",
      trade_id: "ignore",
      transaction_id: "ignore",
      id: "ignore",
      sender_address: "ignore",
      recipient_address: "ignore",
    },
  },
  {
    id: "fortuneo",
    label: "Fortuneo",
    description: "Exports opérations Fortuneo (Date, Libellé, ISIN, Quantité, Cours…)",
    aliases: {
      date: "date",
      date_operation: "date",
      date_valeur: "date",
      libelle: "name",
      operation: "type",
      type: "type",
      sens: "side",
      isin: "ticker",
      code: "ticker",
      ticker: "ticker",
      quantite: "quantity",
      quantity: "quantity",
      cours: "unitPrice",
      prix: "unitPrice",
      price: "unitPrice",
      montant: "cashAmount",
      frais: "fees",
      commission: "fees",
      devise: "currency",
      currency: "currency",
    },
  },
  {
    id: "trade_republic",
    label: "Trade Republic",
    description: "Exports transactions Trade Republic",
    aliases: {
      date: "date",
      datetime: "date",
      type: "type",
      isin: "ticker",
      shares: "quantity",
      quantity: "quantity",
      price: "unitPrice",
      value: "cashAmount",
      amount: "cashAmount",
      commission: "fees",
      taxes: "fees",
      fee: "fees",
      currency: "currency",
      note: "notes",
      name: "name",
    },
  },
  {
    id: "interactive_brokers",
    label: "Interactive Brokers",
    description: "Activity / Trades CSV IBKR",
    aliases: {
      tradedate: "date",
      trade_date: "date",
      date_time: "date",
      date: "date",
      symbol: "ticker",
      buy_sell: "side",
      quantity: "quantity",
      t_price: "unitPrice",
      price: "unitPrice",
      proceeds: "cashAmount",
      comm_fee: "fees",
      ib_commission: "fees",
      commission: "fees",
      currency: "currency",
      currencyprimary: "currency",
      description: "name",
    },
  },
  {
    id: "cryptocom",
    label: "Crypto.com (App — crypto / carte / fiat)",
    description:
      "Export app : Timestamp (UTC), Transaction Description, Currency, Amount, To Currency, To Amount, Native Amount, Transaction Kind",
    aliases: {
      timestamp_utc: "date",
      timestamp: "date",
      time_utc: "date",
      transaction_description: "description",
      description: "description",
      currency: "ticker",
      amount: "quantity",
      to_currency: "name", // buy side of conversion
      to_amount: "cashAmount", // temporarily; map-rows specializes
      native_currency: "currency",
      native_amount: "notes", // numeric in notes path — specialized in map-rows
      native_amount_in_usd: "ignore",
      transaction_kind: "type",
      transaction_hash: "ignore",
    },
  },
  {
    id: "cryptocom_transfer",
    label: "Crypto.com (Deposit / Withdrawal / Supercharger)",
    description:
      "Exports wallet : Time (UTC), Coin, Deposit/Withdrawal Amount, Fee, Status",
    aliases: {
      time_utc: "date",
      time: "date",
      coin: "ticker",
      deposit_amount: "quantity",
      withdrawal_amount: "quantity",
      amount: "quantity",
      fee: "fees",
      deposit_address: "ignore",
      withdrawal_address: "ignore",
      status: "notes",
      txid: "ignore",
      tx_id: "ignore",
    },
  },
  {
    id: "nexo",
    label: "Nexo",
    description:
      "Nexo Transactions CSV (Transaction, Type, Input/Output Currency & Amount, Date / Time)",
    aliases: {
      transaction: "ignore",
      type: "type",
      currency: "ticker",
      amount: "quantity",
      input_currency: "ticker",
      input_amount: "quantity",
      output_currency: "name",
      output_amount: "cashAmount",
      usd_equivalent: "ignore",
      details: "description",
      outstanding_loan: "ignore",
      date_time: "date",
      date_time_utc: "date",
      date: "date",
    },
  },
  {
    id: "ascendex",
    label: "AscendEX (staking / DeFi rewards)",
    description:
      "Exports staking/DeFi : Time, Type, Projects, Token, Size / Reward, Status",
    aliases: {
      time: "date",
      type: "type",
      projects: "description",
      token: "ticker",
      size: "quantity",
      farming_balance: "ignore",
      income_type: "notes",
      reward: "quantity",
      status: "notes",
    },
  },
  {
    id: "dynamic",
    label: "Détection dynamique",
    description: "Auto-matching intelligent des colonnes (CSV non standard)",
    aliases: {
      // same as generic — dynamic mapper complements
      date: "date",
      datetime: "date",
      type: "type",
      side: "side",
      ticker: "ticker",
      symbol: "ticker",
      quantity: "quantity",
      qty: "quantity",
      price: "unitPrice",
      unit_price: "unitPrice",
      fees: "fees",
      currency: "currency",
      amount: "cashAmount",
      total: "cashAmount",
      notes: "notes",
    },
  },
];

export function getFormat(id: ImportFormatId | string): FormatPreset {
  return (
    IMPORT_FORMATS.find((f) => f.id === id) ||
    IMPORT_FORMATS.find((f) => f.id === "generic") ||
    IMPORT_FORMATS[0]!
  );
}

/** Build header → role map from actual CSV headers + preset */
export function resolveColumnMap(
  headers: string[],
  formatId: ImportFormatId | string,
  override?: Record<string, ColumnRole> | null
): Record<string, ColumnRole> {
  if (override && Object.keys(override).length > 0) {
    return { ...override };
  }
  const preset = getFormat(formatId);
  const map: Record<string, ColumnRole> = {};
  for (const h of headers) {
    const key = normalizeHeader(h);
    const role = preset.aliases[key];
    if (role) map[h] = role;
  }
  return map;
}

const TYPE_ALIASES: Record<string, TxType> = {
  achat: "ACHAT",
  buy: "ACHAT",
  purchase: "ACHAT",
  bought: "ACHAT",
  acquisition: "ACHAT",
  vente: "VENTE",
  sell: "VENTE",
  sold: "VENTE",
  sale: "VENTE",
  dividende: "DIVIDENDE",
  dividend: "DIVIDENDE",
  coupon: "COUPON",
  loyer: "LOYER",
  rent: "LOYER",
  interet: "INTERET",
  interest: "INTERET",
  interests: "INTERET",
  rewards: "REWARD",
  reward: "REWARD",
  staking: "REWARD",
  "mise en staking": "REWARD",
  "recompense de staking": "REWARD",
  "recompense apprendre": "REWARD",
  apprendre: "REWARD",
  "learning reward": "REWARD",
  "rewards income": "REWARD",
  "staking income": "REWARD",
  "staking reward": "REWARD",
  "inflation reward": "REWARD",
  airdrop: "AIRDROP",
  "air drop": "AIRDROP",
  "claim airdrop": "AIRDROP",
  reception: "APPORT",
  recompense: "REWARD",
  frais: "FRAIS",
  fee: "FRAIS",
  fees: "FRAIS",
  commission: "FRAIS",
  apport: "APPORT",
  deposit: "APPORT",
  depot: "APPORT",
  funding: "APPORT",
  topup: "APPORT",
  "top-up": "APPORT",
  receive: "APPORT",
  received: "APPORT",
  card_refund: "APPORT",
  refund: "APPORT",
  retrait: "RETRAIT",
  withdraw: "RETRAIT",
  withdrawal: "RETRAIT",
  send: "RETRAIT",
  sent: "RETRAIT",
  card_payment: "RETRAIT",
  // Ledger Live Operation Type (fees déjà mappé → FRAIS plus haut)
  in: "APPORT", // réception crypto → REWARD dans map-rows
  out: "RETRAIT", // envoi crypto → VENTE dans map-rows
  delegate: "TRANSFERT_TITRE",
  undelegate: "TRANSFERT_TITRE",
  redelegate: "TRANSFERT_TITRE",
  unbond: "TRANSFERT_TITRE",
  bond: "TRANSFERT_TITRE",
  withdraw_unbonded: "APPORT",
  opt_in: "TRANSFERT_TITRE",
  opt_out: "TRANSFERT_TITRE",
  lock: "TRANSFERT_TITRE",
  chill: "TRANSFERT_TITRE",
  nominate: "TRANSFERT_TITRE",
  transfert: "TRANSFERT_CASH",
  transfer: "TRANSFERT_CASH",
  // Revolut / Coinbase specials handled in map-rows when possible
  exchange: "ACHAT",
  convert: "ACHAT",
  conversion: "ACHAT",
  // Crypto.com Transaction Kind
  crypto_purchase: "ACHAT",
  crypto_viban_exchange: "ACHAT",
  crypto_exchange: "ACHAT",
  crypto_withdrawal: "RETRAIT",
  crypto_deposit: "APPORT",
  crypto_earn_program_created: "TRANSFERT_TITRE",
  crypto_earn_program_withdrawn: "TRANSFERT_TITRE",
  crypto_earn_interest_paid: "INTERET",
  referral_card_cashback: "REWARD",
  referral_gift: "REWARD",
  referral_bonus: "REWARD",
  mco_stake_reward: "REWARD",
  admin_wallet_credited: "APPORT",
  admin_wallet_deducted: "RETRAIT",
  finance_deposit: "APPORT",
  finance_withdraw: "RETRAIT",
  viban_purchase: "ACHAT",
  viban_deposit: "APPORT",
  dust_conversion_debited: "VENTE",
  dust_conversion_credited: "ACHAT",
  // Nexo
  lockingtermdeposit: "TRANSFERT_CASH",
  exchangedepositedon: "ACHAT",
  deposittoexchange: "APPORT",
  transferin: "APPORT",
  transferout: "RETRAIT",
  interestadditional: "INTERET",
  fixedterminterest: "INTERET",
  // AscendEX
  compound: "REWARD",
  regular_redemption: "RETRAIT",
  regularredemption: "RETRAIT",
};

export function mapTxType(raw: string | undefined | null, side?: string | null): TxType | null {
  if (side) {
    const s = side.trim().toLowerCase();
    if (["buy", "achat", "b"].includes(s)) return "ACHAT";
    if (["sell", "vente", "s"].includes(s)) return "VENTE";
  }
  if (!raw) return null;
  const key = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  // Cas composés Revolut Invest — avant le match « includes » des alias courts
  // (sinon "reward" capture "STOCKS PROMOTION REWARD", "buy" capture "BUY - MARKET" OK)
  if (/clawback/i.test(key)) return "RETRAIT";
  if (/stocks?\s*promotion|promotion\s*reward/i.test(key)) return "APPORT";
  if (/cash\s*top.?up|^top.?up$/i.test(key)) return "APPORT";
  if (/cash\s*withdraw/i.test(key)) return "RETRAIT";
  if (/^buy(\s|$|-)/i.test(key)) return "ACHAT";
  if (/^sell(\s|$|-)/i.test(key)) return "VENTE";

  if (TYPE_ALIASES[key]) return TYPE_ALIASES[key];
  // Contains — trier par longueur décroissante pour éviter "fee" avant "fees" etc.
  const aliasKeys = Object.keys(TYPE_ALIASES).sort((a, b) => b.length - a.length);
  for (const k of aliasKeys) {
    if (key.includes(k)) return TYPE_ALIASES[k]!;
  }
  // Exact enum
  const upper = raw.trim().toUpperCase();
  if (
    [
      "ACHAT",
      "VENTE",
      "DIVIDENDE",
      "COUPON",
      "LOYER",
      "INTERET",
      "REWARD",
      "FRAIS",
      "APPORT",
      "RETRAIT",
      "TRANSFERT_CASH",
      "TRANSFERT_TITRE",
    ].includes(upper)
  ) {
    return upper as TxType;
  }
  // Boursorama / Revolut / Coinbase free-text labels
  if (/achat|souscription|execution d.achat|bought/i.test(key)) return "ACHAT";
  if (/vente|cession|sold/i.test(key)) return "VENTE";
  if (/dividende|dividend/i.test(key)) return "DIVIDENDE";
  if (/coupon/i.test(key)) return "COUPON";
  // Staking / airdrop / learning reward → REWARD (pas INTERET cash, pas ACHAT)
  if (/air\s*drop|airdrop/i.test(key)) return "AIRDROP";
  if (/reward|staking|recompense|apprendre/i.test(key)) return "REWARD";
  if (/interest|interet/i.test(key)) return "INTERET";
  if (/top.?up|deposit|receiv|reception|funding/i.test(key)) return "APPORT";
  if (/withdraw|sent?|card.?payment/i.test(key)) return "RETRAIT";
  if (/exchange|convert/i.test(key)) return "ACHAT"; // refined by description in map-rows
  return null;
}

/**
 * Infer format from CSV headers when user picks "generic" or for auto-detect UI.
 */
export function detectFormatFromHeaders(headers: string[]): ImportFormatId {
  const keys = headers.map((h) => normalizeHeader(h));
  const has = (...needles: string[]) =>
    needles.every((n) => keys.some((k) => k.includes(n) || k === n));
  const hasAny = (...needles: string[]) =>
    needles.some((n) => keys.some((k) => k.includes(n) || k === n));

  if (has("pair") && (has("side") || has("executed"))) return "binance";
  // Ledger Live operations export
  if (
    hasAny("operation_date", "operation_type", "currency_ticker") &&
    hasAny("operation_amount", "operation_fees") &&
    (hasAny("account_name", "account_xpub") || hasAny("countervalue_at_operation_date"))
  ) {
    return "ledger_live";
  }
  if (
    has("operation_type") &&
    has("currency_ticker") &&
    hasAny("operation_date", "operation_hash")
  ) {
    return "ledger_live";
  }
  // Crypto.com App (transaction_kind signature)
  if (
    hasAny("transaction_kind") ||
    (hasAny("timestamp_utc", "timestamp") &&
      hasAny("native_amount") &&
      hasAny("transaction_description", "description") &&
      hasAny("currency") &&
      hasAny("amount"))
  ) {
    // Ne pas confondre avec Coinbase (quantity_transacted / spot_price)
    if (
      !hasAny("quantity_transacted", "spot_price_at_transaction", "transaction_type")
    ) {
      return "cryptocom";
    }
  }
  // Crypto.com Deposit / Withdrawal
  if (
    hasAny("time_utc", "time") &&
    has("coin") &&
    hasAny("deposit_amount", "withdrawal_amount")
  ) {
    return "cryptocom_transfer";
  }
  // Nexo
  if (
    has("type") &&
    hasAny("date_time", "date_time_utc") &&
    (hasAny("input_currency", "input_amount") ||
      (has("currency") && has("amount") && hasAny("transaction")))
  ) {
    return "nexo";
  }
  // AscendEX staking
  if (has("token") && has("time") && hasAny("projects", "farming_balance", "reward")) {
    return "ascendex";
  }
  if (
    has("timestamp") ||
    has("transaction_type") ||
    has("quantity_transacted") ||
    has("spot_price_at_transaction")
  ) {
    return "coinbase";
  }
  if (
    (has("started_date") || has("completed_date") || has("product")) &&
    (has("description") || has("type"))
  ) {
    return "revolut";
  }
  // Export Invest Revolut : Date, Ticker, Type, Quantity, Price per share, Total Amount
  if (
    has("price_per_share") &&
    has("ticker") &&
    has("date") &&
    hasAny("type", "total_amount")
  ) {
    return "revolut";
  }
  if (has("price_per_share") && has("ticker")) return "revolut";
  // Export crypto Revolut FR : Symbol, Type, Quantity, Price, Value, Fees, Date
  if (
    has("symbol") &&
    has("type") &&
    has("quantity") &&
    has("price") &&
    hasAny("value", "fees") &&
    has("date")
  ) {
    return "revolut";
  }
  if (hasAny("ib_commission", "t_price", "buy_sell") && hasAny("symbol", "tradedate", "trade_date")) {
    return "interactive_brokers";
  }
  if (hasAny("shares") && hasAny("isin") && hasAny("taxes", "commission")) {
    return "trade_republic";
  }
  if (has("libelle") && has("isin") && hasAny("date_operation", "date_valeur", "cours")) {
    return "fortuneo";
  }
  if (has("libelle") || has("isin") || has("date_valeur")) return "boursorama";
  if (has("unit_price") && has("asset_class")) return "patrimo";
  if (
    has("date") &&
    has("type") &&
    has("ticker") &&
    hasAny("unit_price", "quantity") &&
    hasAny("cash_amount", "fees", "asset_class", "currency")
  ) {
    return "patrimo";
  }
  return "generic";
}

/** Parse "Exchanged to BTC" / "Buy BTC" style descriptions */
export function inferAssetFromDescription(description: string): {
  ticker: string | null;
  side: "buy" | "sell" | null;
} {
  const d = description.trim();
  if (!d) return { ticker: null, side: null };

  // Revolut: "Exchanged to BTC", "Exchanged from BTC"
  const to = d.match(/exchanged\s+to\s+([A-Z0-9]{2,10})/i);
  if (to) return { ticker: to[1].toUpperCase(), side: "buy" };
  const from = d.match(/exchanged\s+from\s+([A-Z0-9]{2,10})/i);
  if (from) return { ticker: from[1].toUpperCase(), side: "sell" };

  // "Buy BTC", "Sell ETH", "Bought Bitcoin"
  const buy = d.match(/\b(?:buy|bought|purchase)\s+([A-Z0-9]{2,12}|[A-Za-z]+)/i);
  if (buy) return { ticker: normalizeCryptoName(buy[1]), side: "buy" };
  const sell = d.match(/\b(?:sell|sold)\s+([A-Z0-9]{2,12}|[A-Za-z]+)/i);
  if (sell) return { ticker: normalizeCryptoName(sell[1]), side: "sell" };

  // Coinbase notes sometimes "Bought 0.01 BTC using EUR"
  const bought = d.match(/bought\s+[\d.,]+\s+([A-Z]{2,10})/i);
  if (bought) return { ticker: bought[1].toUpperCase(), side: "buy" };
  const sold = d.match(/sold\s+[\d.,]+\s+([A-Z]{2,10})/i);
  if (sold) return { ticker: sold[1].toUpperCase(), side: "sell" };

  return { ticker: null, side: null };
}

function normalizeCryptoName(raw: string): string {
  const map: Record<string, string> = {
    bitcoin: "BTC",
    ethereum: "ETH",
    solana: "SOL",
    litecoin: "LTC",
    ripple: "XRP",
    cardano: "ADA",
    dogecoin: "DOGE",
    tether: "USDT",
  };
  const k = raw.trim().toLowerCase();
  return map[k] || raw.trim().toUpperCase();
}

export function guessAssetClass(
  ticker?: string | null,
  name?: string | null,
  explicit?: string | null
): "ACTIONS" | "CRYPTO" | "IMMOBILIER" | "OBLIGATIONS" | "CASH" | "AUTRE" {
  if (explicit) {
    const e = explicit.toUpperCase();
    if (["ACTIONS", "CRYPTO", "IMMOBILIER", "OBLIGATIONS", "CASH", "AUTRE"].includes(e)) {
      return e as "ACTIONS" | "CRYPTO" | "IMMOBILIER" | "OBLIGATIONS" | "CASH" | "AUTRE";
    }
    if (/crypto|btc|eth/i.test(explicit)) return "CRYPTO";
    if (/action|etf|stock|equity/i.test(explicit)) return "ACTIONS";
  }
  const t = (ticker || "").toUpperCase();
  const n = (name || "").toLowerCase();
  if (/\.(PA|AS|DE|L|SW|MI|MC)$/i.test(t) || /^[A-Z]{1,5}$/.test(t)) {
    if (["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "DOGE", "AVAX", "DOT", "LINK"].includes(t)) {
      return "CRYPTO";
    }
    if (/\.(PA|AS|DE|L|SW)$/i.test(t)) return "ACTIONS";
  }
  if (/bitcoin|ethereum|crypto|usdt|usdc/i.test(n) || /BTC|ETH|USDT/i.test(t)) return "CRYPTO";
  if (/scpi|immobilier|appart/i.test(n)) return "IMMOBILIER";
  if (/bond|obligat/i.test(n)) return "OBLIGATIONS";
  // Trading pairs like BTCUSDT → crypto
  if (/^[A-Z0-9]{2,10}(USDT|BUSD|EUR|USD|BTC|ETH)$/i.test(t)) return "CRYPTO";
  return "ACTIONS";
}

/** Extract base asset ticker from pair e.g. BTCUSDT → BTC, MC.PA stays MC.PA */
export function normalizeTicker(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toUpperCase();
  if (!t) return null;
  // Binance pairs
  const quote = t.match(/^(.*?)(USDT|BUSD|USDC|EUR|USD|BTC|ETH|FDUSD|TUSD)$/);
  if (quote && quote[1].length >= 2 && quote[1].length <= 10) {
    // Prefer base for crypto
    if (["USDT", "BUSD", "USDC", "BTC", "ETH", "FDUSD", "TUSD"].includes(quote[2])) {
      return quote[1];
    }
  }
  return t;
}
