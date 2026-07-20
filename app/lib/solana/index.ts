/**
 * Intégration Solana — RPC natif uniquement (@solana/web3.js).
 * @see docs/solana-rpc.md
 */

export { isSolanaAddress, shortSolanaAddress } from "./address";
export {
  getSolanaConnection,
  getSolanaRpcUrl,
  resetSolanaConnection,
  SOLANA_INITIAL_SIG_LIMIT,
  SOLANA_INCREMENTAL_SIG_LIMIT,
} from "./rpc-client";
export { fetchWalletBalanceSnapshot } from "./wallet-balances";
export { syncWalletTransactions } from "./sync-service";
export { parseSolanaTransaction } from "./transaction-parse";
export { syncSolanaWalletFull } from "./wallet-service";
export type {
  SolanaPortfolioSnapshot,
  SolanaTokenHolding,
  SolanaParsedOnchainTx,
  SolanaTxSyncResult,
  SolanaSyncBundle,
} from "./types";
export { SolanaRpcError } from "./types";

/** @deprecated alias pour compat imports UI */
export type SolscanPortfolioSnapshot = import("./types").SolanaPortfolioSnapshot;
