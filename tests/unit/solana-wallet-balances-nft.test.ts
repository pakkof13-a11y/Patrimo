/**
 * CRY-05 — un compte token à 1 unité / 0 décimale / non coté (NFT Metaplex ou
 * spam) n'est pas un actif comptant : publié dans `snapshot.tokens`, il
 * devenait un `Asset` CRYPTO sans fiche NFT, jamais coté (404 fournisseur),
 * donc sans clôture — et la courbe « Évolution » perdait tous ses points à
 * partir de son entrée (un jour n'entre dans la série que si TOUTES les lignes
 * détenues sont valorisables).
 *
 * Les NFT sont lus par le module NFT (`nft-wallet-sync`, Magic Eden pour
 * Solana) : le snapshot comptant les déclare (notice) sans les publier.
 *
 * RPC + fournisseurs mockés.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcGetBalance = vi.fn();
const rpcGetTokenAccountsByOwner = vi.fn();
const fetchCoingeckoSimplePrices = vi.fn();
const fetchSolanaMintPricesUsd = vi.fn();

vi.mock("@/app/lib/solana/rpc-client", () => ({
  rpcGetBalance: (...a: unknown[]) => rpcGetBalance(...a),
  rpcGetTokenAccountsByOwner: (...a: unknown[]) => rpcGetTokenAccountsByOwner(...a),
}));
vi.mock("@/app/lib/market/providers/coingecko", () => ({
  fetchCoingeckoSimplePrices: (...a: unknown[]) => fetchCoingeckoSimplePrices(...a),
  fetchSolanaMintPricesUsd: (...a: unknown[]) => fetchSolanaMintPricesUsd(...a),
}));
vi.mock("@/app/lib/solana/token-meta", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/solana/token-meta")>();
  return { ...actual, resolveSolanaMintMetas: vi.fn(async () => new Map()) };
});

const { fetchWalletBalanceSnapshot } = await import(
  "@/app/lib/solana/wallet-balances"
);

const WALLET = "5QQuBjEBuHCAKUcE2c9DbVr3r2w3pnJg93eqVjf4tKnf";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const NFT_MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const SPAM_MINT = "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E";
const ONE_DEC0_PRICED = "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5";

function account(mint: string, uiAmountString: string, decimals: number) {
  return {
    pubkey: { toBase58: () => `ta-${mint.slice(0, 6)}` },
    account: {
      data: {
        parsed: {
          info: {
            mint,
            tokenAmount: { uiAmountString, decimals, amount: uiAmountString },
          },
        },
      },
    },
  };
}

beforeEach(() => {
  rpcGetBalance.mockReset().mockResolvedValue(2_000_000_000); // 2 SOL
  fetchCoingeckoSimplePrices.mockReset().mockResolvedValue({
    solana: { usd: 100 },
    "usd-coin": { usd: 1 },
    tether: { usd: 1 },
  });
  fetchSolanaMintPricesUsd.mockReset().mockResolvedValue(new Map());
});

describe("CRY-05 — NFT / spam (1 unité, 0 décimale, non coté) hors snapshot comptant", () => {
  it("les tokens cotés restent, le NFT n'est pas publié comme comptant", async () => {
    rpcGetTokenAccountsByOwner.mockResolvedValue([
      account(USDC, "10", 6),
      account(NFT_MINT, "1", 0),
    ]);

    const snap = await fetchWalletBalanceSnapshot(WALLET);

    const mints = snap.tokens.map((t) => t.tokenAddress);
    expect(mints).toContain(USDC);
    expect(mints).not.toContain(NFT_MINT);
    // Le natif et USDC gardent leur valeur : la courbe garde ses points
    expect(snap.native?.valueUsd).toBe(200);
    expect(snap.tokens.find((t) => t.tokenAddress === USDC)?.valueUsd).toBe(10);
    expect(snap.totalValueUsd).toBe(210);
  });

  it("déclare l'exclusion plutôt que de la taire", async () => {
    rpcGetTokenAccountsByOwner.mockResolvedValue([
      account(USDC, "10", 6),
      account(NFT_MINT, "1", 0),
      account(SPAM_MINT, "1", 0),
    ]);

    const snap = await fetchWalletBalanceSnapshot(WALLET);

    expect(snap.tokens.map((t) => t.tokenAddress)).toEqual([USDC]);
    expect(snap.notice ?? "").toMatch(/2 .*(NFT|non fongible)/i);
  });

  it("un token 0 décimale à 1 unité mais COTÉ reste un actif comptant", async () => {
    fetchSolanaMintPricesUsd.mockResolvedValue(new Map([[ONE_DEC0_PRICED, 3.5]]));
    rpcGetTokenAccountsByOwner.mockResolvedValue([account(ONE_DEC0_PRICED, "1", 0)]);

    const snap = await fetchWalletBalanceSnapshot(WALLET);

    expect(snap.tokens.map((t) => t.tokenAddress)).toEqual([ONE_DEC0_PRICED]);
    expect(snap.tokens[0]?.valueUsd).toBe(3.5);
  });

  it("un token 0 décimale à 5 unités non coté n'est pas un NFT : il reste publié (non coté, déclaré)", async () => {
    rpcGetTokenAccountsByOwner.mockResolvedValue([account(SPAM_MINT, "5", 0)]);

    const snap = await fetchWalletBalanceSnapshot(WALLET);

    expect(snap.tokens.map((t) => t.tokenAddress)).toEqual([SPAM_MINT]);
    expect(snap.tokens[0]?.priceUsd).toBeNull();
  });
});
