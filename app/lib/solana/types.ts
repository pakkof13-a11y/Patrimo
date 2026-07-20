/**
 * Types domaine Solana (RPC natif) — plus de Solscan.
 */

export type SolanaTokenHolding = {
  tokenAddress: string | null;
  symbol: string;
  name: string;
  balance: string;
  decimals: number;
  priceUsd: number | null;
  valueUsd: number | null;
  icon: string | null;
  isNative: boolean;
};

/** Snapshot portefeuille courant (soldes) — alimente UI + ledger. */
export type SolanaPortfolioSnapshot = {
  address: string;
  totalValueUsd: number | null;
  native: SolanaTokenHolding | null;
  tokens: SolanaTokenHolding[];
  fetchedAt: string;
  source: "solana-rpc";
  notice?: string | null;
};

export type SolanaTransferSummary = {
  kind: "SOL" | "SPL";
  direction: "in" | "out" | "self" | "unknown";
  mint?: string | null;
  amount: string;
  decimals?: number;
  from?: string | null;
  to?: string | null;
};

export type SolanaParsedOnchainTx = {
  signature: string;
  slot: number | null;
  blockTime: Date | null;
  status: "success" | "failed" | "unknown";
  /** Frais réseau en SOL (lamports / 1e9) */
  feeSol: string | null;
  feeLamports: number | null;
  programIds: string[];
  /** Programme le plus « principal » (1er non-system si possible) */
  primaryProgramId: string | null;
  transfers: SolanaTransferSummary[];
  /** Type fonctionnel grossier */
  functionalType:
    | "TRANSFER"
    | "SWAP_LIKE"
    | "STAKE_LIKE"
    | "UNKNOWN"
    | "FAILED";
  err: string | null;
};

export type SolanaSyncCursor = {
  lastKnownSignature: string | null;
  lastSyncedAt: Date | null;
};

export type SolanaTxSyncResult = {
  fetchedSignatures: number;
  newTransactions: number;
  skippedKnown: number;
  parseErrors: number;
  lastKnownSignature: string | null;
  initial: boolean;
  truncated: boolean;
  notice?: string | null;
};

export type SolanaSyncBundle = {
  snapshot: SolanaPortfolioSnapshot;
  txSync: SolanaTxSyncResult | null;
};

export class SolanaRpcError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_ADDRESS"
      | "RPC_UNAVAILABLE"
      | "RATE_LIMITED"
      | "PARSE"
      | "CONFIG"
  ) {
    super(message);
    this.name = "SolanaRpcError";
  }
}
