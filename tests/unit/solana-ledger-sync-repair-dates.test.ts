/**
 * CRY-02 — `repairWalletSyncJournalDates` ne doit dater une écriture qu'à
 * partir d'un blockTime réellement associé à CETTE transaction (sa propre
 * signature `[onchain:SIG]`). Un ajustement de réconciliation sans signature
 * garde `occurredAt` (= date de réconciliation) : il n'emprunte plus le
 * premier blockTime du mint, du natif ou du wallet (`__any__`).
 *
 * Prisma mocké selon la convention de `tests/unit/platforms/*.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const txFindMany = vi.fn();
const txUpdate = vi.fn();
const onchainFindMany = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    transaction: {
      findMany: (...a: unknown[]) => txFindMany(...a),
      update: (...a: unknown[]) => txUpdate(...a),
    },
    blockchainOnchainTx: {
      findMany: (...a: unknown[]) => onchainFindMany(...a),
    },
  },
}));

vi.mock("@/app/lib/portfolio/service", () => ({ loadLedgerForUser: vi.fn() }));
vi.mock("@/app/lib/transactions/service", () => ({ createTransaction: vi.fn() }));
vi.mock("@/app/lib/market/fx", () => ({ fxRateToEur: vi.fn() }));
vi.mock("@/app/lib/market/providers/coingecko", () => ({
  fetchSolanaMintPricesUsd: vi.fn(),
  resolveCoingeckoId: vi.fn(),
}));
vi.mock("@/app/lib/solana/token-meta", () => ({ resolveSolanaMintMetas: vi.fn() }));
vi.mock("@/app/lib/portfolio/ledger-cache", () => ({ invalidateLedgerCache: vi.fn() }));

const { repairWalletSyncJournalDates } = await import(
  "@/app/lib/market/solana-ledger-sync"
);

const MINT_A = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
const SIG_OWN =
  "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
const FIRST_MINT_BLOCK = new Date("2024-01-01T00:00:00.000Z");
const FIRST_WALLET_BLOCK = new Date("2023-06-01T00:00:00.000Z");
const OWN_BLOCK = new Date("2024-03-03T12:00:00.000Z");

/** Table on-chain en mémoire : la 1re activité wallet, la 1re du mint, et la tx propre. */
const ONCHAIN = [
  {
    signature: "sigWalletFirst",
    blockTime: FIRST_WALLET_BLOCK,
    transfers: [{ kind: "SOL", direction: "in" }],
  },
  {
    signature: "sigMintFirst",
    blockTime: FIRST_MINT_BLOCK,
    transfers: [{ kind: "SPL", mint: MINT_A, direction: "in" }],
  },
  {
    signature: SIG_OWN,
    blockTime: OWN_BLOCK,
    transfers: [{ kind: "SPL", mint: MINT_A, direction: "in" }],
  },
];

beforeEach(() => {
  txFindMany.mockReset();
  txUpdate.mockReset().mockResolvedValue({});
  onchainFindMany.mockReset().mockImplementation(async (args: unknown) => {
    const where = (args as { where?: { signature?: { in?: string[] } } })
      ?.where;
    const sigIn = where?.signature?.in;
    const rows = sigIn
      ? ONCHAIN.filter((r) => sigIn.includes(r.signature))
      : [...ONCHAIN].sort(
          (a, b) => a.blockTime.getTime() - b.blockTime.getTime()
        );
    return rows;
  });
});

describe("CRY-02 — réconciliation sans blockTime propre", () => {
  it("garde occurredAt = date de réconciliation, n'emprunte pas le 1er blockTime du mint", async () => {
    const now = new Date();
    txFindMany.mockResolvedValue([
      {
        id: "t-recon",
        occurredAt: now,
        createdAt: now,
        notes: `[wallet-sync:solana] ${MINT_A} target=5`,
        assetId: "a1",
        asset: { providerSymbol: `sol:${MINT_A}` },
      },
    ]);

    const repaired = await repairWalletSyncJournalDates("u1", "pf1");

    expect(repaired).toBe(0);
    expect(txUpdate).not.toHaveBeenCalled();
  });

  it("clôture zero-onchain (asset natif) : pas redatée au 1er blockTime SOL ni __any__", async () => {
    const now = new Date();
    txFindMany.mockResolvedValue([
      {
        id: "t-close",
        occurredAt: now,
        createdAt: now,
        notes: "[wallet-sync:solana] close zero-onchain",
        assetId: "a-sol",
        asset: { providerSymbol: "solana" },
      },
      {
        id: "t-unknown",
        occurredAt: now,
        createdAt: now,
        notes: "[wallet-sync:solana] close zero-onchain",
        assetId: "a-x",
        asset: { providerSymbol: "sol-sym:foo" },
      },
    ]);

    const repaired = await repairWalletSyncJournalDates("u1", "pf1");

    expect(repaired).toBe(0);
    expect(txUpdate).not.toHaveBeenCalled();
  });
});

describe("CRY-02 — écriture avec sa propre signature on-chain", () => {
  it("est redatée au blockTime de SA transaction, pas au 1er du mint", async () => {
    const now = new Date();
    txFindMany.mockResolvedValue([
      {
        id: "t-own",
        occurredAt: now,
        createdAt: now,
        notes: `[onchain:${SIG_OWN}] [wallet-sync:solana] TRANSFER in BONK`,
        assetId: "a1",
        asset: { providerSymbol: `sol:${MINT_A}` },
      },
    ]);

    const repaired = await repairWalletSyncJournalDates("u1", "pf1");

    expect(repaired).toBe(1);
    expect(txUpdate).toHaveBeenCalledTimes(1);
    expect(txUpdate).toHaveBeenCalledWith({
      where: { id: "t-own" },
      data: { occurredAt: OWN_BLOCK },
    });
  });

  it("déjà à son blockTime : aucune écriture (pas de boucle avec repairOnchainJournalDates)", async () => {
    txFindMany.mockResolvedValue([
      {
        id: "t-own",
        occurredAt: OWN_BLOCK,
        createdAt: new Date(),
        notes: `[onchain:${SIG_OWN}] [wallet-sync:solana] TRANSFER in BONK`,
        assetId: "a1",
        asset: { providerSymbol: `sol:${MINT_A}` },
      },
    ]);

    const repaired = await repairWalletSyncJournalDates("u1", "pf1");

    expect(repaired).toBe(0);
    expect(txUpdate).not.toHaveBeenCalled();
  });
});
