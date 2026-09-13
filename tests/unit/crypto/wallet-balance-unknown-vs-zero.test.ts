/**
 * CRY-01 / CRY-04 — ce qu'un wallet détient, et quand on ne peut pas le savoir.
 *
 * CRY-01 : un fournisseur qui échoue (RPC Solana injoignable, Zerion HTTP en
 * erreur) ne rend pas « 0 € ». Le solde est UNKNOWN et remonte comme une
 * erreur nommée ; un wallet voisin dont le fournisseur répond réellement
 * « balance 0 » reste, lui, affiché à 0 — les deux ne se confondent pas.
 *
 * CRY-04 : des décimales absentes du payload rendent un montant illisible.
 * La ligne est écartée et déclarée (log + notice), jamais convertie en
 * quantité supposée. Un `decimals: 0` réellement rendu par le RPC reste un
 * zéro légitime (NFT Metaplex, spam de même forme, token sans décimale).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedTransactionWithMeta } from "@solana/web3.js";
import { SolanaRpcError } from "@/app/lib/solana/types";
import { parseSolanaTransaction } from "@/app/lib/solana/transaction-parse";

const rpcGetBalance = vi.fn();
const rpcGetTokenAccountsByOwner = vi.fn();
const fetchCoingeckoSimplePrices = vi.fn();
const fetchSolanaMintPricesUsd = vi.fn();

vi.mock("@/app/lib/solana/rpc-client", () => ({
  rpcGetBalance: (...a: unknown[]) => rpcGetBalance(...a),
  rpcGetTokenAccountsByOwner: (...a: unknown[]) =>
    rpcGetTokenAccountsByOwner(...a),
}));
vi.mock("@/app/lib/market/providers/coingecko", () => ({
  fetchCoingeckoSimplePrices: (...a: unknown[]) =>
    fetchCoingeckoSimplePrices(...a),
  fetchSolanaMintPricesUsd: (...a: unknown[]) => fetchSolanaMintPricesUsd(...a),
}));
vi.mock("@/app/lib/solana/token-meta", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/lib/solana/token-meta")>();
  return { ...actual, resolveSolanaMintMetas: vi.fn(async () => new Map()) };
});

const { fetchWalletBalanceSnapshot } = await import(
  "@/app/lib/solana/wallet-balances"
);
const { fetchZerionPositions, ZerionError } = await import(
  "@/app/lib/zerion/client"
);

const WALLET = "5QQuBjEBuHCAKUcE2c9DbVr3r2w3pnJg93eqVjf4tKnf";
const EMPTY_WALLET = "6dPTbfUCsUZ8HE6XtJ4bHQfJ1Ym8NaRLRaRnDHCEsGU7";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NFT_MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const SPAM_MINT = "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E";
const EVM = "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb00";

type Amt = {
  uiAmountString?: string;
  uiAmount?: number | null;
  decimals?: number;
  amount?: string;
};

function account(mint: string, tokenAmount: Amt) {
  return {
    pubkey: { toBase58: () => `ta-${mint.slice(0, 6)}` },
    account: { data: { parsed: { info: { mint, tokenAmount } } } },
  };
}

beforeEach(() => {
  rpcGetBalance.mockReset().mockResolvedValue(2_000_000_000); // 2 SOL
  rpcGetTokenAccountsByOwner.mockReset().mockResolvedValue([]);
  fetchCoingeckoSimplePrices.mockReset().mockResolvedValue({
    solana: { usd: 100 },
    "usd-coin": { usd: 1 },
    tether: { usd: 1 },
  });
  fetchSolanaMintPricesUsd.mockReset().mockResolvedValue(new Map());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CRY-01 — échec fournisseur ≠ solde nul (Solana)", () => {
  it("getBalance en échec : le solde remonte en erreur nommée, pas en 0", async () => {
    rpcGetBalance.mockRejectedValue(
      new SolanaRpcError(
        "RPC Solana indisponible (getBalance): fetch failed",
        "RPC_UNAVAILABLE"
      )
    );

    const err = await fetchWalletBalanceSnapshot(WALLET).catch((e) => e);
    expect(err).toBeInstanceOf(SolanaRpcError);
    expect((err as SolanaRpcError).message).toMatch(/RPC Solana/i);
    expect((err as SolanaRpcError).code).toBe("RPC_UNAVAILABLE");
  });

  it("comptes tokens en échec : aucun snapshot SOL-seul n'est publié", async () => {
    rpcGetTokenAccountsByOwner.mockRejectedValue(
      new SolanaRpcError(
        "RPC Solana rate-limité (getTokenAccountsByOwner(SPL)).",
        "RATE_LIMITED"
      )
    );

    await expect(fetchWalletBalanceSnapshot(WALLET)).rejects.toBeInstanceOf(
      SolanaRpcError
    );
  });

  it("lamports hors contrat (ni nombre ni erreur) : indisponible, pas zéro", async () => {
    rpcGetBalance.mockResolvedValue(undefined);

    const err = await fetchWalletBalanceSnapshot(WALLET).catch((e) => e);
    expect(err).toBeInstanceOf(SolanaRpcError);
    expect((err as SolanaRpcError).message).toMatch(/getBalance/);
    expect((err as SolanaRpcError).message).toMatch(/non nul/i);
  });

  it("le wallet voisin réellement vide reste à 0 (et n'est pas confondu)", async () => {
    rpcGetBalance.mockResolvedValue(0);
    rpcGetTokenAccountsByOwner.mockResolvedValue([]);

    const snap = await fetchWalletBalanceSnapshot(EMPTY_WALLET);
    expect(snap.native?.balance).toBe("0");
    expect(snap.native?.valueUsd).toBe(0);
    expect(snap.totalValueUsd).toBe(0);
    expect(snap.tokens).toEqual([]);
  });

  it("prix indisponibles : valorisation inconnue (null) et lecture déclarée", async () => {
    fetchCoingeckoSimplePrices.mockRejectedValue(new Error("HTTP 429"));
    fetchSolanaMintPricesUsd.mockRejectedValue(new Error("HTTP 429"));
    rpcGetTokenAccountsByOwner.mockResolvedValue([
      account(USDC, { uiAmountString: "10", decimals: 6, amount: "10000000" }),
    ]);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const snap = await fetchWalletBalanceSnapshot(WALLET);
    // Les quantités ont été lues ; seules les valeurs manquent → null, pas 0
    expect(snap.tokens[0]?.balance).toBe("10");
    expect(snap.tokens[0]?.valueUsd).toBeNull();
    expect(snap.native?.valueUsd).toBeNull();
    expect(snap.totalValueUsd).toBeNull();
    expect(snap.notice ?? "").toMatch(/CoinGecko/i);
  });
});

describe("CRY-01 — échec fournisseur ≠ solde nul (Zerion)", () => {
  it("HTTP 502 Zerion : erreur nommée, jamais une liste de soldes vide", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 502,
        json: async () => ({}),
        text: async () => "bad gateway",
      }))
    );

    const err = await fetchZerionPositions(EVM, "k".repeat(20)).catch((e) => e);
    expect(err).toBeInstanceOf(ZerionError);
    expect((err as InstanceType<typeof ZerionError>).message).toMatch(
      /Zerion HTTP 502/
    );
  });

  it("timeout réseau Zerion : erreur nommée, pas de solde nul", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("The operation was aborted due to timeout");
      })
    );

    const err = await fetchZerionPositions(EVM, "k".repeat(20)).catch((e) => e);
    expect(err).toBeInstanceOf(ZerionError);
    expect((err as InstanceType<typeof ZerionError>).message).toMatch(
      /timeout/i
    );
  });

  it("wallet réellement vide : Zerion répond, la liste vide est un constat", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
        text: async () => "",
      }))
    );

    await expect(fetchZerionPositions(EVM, "k".repeat(20))).resolves.toEqual([]);
  });

  it("position sans quantité dans le payload : écartée, pas comptée à 0", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: "pos-1",
              attributes: {
                name: "Mystery",
                value: 42,
                fungible_info: { symbol: "MYS", name: "Mystery" },
              },
            },
          ],
        }),
        text: async () => "",
      }))
    );

    const out = await fetchZerionPositions(EVM, "k".repeat(20));
    expect(out).toEqual([]);
    expect(JSON.stringify(warn.mock.calls.flat())).toMatch(/quantité absente/i);
  });
});

describe("CRY-04 — décimales absentes : ligne écartée, jamais supposée", () => {
  it("un token sans decimals n'entre pas dans le solde et est journalisé", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    rpcGetTokenAccountsByOwner.mockResolvedValue([
      account(USDC, { uiAmountString: "10", decimals: 6, amount: "10000000" }),
      // Décimales absentes : 1 000 000 unités de base, illisible tel quel
      account(SPAM_MINT, { uiAmountString: "1000000", amount: "1000000" }),
    ]);

    const snap = await fetchWalletBalanceSnapshot(WALLET);

    expect(snap.tokens.map((t) => t.tokenAddress)).toEqual([USDC]);
    // Aucune quantité fabriquée pour le mint sans décimales
    expect(snap.tokens.some((t) => t.balance === "1000000")).toBe(false);
    expect(snap.notice ?? "").toMatch(/décimales absentes du RPC Solana/i);
    const logged = JSON.stringify(warn.mock.calls.flat());
    expect(logged).toMatch(/décimales absentes/i);
    expect(logged).toContain(SPAM_MINT);
    expect(logged).toContain("solana-rpc");
  });

  it("decimals: 0 réellement rendu reste traité normalement", async () => {
    rpcGetTokenAccountsByOwner.mockResolvedValue([
      account(SPAM_MINT, { uiAmountString: "5", decimals: 0, amount: "5" }),
    ]);

    const snap = await fetchWalletBalanceSnapshot(WALLET);
    expect(snap.tokens.map((t) => t.tokenAddress)).toEqual([SPAM_MINT]);
    expect(snap.tokens[0]?.decimals).toBe(0);
    expect(snap.tokens[0]?.balance).toBe("5");
    expect(snap.notice ?? "").not.toMatch(/décimales absentes/i);
  });

  it("la détection NFT/spam Metaplex (0 décimale, 1 unité, non coté) est intacte", async () => {
    rpcGetTokenAccountsByOwner.mockResolvedValue([
      account(USDC, { uiAmountString: "10", decimals: 6, amount: "10000000" }),
      account(NFT_MINT, { uiAmountString: "1", decimals: 0, amount: "1" }),
    ]);

    const snap = await fetchWalletBalanceSnapshot(WALLET);
    expect(snap.tokens.map((t) => t.tokenAddress)).toEqual([USDC]);
    expect(snap.notice ?? "").toMatch(/1 compte\(s\) token à 1 unité/);
    expect(snap.notice ?? "").not.toMatch(/décimales absentes/i);
  });

  it("montant UI absent mais amount + décimales connues : recomposé, pas écarté", async () => {
    rpcGetTokenAccountsByOwner.mockResolvedValue([
      // Ni uiAmountString ni uiAmount : 1 USDC en unités de base
      account(USDC, { uiAmount: null, decimals: 6, amount: "1000000" }),
    ]);

    const snap = await fetchWalletBalanceSnapshot(WALLET);
    expect(snap.tokens[0]?.balance).toBe("1");
    expect(snap.tokens[0]?.valueUsd).toBe(1);
  });
});

describe("CRY-04 — jambes de transaction sans décimales", () => {
  function tx(pre: unknown[], post: unknown[]): ParsedTransactionWithMeta {
    return {
      slot: 42,
      blockTime: 1_700_000_000,
      meta: {
        err: null,
        fee: 5000,
        preBalances: [],
        postBalances: [],
        preTokenBalances: pre,
        postTokenBalances: post,
      },
      transaction: {
        signatures: ["sigAAAAAAAA"],
        message: { accountKeys: [], instructions: [] },
      },
    } as unknown as ParsedTransactionWithMeta;
  }

  const bal = (amt: Amt) => ({
    accountIndex: 1,
    mint: USDC,
    owner: WALLET,
    uiTokenAmount: amt,
  });

  it("jambe lisible : delta pre/post publié avec ses décimales", () => {
    const p = parseSolanaTransaction(
      "sigAAAAAAAA",
      WALLET,
      tx(
        [bal({ uiAmountString: "1", decimals: 6, amount: "1000000" })],
        [bal({ uiAmountString: "3", decimals: 6, amount: "3000000" })]
      )
    );
    expect(p.transfers).toHaveLength(1);
    expect(p.transfers[0]).toMatchObject({
      kind: "SPL",
      direction: "in",
      amount: "2",
      decimals: 6,
    });
  });

  it("décimales absentes d'un relevé : jambe écartée + log nommant le RPC", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = parseSolanaTransaction(
      "sigAAAAAAAA",
      WALLET,
      tx(
        [bal({ uiAmountString: "1", decimals: 6, amount: "1000000" })],
        // Décimales perdues côté post : le delta serait inventé
        [bal({ amount: "3000000", uiAmount: null })]
      )
    );
    expect(p.transfers).toEqual([]);
    expect(p.functionalType).toBe("UNKNOWN");
    const logged = JSON.stringify(warn.mock.calls.flat());
    expect(logged).toMatch(/solana-rpc/);
    expect(logged).toContain(USDC);
  });

  it("montant UI absent mais décimales connues : recomposé depuis amount", () => {
    const p = parseSolanaTransaction(
      "sigAAAAAAAA",
      WALLET,
      tx(
        [bal({ decimals: 6, amount: "1000000", uiAmount: null })],
        [bal({ decimals: 6, amount: "3000000", uiAmount: null })]
      )
    );
    expect(p.transfers[0]?.amount).toBe("2");
  });

  it("un compte token absent du relevé pre est un zéro structurel, pas supposé", () => {
    const p = parseSolanaTransaction(
      "sigAAAAAAAA",
      WALLET,
      tx([], [bal({ uiAmountString: "7", decimals: 6, amount: "7000000" })])
    );
    expect(p.transfers[0]).toMatchObject({ direction: "in", amount: "7" });
  });
});
