/**
 * Deux lectures wallet Solana qui ne doivent jamais se convertir en zéro :
 *
 *  - un transfert Solscan dont le payload n'indique pas les décimales du mint
 *    (un montant en unités de base publié tel quel donnerait 1 000 000 pour
 *    1 USDC) ;
 *  - un RPC injoignable après retries (une liste de comptes tokens vide
 *    ferait croire « SOL seul, aucun SPL »).
 *
 * Fetch mocké selon la convention de `tests/unit/crypto/nft-wallet-providers.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  solscanAccountTransfers,
  getLastSolscanError,
  __resetSolscanCircuit,
} from "@/app/lib/solana/solscan-client";
import { SolanaRpcError } from "@/app/lib/solana/types";

const WALLET = "5QQuBjEBuHCAKUcE2c9DbVr3r2w3pnJg93eqVjf4tKnf";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ORIGINAL_SOLSCAN_KEY = process.env.SOLSCAN_API_KEY;
const ORIGINAL_MIN_INTERVAL = process.env.SOLANA_RPC_MIN_INTERVAL_MS;

/** Connection dont tous les appels tokens échouent (RPC injoignable). */
vi.mock("@solana/web3.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@solana/web3.js")>();
  return {
    ...actual,
    Connection: class {
      async getBalance() {
        return 0;
      }
      async getParsedTokenAccountsByOwner() {
        throw new Error("socket hang up");
      }
    },
  };
});

function stubFetch(body: unknown, status = 200) {
  const spy = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** Une page /account/transfer avec un seul transfert d'1 USDC (6 décimales). */
function oneUsdcTransfer(decimals: number | undefined | null) {
  return {
    success: true,
    data: [
      {
        trans_id: "sig-usdc-1",
        block_time: 1710505845,
        token_address: USDC,
        // 1 USDC en unités de base
        amount: 1_000_000,
        flow: "in",
        activity_type: "ACTIVITY_SPL_TRANSFER",
        ...(decimals === undefined ? {} : { token_decimals: decimals }),
      },
    ],
  };
}

beforeEach(() => {
  process.env.SOLSCAN_API_KEY = "x".repeat(40);
  process.env.SOLANA_RPC_MIN_INTERVAL_MS = "0";
  __resetSolscanCircuit();
});

afterEach(() => {
  vi.unstubAllGlobals();
  __resetSolscanCircuit();
  if (ORIGINAL_SOLSCAN_KEY === undefined) delete process.env.SOLSCAN_API_KEY;
  else process.env.SOLSCAN_API_KEY = ORIGINAL_SOLSCAN_KEY;
  if (ORIGINAL_MIN_INTERVAL === undefined)
    delete process.env.SOLANA_RPC_MIN_INTERVAL_MS;
  else process.env.SOLANA_RPC_MIN_INTERVAL_MS = ORIGINAL_MIN_INTERVAL;
});

describe("solscanAccountTransfers — décimales du mint", () => {
  it("convertit avec les décimales fournies : 1 USDC reste 1", async () => {
    stubFetch(oneUsdcTransfer(6));
    const out = await solscanAccountTransfers(WALLET, { maxPages: 1 });
    expect(out).toHaveLength(1);
    expect(out?.[0]?.amountUi).toBe(1);
  });

  it("ne publie pas un montant quand les décimales sont absentes du payload", async () => {
    stubFetch(oneUsdcTransfer(undefined));
    const out = await solscanAccountTransfers(WALLET, { maxPages: 1 });
    expect(out).toHaveLength(0);
    expect(out?.some((t) => t.amountUi === 1_000_000)).toBe(false);
    expect(getLastSolscanError()).toMatch(/décimales/i);
  });

  it("traite un 0 explicite comme une vraie valeur (token sans décimale)", async () => {
    stubFetch(oneUsdcTransfer(0));
    const out = await solscanAccountTransfers(WALLET, { maxPages: 1 });
    expect(out?.[0]?.amountUi).toBe(1_000_000);
    expect(getLastSolscanError()).toBeNull();
  });
});

describe("rpcGetTokenAccountsByOwner — RPC injoignable", () => {
  it("lève une erreur explicite plutôt que de rendre zéro compte token", async () => {
    const { rpcGetTokenAccountsByOwner, resetSolanaConnection } = await import(
      "@/app/lib/solana/rpc-client"
    );
    resetSolanaConnection();
    await expect(rpcGetTokenAccountsByOwner(WALLET)).rejects.toBeInstanceOf(
      SolanaRpcError
    );
  });

  it("le snapshot wallet ne rend pas « SOL seul » quand les SPL n'ont pas pu être lus", async () => {
    const { fetchWalletBalanceSnapshot } = await import(
      "@/app/lib/solana/wallet-balances"
    );
    const { resetSolanaConnection } = await import("@/app/lib/solana/rpc-client");
    resetSolanaConnection();
    await expect(fetchWalletBalanceSnapshot(WALLET)).rejects.toBeInstanceOf(
      SolanaRpcError
    );
  });
});
