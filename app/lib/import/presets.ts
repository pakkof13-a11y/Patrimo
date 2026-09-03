import { normalizeHeader } from "./csv-parse";
import type { TxType } from "../accounting/types";

export type ImportFormatId =
  | "patrimo"
  | "generic"
  | "avanza"
  | "binance"
  | "bitvavo"
  | "bux"
  | "degiro"
  | "directa"
  | "etoro"
  | "saxo"
  | "swissquote"
  | "bitpanda"
  | "bybit"
  | "revolut_crypto"
  | "trading212"
  | "xtb"
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
  | "paradex"
  | "hyperliquid_trade"
  | "hyperliquid_funding"
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

/**
 * Devises dans lesquelles un compte eToro peut être tenu.
 *
 * L'USD reste le défaut, mais eToro ouvre aussi des comptes en devise locale —
 * EUR (résidents UE), GBP, AUD, DKK — dont les relevés sont libellés dans cette
 * devise. Le compte n'est donc pas nécessairement en dollars, et rien ne permet
 * de le supposer.
 */
export const ETORO_ACCOUNT_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "AUD",
  "DKK",
] as const;

/**
 * En-têtes eToro portant la devise du compte : « Amount in (USD) ».
 *
 * Les relevés récents inscrivent la devise dans l'intitulé de colonne plutôt
 * que dans une colonne dédiée. `normalizeHeader` en fait `amount_in_usd`, qui
 * ne correspondait à aucun alias : la colonne des montants n'était alors pas
 * reconnue du tout, et le relevé remontait sans un seul montant.
 *
 * Les soldes courants restent ignorés — c'est leur devise qui nous intéresse,
 * pas leur valeur — mais ils sont déclarés pour que le mapping le dise.
 */
const ETORO_COLONNES_DEVISEES: Record<string, ColumnRole> = Object.fromEntries(
  ETORO_ACCOUNT_CURRENCIES.flatMap((devise) => {
    const d = devise.toLowerCase();
    return [
      [`amount_in_${d}`, "cashAmount" as ColumnRole],
      [`balance_in_${d}`, "ignore" as ColumnRole],
      [`realized_equity_in_${d}`, "ignore" as ColumnRole],
      [`realized_equity_change_in_${d}`, "ignore" as ColumnRole],
    ];
  })
);

