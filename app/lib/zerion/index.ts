/**
 * Zerion Wallet API — multi-chaînes EVM (hors Solana Helius, hors Monero).
 * @see https://developers.zerion.io/api-reference/wallets
 */

export {
  ZERION_CHAINS,
  ZERION_HELP_MESSAGE,
  DEFAULT_ZERION_API_KEY,
  getZerionChain,
  isZerionPreset,
  type ZerionChainDef,
} from "./chains";
export { formatParisDateTime, toOccurredAtIso } from "./datetime";
export {
  resolveZerionApiKey,
  fetchZerionPositions,
  fetchZerionTransactions,
  fetchZerionPortfolio,
  ZerionError,
  ZERION_HISTORY_TRUNCATED_MESSAGE,
  type ZerionBalanceItem,
  type ZerionTxItem,
  type ZerionPortfolio,
  type ZerionTxFetchResult,
} from "./client";
export {
  fetchMoneroMetaFromCoinGecko,
  buildMoneroSnapshot,
  type MoneroMeta,
  type MoneroBalanceSnapshot,
} from "./monero";
export {
  writeZerionBalancesToLedger,
  writeZerionHistoryToLedger,
  writeMoneroBalanceToLedger,
  repairZerionReconciliationDates,
  buildZerionFirstSeenMap,
  ZERION_SYNC_NOTE_TAG,
  ZERION_TX_NOTE_PREFIX,
  MONERO_SYNC_NOTE_TAG,
} from "./ledger-sync";
