/**
 * Types standard d'import CSV (couche adaptateurs).
 * Les drafts UI (`ImportDraftRow`) restent le format "riche" pour commit.
 */

/** Type normalisé demandé par le contrat d'import dynamique */
export type CanonicalTxKind = "BUY" | "SELL" | "DIVIDEND" | "OTHER";

/**
 * Objet transaction standardisé produit par chaque adaptateur de plateforme.
 * @see consigne import_csv
 */
export type TransactionImport = {
  /** Date et heure de transaction */
  date: Date;
  type: CanonicalTxKind;
  ticker: string;
  quantity: number;
  price: number;
  fees?: number;
  /** Métadonnées optionnelles pour le commit Patrimo */
  currency?: string;
  name?: string;
  cashAmount?: number;
  notes?: string;
  rawType?: string;
  line?: number;
};

/** Rôles de colonnes reconnus par le moteur de mapping */
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
  | "side"
  | "description"
  | "product"
  | "ignore";

export type ColumnMapping = Record<string, ColumnRole>;

export type MappingConfidence = "high" | "medium" | "low" | "none";

export type HeaderMatchResult = {
  columnMap: ColumnMapping;
  /** Rôles obligatoires absents : date, type|side, ticker|name, quantity, unitPrice|cashAmount */
  missingRoles: ColumnRole[];
  confidence: MappingConfidence;
  /** Score 0–100 */
  score: number;
  matchedRoles: ColumnRole[];
};

export type PlatformAdapterId =
  | "patrimo"
  | "generic"
  | "dynamic"
  | "binance"
  | "boursorama"
  | "revolut"
  | "coinbase"
  | "fortuneo"
  | "trade_republic"
  | "interactive_brokers";

export type PlatformAdapterMeta = {
  id: PlatformAdapterId;
  label: string;
  description: string;
};

export type AdapterParseInput = {
  headers: string[];
  rows: Record<string, string>[];
  /** Mapping forcé (manuel ou sauvegardé) */
  columnMap?: ColumnMapping;
};

export type AdapterParseResult = {
  transactions: TransactionImport[];
  columnMap: ColumnMapping;
  warnings: string[];
  /** Si true, l'UI doit proposer le mapping manuel */
  needsManualMapping: boolean;
  confidence: MappingConfidence;
};

/**
 * Contrat Strategy Pattern : un adaptateur par plateforme.
 */
export interface PlatformCsvAdapter {
  readonly meta: PlatformAdapterMeta;
  /**
   * Score de reconnaissance (0–100) à partir des en-têtes.
   * 0 = non applicable.
   */
  detect(headers: string[]): number;
  /** Parse les lignes CSV brutes → TransactionImport[] */
  parse(input: AdapterParseInput): AdapterParseResult;
}