export const IMPORT_FORMATS: FormatPreset[] = [
  {
    id: "patrimo",
    label: "Modèle Aurea (recommandé)",
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
    label: "Binance",
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
    /*
      Avanza — export suédois, séparateur `;` et virgule décimale.

      Deux devises cohabitent sur une même ligne : `Belopp` (montant) est en
      couronnes, `Kurs` (cours) dans la devise de l'instrument, et `Valutakurs`
      donne le taux entre les deux. Le cours n'est donc **pas** exprimé dans la
      devise du montant — c'est le cas particulier que traite `map-rows`.
    */
    id: "avanza",
    label: "Avanza",
    description:
      "Export « Transaktioner » (Datum, Typ av transaktion, Antal, Kurs, Belopp, Courtage, ISIN)",
    aliases: {
      datum: "date",
      konto: "ignore",
      typ_av_transaktion: "type",
      vardepapper_beskrivning: "name",
      antal: "quantity",
      kurs: "unitPrice",
      belopp: "cashAmount",
      transaktionsvaluta: "currency",
      courtage_sek: "fees",
      courtage: "fees",
      valutakurs: "ignore",
      instrumentvaluta: "ignore",
      isin: "ticker",
      resultat: "ignore",
    },
  },
  {
    /*
      Bitvavo — un journal unifié : trades, virements et staking.

      `Amount` porte la quantité de crypto, signée ; `Received / Paid Amount`
      le mouvement d'euros correspondant. La colonne `Status` distingue les
      lignes réellement exécutées de celles qui ne le sont pas — elle est lue
      par `map-rows`, jamais ignorée.
    */
    id: "bitvavo",
    label: "Bitvavo",
    description:
      "Export Transaction history (Date, Time, Type, Currency, Amount, Quote Price, Fee, Status)",
    aliases: {
      timezone: "ignore",
      date: "date",
      time: "ignore",
      type: "type",
      currency: "ticker",
      amount: "quantity",
      quote_currency: "currency",
      quote_price: "unitPrice",
      received_paid_currency: "ignore",
      received_paid_amount: "cashAmount",
      fee_currency: "ignore",
      fee_amount: "fees",
      status: "ignore",
      transaction_id: "ignore",
      address: "notes",
    },
  },
  {
    /*
      BUX — journal de compte, actifs et trésorerie mêlés.

      `Transaction Type` porte le libellé exploitable (« Buy Trade », « Cash
      Dividend »…), `Transaction Category` n'en est qu'un regroupement. Le
      montant est toujours en devise du compte, tandis que `Asset Price` peut
      être en devise étrangère — `Exchange Rate` fait le lien.
    */
    id: "etoro",
    label: "eToro",
    description:
      "Account Statement — onglet Account Activity (Date, Type, Details, Amount, Units, Position ID)",
    /*
      Les colonnes `Realized Equity`, `Balance` et `NWA` sont des soldes courants
      recalculés à chaque ligne, pas des mouvements : les importer créerait une
      transaction par état du compte. Seul `Amount` porte le flux de la ligne.
    */
    aliases: {
      date: "date",
      type: "type",
      details: "description",
      amount: "cashAmount",
      units: "quantity",
      realized_equity_change: "ignore",
      realized_equity: "ignore",
      balance: "ignore",
      position_id: "notes",
      asset_type: "assetClass",
      nwa: "ignore",
      ...ETORO_COLONNES_DEVISEES,
    },
  },
  {
    /*
      Saxo — un journal unique où le sens de l'opération est en toutes lettres.

      `Type` ne dit que la famille (Trade, Cash Transfer, Corporate action,
      Cash amount) ; c'est `Event` qui porte l'opération réelle — « Buy 3 @
      139.74 USD », « Dividend », « Custody Fee », « Deposit ». Les deux sont
      donc lues, `Event` faisant foi.

      `Amount` inclut déjà la commission : 3 × 134,85 = 404,55 pour un débit de
      405,55. Les frais s'en déduisent exactement, ils ne sont pas colonnés.
    */
    id: "saxo",
    label: "Saxo Bank",
    description:
      "Export « Transactions » (Trade Date, Type, Instrument ISIN, Instrument currency, Event, Amount)",
    aliases: {
      trade_date: "date",
      value_date: "ignore",
      client_id: "ignore",
      type: "type",
      instrument: "name",
      instrument_isin: "ticker",
      instrument_currency: "currency",
      exchange_description: "ignore",
      instrument_symbol: "ignore",
      event: "description",
      amount: "cashAmount",
      order_id: "notes",
      /*
        `Conversion Rate` donne le taux vers la devise du compte, que le
        fichier ne nomme jamais. L'appliquer reviendrait à convertir vers une
        devise inconnue : il est ignoré, et les montants restent dans la devise
        de l'instrument, la seule que le relevé énonce.
      */
      conversion_rate: "ignore",
    },
  },
  {
    /*
      Swissquote — relevé de transactions, séparateur `;`.

      Particularité : sur tout ce qui n'est pas un achat ou une vente
      (dividende, frais de garde, intérêts, change, retrait), `Quantity` vaut
      1.0 et `Unit price` porte le **montant**, pas un cours. Prendre ces 1.0
      pour une quantité de titres créerait une position d'une part à chaque
      dividende — d'où le traitement dans `map-rows`.
    */
    id: "swissquote",
    label: "Swissquote",
    description:
      "Export Transactions (Date, Transaction, Symbol, ISIN, Quantity, Unit price, Costs, Net Amount, Currency)",
    aliases: {
      date: "date",
      // « Order # » est un numéro d'ordre, pas un type.
      order: "notes",
      transaction: "type",
      symbol: "ticker",
      name: "name",
      isin: "notes",
      quantity: "quantity",
      unit_price: "unitPrice",
      costs: "fees",
      // Toujours 0,00 dans les relevés observés : le coupon couru n'est pas
      // représentable séparément, il n'est donc pas déclaré supporté.
      accrued_interest: "ignore",
      net_amount: "cashAmount",
      balance: "ignore",
      currency: "currency",
    },
  },
  {
    /*
      Bitpanda — un relevé où l'actif n'est pas forcément un titre.

      Le fichier mêle euros, métaux précieux et matières premières : `Asset`
      vaut « Silver » ou « Palladium », et `Asset class` le dit. Les deux
      montants sont séparés — `Amount Fiat` pour l'euro engagé, `Amount Asset`
      pour la quantité reçue — ce qui évite toute déduction.

      Cinq lignes de préambule précèdent les en-têtes ; `parseCsv` les écarte
      déjà en cherchant la ligne d'en-tête la plus dense.
    */
    id: "bitpanda",
    label: "Bitpanda",
    description:
      "Export Trades (Transaction ID, Timestamp, Transaction Type, Amount Fiat, Amount Asset, Asset, Fee)",
    aliases: {
      transaction_id: "notes",
      timestamp: "date",
      transaction_type: "type",
      in_out: "ignore",
      amount_fiat: "cashAmount",
      fiat: "currency",
      amount_asset: "quantity",
      asset: "ticker",
      asset_market_price: "unitPrice",
      asset_market_price_currency: "ignore",
      asset_class: "assetClass",
      product_id: "ignore",
      fee: "fees",
      fee_asset: "ignore",
      spread: "ignore",
      spread_currency: "ignore",
      tax_fiat: "ignore",
    },
  },
  {
    /*
      Bybit — seul l'export « Asset Change Details » du compte spot décrit des
      actifs réellement détenus.

      Les trois autres exports (Trade History, Closed P&L, Asset Change du
      compte contrat) portent sur des perpétuels : levier, financement,
      liquidation, résultat de position. Patrimo ne modélise pas les dérivés ;
      les importer créerait des positions qui n'existent pas. Ils sont
      reconnus — pour pouvoir le dire — mais pas convertis en opérations.
    */
    id: "bybit",
    label: "Bybit",
    description:
      "Export Asset Change Details compte spot (Type, Coin, Amount, Wallet Balance, Time)",
    aliases: {
      type: "type",
      coin: "ticker",
      amount: "quantity",
      wallet_balance: "ignore",
      time_utc: "date",
      time: "date",
      // Colonnes des exports dérivés, reconnues pour identifier le fichier.
      contracts: "ticker",
      contract: "ticker",
      direction: "ignore",
      closing_direction: "ignore",
      leverage: "ignore",
      filled_qty: "ignore",
      filled_price: "ignore",
      qty: "ignore",
      entry_price: "ignore",
      exit_price: "ignore",
      closed_p_l: "ignore",
      fees_paid: "ignore",
      fee_paid: "ignore",
      funding: "ignore",
      cash_flow: "ignore",
      change: "ignore",
      transaction_time_utc_0: "date",
      trade_time_utc_0: "date",
    },
  },
  {
    /*
      Revolut — le relevé crypto n'a pas le même sens que le relevé bancaire.

      Les deux partagent les en-têtes `Amount` et `Currency`, mais pas leur
      signification : sur le relevé bancaire, `Amount` est un montant en euros ;
      sur le relevé crypto, c'est une **quantité de jetons** et `Currency` en
      porte le symbole (DOT, ALGO…), la contre-valeur vivant dans `Fiat amount`
      et sa devise dans `Base currency`.

      Un `FormatPreset` associe un rôle unique à chaque en-tête : les deux sens
      ne peuvent pas cohabiter dans le même. D'où ce second format — le seul de
      ce chantier —, distingué à la détection par `Fiat amount` et
      `Base currency`, absents du relevé bancaire.
    */
    id: "revolut_crypto",
    label: "Revolut — relevé crypto",
    description:
      "Account statement crypto (Type, Product, Amount = quantité, Currency = jeton, Fiat amount, Base currency)",
    aliases: {
      type: "type",
      product: "product",
      started_date: "date",
      completed_date: "date",
      description: "description",
      amount: "quantity",
      currency: "ticker",
      fiat_amount: "cashAmount",
      // Contre-valeur frais inclus : le montant hors frais fait foi, les frais
      // ayant leur propre colonne. La retenir aussi les compterait deux fois.
      fiat_amount_inc_fees: "ignore",
      fee: "fees",
      base_currency: "currency",
      state: "notes",
      balance: "ignore",
    },
  },
  {
    id: "bux",
    label: "BUX",
    description:
      "Export Transactions (Transaction Time, Transaction Type, Asset Id, Asset Quantity, Asset Price)",
    aliases: {
      transaction_time_cet: "date",
      transaction_time: "date",
      transaction_category: "ignore",
      transaction_type: "type",
      transfer_type: "ignore",
      transaction_amount: "cashAmount",
      transaction_currency: "currency",
      cash_balance_amount: "ignore",
      asset_id: "ticker",
      asset_name: "name",
      asset_quantity: "quantity",
      asset_price: "unitPrice",
      asset_currency: "ignore",
      currency_pair: "ignore",
      exchange_rate: "ignore",
      profit_and_loss_amount: "ignore",
      profit_and_loss_currency: "ignore",
      dividend_currency: "ignore",
      dividend_gross_amount: "ignore",
      dividend_net_amount: "ignore",
      dividend_tax_amount: "ignore",
      transaction_description: "notes",
    },
  },
  {
    /*
      DEGIRO — relevé de compte (Rekeningoverzicht), pas l'export Transactions.

      Deux particularités structurelles. D'abord, les montants vivent dans des
      colonnes **sans en-tête** : `Mutatie` porte la devise et la colonne
      suivante le montant (idem `Saldo`). `dedupeHeaders` les nomme
      « Mutatie 2 » / « Saldo 2 » — sans quoi les deux colonnes anonymes
      s'écrasaient et le montant de l'opération était remplacé par le solde.

      Ensuite, il n'y a pas de colonne de type : tout est dans `Omschrijving`,
      un libellé libre rédigé dans la langue du compte — le fichier d'exemple
      en mélange cinq. La quantité et le cours d'une transaction n'y figurent
      que sous forme de texte (« Koop 1 @ 33,9 USD ») ; `map-rows` les en
      extrait.
    */
    id: "degiro",
    label: "DEGIRO",
    description:
      "Relevé de compte (Datum, Omschrijving, Mutatie, Saldo) — libellés multilingues",
    aliases: {
      datum: "date",
      tijd: "ignore",
      valutadatum: "ignore",
      product: "name",
      isin: "ticker",
      omschrijving: "type",
      fx: "ignore",
      mutatie: "currency",
      mutatie_2: "cashAmount",
      saldo: "ignore",
      saldo_2: "ignore",
      order_id: "ignore",
    },
  },
  {
    /*
      Directa — relevé « Tutti i movimenti », précédé de neuf lignes d'en-tête
      libre (titre du compte, période, nombre de mouvements). `parseCsv` trouve
      seul la vraie ligne de colonnes.

      Pas de colonne de cours : le prix unitaire se déduit du montant et de la
      quantité. `Importo euro` est signé — négatif à l'achat, positif à la
      vente et sur les revenus.
    */
    id: "directa",
    label: "Directa",
    description:
      "Export « Tutti i movimenti » (Data operazione, Tipo operazione, Isin, Quantità, Importo euro)",
    aliases: {
      data_operazione: "date",
      data_valuta: "ignore",
      tipo_operazione: "type",
      ticker: "ignore",
      isin: "ticker",
      protocollo: "ignore",
      descrizione: "name",
      quantita: "quantity",
      importo_euro: "cashAmount",
      importo_divisa: "ignore",
      divisa: "currency",
      riferimento_ordine: "ignore",
    },
  },
  {
    id: "boursorama",
    label: "Boursorama",
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
    label: "Revolut",
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
    label: "Ledger Live",
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
    label: "Coinbase",
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
    /*
      Trade Republic — le relevé réel est en néerlandais.

      Les alias anglais génériques ci-dessous ne rencontraient aucune de ses
      colonnes : `Datum`, `Transactietype`, `Waarde (netto)`, `Aantal`,
      `Kosten`, `Belasting`. Tout le fichier remontait sans date, sans type et
      sans montant. Les deux jeux cohabitent — un même compte peut produire
      l'un ou l'autre selon la langue choisie.
    */
    id: "trade_republic",
    label: "Trade Republic",
    description:
      "Export transactions (Datum, Transactietype, Waarde (netto), ISIN, Aantal, Kosten, Belasting)",
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
      // Relevé néerlandais
      datum: "date",
      transactietype: "type",
      waarde_netto: "cashAmount",
      waarde: "cashAmount",
      opmerking: "name",
      aantal: "quantity",
      kosten: "fees",
      /*
        `Belasting` est l'impôt retenu, distinct des frais de courtage. Le
        modèle n'a qu'une colonne de frais et l'y additionner mélangerait deux
        natures ; vide dans tous les relevés observés, elle est conservée en
        note plutôt que déclarée supportée.
      */
      belasting: "notes",
    },
  },
  {
    /*
      Trading 212 — trois devises peuvent cohabiter sur une seule ligne.

      `Price / share` est coté dans la devise du marché (USD, voire GBX pour
      Londres), `Total` dans celle du compte, et la retenue à la source dans
      une troisième. Chaque montant porte donc sa propre colonne de devise ;
      c'est `Currency (Total)` qui fait foi pour la trésorerie.
    */
    id: "trading212",
    label: "Trading 212",
    description:
      "Export Transactions (Action, Time, ISIN, Ticker, No. of shares, Price / share, Total, Withholding tax)",
    aliases: {
      action: "type",
      time: "date",
      isin: "ticker",
      ticker: "ignore",
      name: "name",
      no_of_shares: "quantity",
      price_share: "unitPrice",
      currency_price_share: "ignore",
      exchange_rate: "ignore",
      // Plus-value déjà réalisée, calculée par le courtier : une information
      // de suivi, pas un mouvement à importer.
      result: "ignore",
      currency_result: "ignore",
      total: "cashAmount",
      currency_total: "currency",
      withholding_tax: "ignore",
      currency_withholding_tax: "ignore",
      notes: "notes",
      id: "ignore",
      currency_conversion_fee: "fees",
      currency_currency_conversion_fee: "ignore",
    },
  },
  {
    /*
      XTB — tout tient dans `Comment`.

      Le relevé ne colonne ni quantité ni cours : ils sont écrits en clair,
      « OPEN BUY 34/42.5658 @ 11.7480 » — 34 titres exécutés sur un ordre de
      42,5658. Seul le nombre avant la barre est la quantité de la ligne.

      Il n'y a aucune colonne de devise : le compte n'en a qu'une, que le
      fichier n'énonce jamais.
    */
    id: "xtb",
    label: "XTB",
    description: "Export Cash Operations (ID, Type, Time, Symbol, Comment, Amount)",
    aliases: {
      id: "notes",
      type: "type",
      time: "date",
      symbol: "ticker",
      comment: "description",
      amount: "cashAmount",
    },
  },
  {
    id: "interactive_brokers",
    label: "Interactive Brokers",
    description:
      "Activity Statement IBKR (Trades/Transactions multi-sections FR/EN) ou CSV trades plat",
    aliases: {
      tradedate: "date",
      trade_date: "date",
      date_time: "date",
      date: "date",
      symbol: "ticker",
      buy_sell: "side",
      side: "side",
      operationtype: "type",
      quantity: "quantity",
      t_price: "unitPrice",
      t_price_: "unitPrice",
      price: "unitPrice",
      proceeds: "cashAmount",
      comm_fee: "fees",
      ibcommission: "fees",
      ib_commission: "fees",
      commission: "fees",
      currency: "currency",
      currencyprimary: "currency",
      description: "name",
      notes: "notes",
      assetclass: "assetClass",
      asset_class: "assetClass",
      /*
        Flex Query — l'autre façon dont IBKR exporte, à plat.

        Ces relevés ne colonnent pas `Symbol` mais `ISIN`, écrivent le cours
        sous `TradePrice` et le montant sous `TradeMoney` ; le relevé de
        dividendes a ses propres `Type` / `SettleDate` / `Amount`. Faute de ces
        alias, chaque ligne remontait sans date, sans actif et sans prix.
      */
      isin: "ticker",
      tradeprice: "unitPrice",
      trade_price: "unitPrice",
      trademoney: "cashAmount",
      trade_money: "cashAmount",
      settledate: "date",
      settle_date: "date",
      reportdate: "date",
      type: "type",
      amount: "cashAmount",
      // La devise de la commission peut différer de celle de l'opération :
      // conservée en note plutôt que confondue avec la devise du montant.
      ibcommissioncurrency: "notes",
    },
  },
  {
    id: "cryptocom",
    label: "Crypto.com — transactions",
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
      /*
        `To Currency` / `To Amount` ne décrivent pas la même jambe que
        `Currency` / `Amount` : ils sont lus directement dans la ligne brute
        par `map-rows`, qui en fait une seconde opération. Leur donner ici un
        rôle de colonne les aurait fait écraser la première jambe.
      */
      to_currency: "ignore",
      to_amount: "ignore",
      native_currency: "currency",
      // `Native Amount` est la contre-valeur en devise du compte : c'est le
      // montant de l'opération, pas une note. Sans lui, aucune conversion
      // n'avait de prix et toutes remontaient en erreur.
      native_amount: "cashAmount",
      native_amount_in_usd: "ignore",
      transaction_kind: "type",
      transaction_hash: "ignore",
    },
  },
  {
    id: "cryptocom_transfer",
    label: "Crypto.com — dépôts/retraits",
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
    label: "AscendEX",
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
    id: "paradex",
    label: "Paradex",
    description:
      "Export Fills Paradex pré-aplati (Date, Ticker, Side, Quantity, Price, Fee, Currency, Notes) — asset/type/strike extraits du champ market",
    aliases: {
      date: "date",
      ticker: "ticker",
      side: "side",
      quantity: "quantity",
      price: "unitPrice",
      fee: "fees",
      currency: "currency",
      notes: "notes",
    },
  },
  {
    id: "hyperliquid_trade",
    label: "Hyperliquid — transactions",
    description:
      "Export Trade History pré-aplati (Date, Ticker, Type, Quantity, Price, Fee, Currency)",
    aliases: {
      date: "date",
      ticker: "ticker",
      type: "type",
      quantity: "quantity",
      price: "unitPrice",
      fee: "fees",
      currency: "currency",
    },
  },
  {
    id: "hyperliquid_funding",
    label: "Hyperliquid — financement",
    description:
      "Export Funding History pré-aplati (Date, Ticker, Type, CashAmount, Currency, Notes)",
    aliases: {
      date: "date",
      ticker: "ticker",
      type: "type",
      cashamount: "cashAmount",
      currency: "currency",
      notes: "notes",
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
  /*
    Avanza — libellés suédois.

    `normalizeHeader` retire les diacritiques : « Köp » arrive donc en `kop`,
    « Sälj » en `salj`. Les deux orthographes sont enregistrées pour ne pas
    dépendre de ce détail de normalisation.

    `Övrigt` (« divers ») n'est délibérément pas mappé : il recouvre aussi bien
    un remboursement de frais qu'un échange de parts de fonds, et lui choisir
    un type unique serait une invention. Ces lignes remontent en avertissement.
  */
  kop: "ACHAT",
  köp: "ACHAT",
  salj: "VENTE",
  sälj: "VENTE",
  utdelning: "DIVIDENDE",
  ranta: "INTERET",
  ränta: "INTERET",
  insattning: "APPORT",
  insättning: "APPORT",
  uttag: "RETRAIT",
  "utlandsk kallskatt": "FRAIS",
  "utländsk källskatt": "FRAIS",
  /*
    DEGIRO — libellés du relevé, dans les langues où le compte les rend.

    Le rapprochement se fait par sous-chaîne, la plus longue d'abord : c'est ce
    qui fait que « Verkoop » l'emporte sur « Koop », et « Impôts sur dividende »
    sur « dividende ». Sans cet ordre, une vente serait lue comme un achat et un
    impôt comme un revenu.
  */
  koop: "ACHAT",
  compra: "ACHAT",
  verkoop: "VENTE",
  vendita: "VENTE",
  // « Kosten » couvre les trois libellés de frais du relevé : transaction,
  // aansluiting (connexion place de marché) et corporate action.
  kosten: "FRAIS",
  /*
    « Giro Exchange Connection Fee » contient « exchange », qui vaut ACHAT dans
    les exports crypto. Le libellé complet, plus long, l'emporte — sans quoi un
    abonnement annuel de 2,50 € entrait au portefeuille comme un achat.
  */
  "connection fee": "FRAIS",
  "impots sur dividende": "FRAIS",
  /*
    « Dividendbelasting » est la retenue à la source néerlandaise : un débit,
    toujours négatif. Le mot contient « dividend », qui l'emportait faute de
    plus long : l'impôt entrait en revenu, et le dividende était compté deux
    fois — une fois brut, une fois pour sa propre retenue.
  */
  dividendbelasting: "FRAIS",
  /*
    Retenue à la source IBKR : montant toujours négatif, et le libellé ne
    contient aucun mot déjà typé. Le repli libre en faisait un APPORT — la
    ligne s'ajoutait donc au patrimoine du montant qu'elle en retire.
  */
  "withholding tax": "FRAIS",
  /*
    eToro — les libellés de son relevé d'activité.

    « Open Position » / « Position closed » sont les deux sens d'un trade ;
    les autres sont des frais aux noms qui ne se devinent pas : SDRT est le
    droit de timbre britannique, « Overnight fee » le coût de portage d'un CFD.
    Sans ces alias, une ligne sur deux du relevé remontait non typée.
  */
  "open position": "ACHAT",
  "position closed": "VENTE",
  "withdraw request": "RETRAIT",
  "withdraw fee": "FRAIS",
  "withdrawal conversion fee": "FRAIS",
  "overnight fee": "FRAIS",
  // « interest payment » est déjà déclaré plus bas (BUX) : même libellé, même sens.
  sdrt: "FRAIS",
  /*
    Saxo & Swissquote — libellés d'opérations propres à ces deux relevés.

    « Custody Fee » / « Custody Fees » sont les droits de garde ; « Forex
    credit/debit » les deux jambes d'un change, exclues dans `map-rows`.
    « Debit » chez Swissquote désigne un retrait d'espèces, jamais un achat.
  */
  /*
    Trade Republic — libellés néerlandais du relevé.
    « Aankoop » / « Verkoop » cohabitent avec Buy / Sell dans un même fichier :
    la langue du relevé change avec celle de l'application, pas le compte.
  */
  aankoop: "ACHAT",
  storting: "APPORT",
  onttrekking: "RETRAIT",

  /*
    Trading 212 — « Market buy » contient « buy », mais « Stock split open »
    et « Transfer out » ne se devinent pas. Les scissions sont traitées à part
    dans `map-rows` : ce sont deux lignes de même valeur, pas deux mouvements.
  */
  "market buy": "ACHAT",
  "market sell": "VENTE",
  "limit buy": "ACHAT",
  "limit sell": "VENTE",
  "interest on cash": "INTERET",
  "transfer out": "TRANSFERT_TITRE",
  "transfer in": "TRANSFERT_TITRE",

  /*
    XTB — le type est colonné, mais dans la langue du compte : le même relevé
    mêle « Stocks/ETF purchase » et « Ações/ETF compra ».
  */
  "stocks/etf purchase": "ACHAT",
  "stocks/etf sale": "VENTE",
  "acoes/etf compra": "ACHAT",
  "acoes/etf vende": "VENTE",
  "free funds interests tax": "FRAIS",
  "free funds interests": "INTERET",

  "custody fee": "FRAIS",
  "custody fees": "FRAIS",
  "droits de garde": "FRAIS",
  // Variante portugaise de « Transactiekosten », déjà couverte en NL/FR/IT.
  "comissoes de transacao": "FRAIS",
  ingreso: "APPORT",
  retirada: "RETRAIT",
  levantamento: "RETRAIT",
  /*
    Directa — libellés italiens.

    Les retenues (`Rit.` / `Ritenuta`) sont plus longues que le revenu qu'elles
    ponctionnent, donc reconnues d'abord : « Rit.provento etf » est un
    prélèvement, pas un dividende.
  */
  acquisto: "ACHAT",
  "conferimento con bonifico": "APPORT",
  "provento etf": "DIVIDENDE",
  "rit.provento etf": "FRAIS",
  "cedola obb.": "COUPON",
  "rit.cedola obb.": "FRAIS",
  "coupon certif.": "COUPON",
  "ritenuta su plusvalenza": "FRAIS",
  ritenuta: "FRAIS",
  // BUX — le libellé exploitable est `Transaction Type`.
  "buy trade": "ACHAT",
  "sell trade": "VENTE",
  "cash dividend": "DIVIDENDE",
  "interest payment": "INTERET",
  "trading fee": "FRAIS",
  "subscription fee": "FRAIS",
  "sepa deposit": "APPORT",
  "sepa withdrawal": "RETRAIT",
  // AscendEX
  compound: "REWARD",
  regular_redemption: "RETRAIT",
  regularredemption: "RETRAIT",
};

const EXACT_TX_TYPES = new Set<TxType>([
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
]);

export function mapTxType(raw: string | undefined | null, side?: string | null): TxType | null {
  // Une valeur déjà résolue (ex. colonne "type" dédiée — OperationType IBKR)
  // est prioritaire absolue : ne jamais la re-parser via "side" ni l'écraser
  // avec null (un Buy/Sell ambigu ne doit pas invalider un type déjà correct).
  if (raw) {
    const upperRaw = raw.trim().toUpperCase();
    if (EXACT_TX_TYPES.has(upperRaw as TxType)) {
      return upperRaw as TxType;
    }
  }
  if (side) {
    const s = side.trim().toLowerCase();
    if (["buy", "achat", "b"].includes(s)) return "ACHAT";
    if (["sell", "vente", "s"].includes(s)) return "VENTE";
    if (["dividend", "dividende", "div"].includes(s)) return "DIVIDENDE";
    if (["deposit", "depot", "apport", "topup", "top_up"].includes(s))
      return "APPORT";
    if (["withdrawal", "retrait", "withdraw"].includes(s)) return "RETRAIT";
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

  // Priorité de détection (spécifique → générique) :
  // Paradex > Nexo > Hyperliquid Funding > Hyperliquid Trades > IBKR > reste
  if (has("fill_type") && has("realized_funding")) return "paradex";
  /*
    Bitpanda — « Amount Fiat » et « Amount Asset » côte à côte ne se
    rencontrent nulle part ailleurs : le fichier sépare la somme engagée de la
    quantité reçue. Sans cette règle il se faisait passer pour un export
    Coinbase, sur le seul mot `Timestamp`.
  */
  if (hasAny("amount_fiat") && hasAny("amount_asset", "asset_class")) {
    return "bitpanda";
  }
  /*
    Bybit — quatre exports, une signature chacun. Le compte spot se reconnaît à
    `Wallet Balance` ; les exports dérivés à leurs colonnes de contrats. Tous
    passent par le même format, qui écarte les dérivés en le disant.
  */
  if (hasAny("wallet_balance") && hasAny("coin", "currency")) {
    return "bybit";
  }
  if (hasAny("contracts") && hasAny("closed_p_l", "filled_qty", "leverage")) {
    return "bybit";
  }
  /*
    Revolut crypto — `Fiat amount` et `Base currency` n'existent que sur ce
    relevé. Le relevé bancaire, qui partage tous ses autres en-têtes, ne les a
    pas : c'est ce qui permet de ne pas les confondre.
  */
  if (hasAny("fiat_amount") && hasAny("base_currency")) {
    return "revolut_crypto";
  }
  // Nexo — avant Hyperliquid/Binance (signature "Transaction" NXT très spécifique)
  if (
    has("transaction") &&
    has("type") &&
    hasAny("date_time", "date_time_utc")
  ) {
    return "nexo";
  }
  // Hyperliquid Funding History — headers exacts
  if (has("time") && has("coin") && has("side") && has("payment") && has("rate")) {
    return "hyperliquid_funding";
  }
  // Hyperliquid Trade History — headers exacts
  if (
    has("time") &&
    has("coin") &&
    has("dir") &&
    has("px") &&
    has("sz") &&
    has("closedpnl")
  ) {
    return "hyperliquid_trade";
  }
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
  // Crypto.com Deposit / Withdrawal / Supercharger
  if (
    hasAny("time_utc", "time") &&
    has("coin") &&
    hasAny("deposit_amount", "withdrawal_amount")
  ) {
    return "cryptocom_transfer";
  }
  /*
    `SUPERCHARGER_REWARDS.csv` n'a que trois colonnes — Time (UTC), Coin,
    Amount — et aucun montant nommé « deposit » ou « withdrawal ». Il tombait
    donc sur le format générique et remontait sans date ni type. Le trio est
    assez court et assez particulier pour signer ce fichier à lui seul.
  */
  if (keys.length === 3 && hasAny("time_utc") && has("coin") && has("amount")) {
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
  /*
    eToro — `Position ID` et `Realized Equity` n'existent nulle part ailleurs.

    Ses autres colonnes (Date, Type, Amount…) sont trop banales pour signer un
    format : c'est le couple identifiant-de-position / capitaux-réalisés qui le
    distingue, et il est assez spécifique pour ne reconnaître aucun autre
    courtier par erreur.
  */
  if (hasAny("position_id") && hasAny("realized_equity", "realized_equity_change")) {
    return "etoro";
  }
  /*
    Saxo — `Instrument ISIN` et `Instrument currency` sont préfixés, ce qu'aucun
    autre relevé ne fait, et `Event` porte l'opération en toutes lettres.
  */
  if (hasAny("instrument_isin", "instrument_currency") && hasAny("event")) {
    return "saxo";
  }
  /*
    Swissquote — le trio `Accrued Interest` / `Net Amount` / `Unit price` ne se
    rencontre nulle part ailleurs. `Net Amount` seul serait trop faible : c'est
    le coupon couru, colonne de relevé de titres suisse, qui signe le format.
  */
  if (hasAny("accrued_interest") && hasAny("net_amount", "unit_price")) {
    return "swissquote";
  }
  /*
    Trading 212 — chaque montant y porte sa propre colonne de devise, ce que
    ne fait aucun autre relevé : « Currency (Total) », « Currency (Price /
    share) ». Le couple avec `No. of shares` suffit à le signer.
  */
  if (hasAny("currency_total") && hasAny("no_of_shares", "price_share")) {
    return "trading212";
  }
  /*
    XTB — six colonnes seulement, dont `Comment` qui porte toute la
    transaction. La combinaison Type + Comment + Amount lui est propre.
  */
  if (has("comment") && has("type") && has("amount") && has("time")) {
    return "xtb";
  }
  /*
    Trade Republic néerlandais — `Transactietype` ne se rencontre nulle part
    ailleurs. Sans cette règle, le relevé tombait sur le repli « ISIN » et se
    faisait passer pour un export Boursorama.
  */
  if (hasAny("transactietype") || hasAny("waarde_netto")) {
    return "trade_republic";
  }
  if (
    hasAny("ib_commission", "ibcommission", "t_price") &&
    hasAny("symbol", "tradedate", "trade_date", "buy_sell")
  ) {
    return "interactive_brokers";
  }
  /*
    Flex Query IBKR de dividendes : aucune commission, donc aucune des
    signatures ci-dessus. `CurrencyPrimary` est propre à IBKR ; sans cette
    règle le fichier tombait sur le repli « ISIN » et se faisait passer pour
    un relevé Boursorama.
  */
  if (hasAny("currencyprimary") && hasAny("settledate", "isin", "tradedate")) {
    return "interactive_brokers";
  }
  // Activity Statement aplati (headers synthétiques)
  if (
    has("tradedate") &&
    has("symbol") &&
    hasAny("buy_sell", "t_price", "ibcommission")
  ) {
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
