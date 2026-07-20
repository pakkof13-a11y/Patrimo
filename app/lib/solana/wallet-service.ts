/**
 * Orchestration wallet Solana : snapshot soldes + sync txs incrémentale + ledger.
 */

import { fetchWalletBalanceSnapshot } from "./wallet-balances";
import { syncWalletTransactions, type SyncTxOptions } from "./sync-service";
import { writeSolanaSnapshotToLedger } from "@/app/lib/market/solana-ledger-sync";
import type { SolanaPortfolioSnapshot, SolanaTxSyncResult } from "./types";
import type { SolanaLedgerSyncResult } from "@/app/lib/market/solana-ledger-sync";
import { isSolanaAddress } from "./address";
import { SolanaRpcError } from "./types";

export type FullWalletSyncResult = {
  snapshot: SolanaPortfolioSnapshot;
  txSync: SolanaTxSyncResult | null;
  ledger: SolanaLedgerSyncResult | null;
  ledgerError: string | null;
};

/**
 * Sync wallet rattaché à une plateforme.
 * 1) soldes RPC (toujours)
 * 2) txs on-chain (défaut **true** — stockées + journal si writeLedger)
 * 3) écriture ledger positions (réconciliation soldes)
 *
 * Désactiver l’historique : `syncTransactions: false`.
 */
export async function syncSolanaWalletFull(
  userId: string,
  platformId: string,
  address: string,
  opts?: {
    writeLedger?: boolean;
    /** Défaut true — récupère l’historique on-chain */
    syncTransactions?: boolean;
    txOpts?: SyncTxOptions;
  }
): Promise<FullWalletSyncResult> {
  if (!isSolanaAddress(address)) {
    throw new SolanaRpcError("Adresse Solana invalide", "INVALID_ADDRESS");
  }

  const snapshot = await fetchWalletBalanceSnapshot(address);

  let txSync: SolanaTxSyncResult | null = null;
  // Défaut : récupérer les transactions (positions seules = opt-out)
  if (opts?.syncTransactions !== false) {
    try {
      txSync = await syncWalletTransactions(userId, platformId, opts?.txOpts);
    } catch (e) {
      console.warn(
        "[solana-wallet] tx sync",
        e instanceof Error ? e.message : e
      );
      txSync = {
        fetchedSignatures: 0,
        newTransactions: 0,
        skippedKnown: 0,
        parseErrors: 0,
        lastKnownSignature: null,
        initial: false,
        truncated: false,
        notice:
          e instanceof Error
            ? `Sync txs partielle : ${e.message}`
            : "Sync txs partielle",
      };
    }
  }

  let ledger: SolanaLedgerSyncResult | null = null;
  let ledgerError: string | null = null;
  if (opts?.writeLedger !== false) {
    try {
      // 1a) Solscan account/transfer (dates block_time) si clé/plan OK
      if (opts?.syncTransactions !== false) {
        try {
          const { importSolscanTransfersToLedger } = await import(
            "@/app/lib/market/solana-solscan-import"
          );
          await importSolscanTransfersToLedger(userId, platformId, address);
        } catch (e) {
          console.warn(
            "[solana-wallet] solscan transfers",
            e instanceof Error ? e.message : e
          );
        }
      }
      // 1b) Journal depuis txs RPC déjà stockées (date = blockTime)
      if (opts?.syncTransactions !== false) {
        const { writeOnchainTxsToLedger } = await import(
          "@/app/lib/market/solana-onchain-to-ledger"
        );
        await writeOnchainTxsToLedger(userId, platformId, { limit: 150 });
      }
      // 2) Réconciliation soldes (dates historiques si 1er fill)
      ledger = await writeSolanaSnapshotToLedger(userId, platformId, snapshot);
    } catch (e) {
      ledgerError =
        e instanceof Error ? e.message : "Échec écriture positions ledger";
      console.error("[solana-wallet ledger]", ledgerError);
    }
  }

  return { snapshot, txSync, ledger, ledgerError };
}

export { fetchWalletBalanceSnapshot, isSolanaAddress };
