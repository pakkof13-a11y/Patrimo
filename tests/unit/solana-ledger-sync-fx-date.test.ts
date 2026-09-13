/**
 * JOU-02-bis — `writeSolanaSnapshotToLedger` convertit le prix unitaire de
 * l'ecriture au taux BCE du jour de `occurredAt` (blockTime on-chain du 1er
 * fill), pas au taux du jour de la sync.
 *
 * Ce qui reste volontairement au taux du jour : la cotation `PriceQuote`,
 * `manualPrice` et `valueEurApprox` — ce sont des valorisations « a
 * maintenant », leur taux correct est celui de maintenant.
 *
 * Prisma mocke selon la convention de `tests/unit/platforms/*.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SolanaPortfolioSnapshot } from "@/app/lib/solana/types";

const platformFindFirst = vi.fn();
const assetFindFirst = vi.fn();
const assetCreate = vi.fn();
const assetUpdate = vi.fn();
const assetFindMany = vi.fn();
const priceQuoteUpsert = vi.fn();
const onchainFindMany = vi.fn();
const txFindMany = vi.fn();
const txUpdate = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    platform: { findFirst: (...a: unknown[]) => platformFindFirst(...a) },
    asset: {
      findFirst: (...a: unknown[]) => assetFindFirst(...a),
      create: (...a: unknown[]) => assetCreate(...a),
      update: (...a: unknown[]) => assetUpdate(...a),
      findMany: (...a: unknown[]) => assetFindMany(...a),
    },
    priceQuote: { upsert: (...a: unknown[]) => priceQuoteUpsert(...a) },
    blockchainOnchainTx: {
      findMany: (...a: unknown[]) => onchainFindMany(...a),
    },
    transaction: {
      findMany: (...a: unknown[]) => txFindMany(...a),
      update: (...a: unknown[]) => txUpdate(...a),
    },
  },
}));

const createTransaction = vi.fn();
const fxRatesToEurRange = vi.fn();
/** Taux du jour de la sync — ne doit pas valoriser une ecriture datee de 2021. */
const RATE_TODAY = "0.99";
const fxRateToEur = vi.fn(async (..._a: unknown[]) => RATE_TODAY);
const loadLedgerForUser = vi.fn();

vi.mock("@/app/lib/transactions/service", () => ({
  createTransaction: (...a: unknown[]) => createTransaction(...a),
}));
vi.mock("@/app/lib/market/fx", () => ({
  fxRateToEur: (...a: unknown[]) => fxRateToEur(...a),
  fxRatesToEurRange: (...a: unknown[]) => fxRatesToEurRange(...a),
}));
vi.mock("@/app/lib/portfolio/service", () => ({
  loadLedgerForUser: (...a: unknown[]) => loadLedgerForUser(...a),
}));
vi.mock("@/app/lib/portfolio/ledger-cache", () => ({
  invalidateLedgerCache: vi.fn(),
}));
vi.mock("@/app/lib/market/providers/coingecko", () => ({
  fetchSolanaMintPricesUsd: vi.fn(async () => new Map()),
  resolveCoingeckoId: vi.fn(() => null),
}));
vi.mock("@/app/lib/solana/token-meta", () => ({
  resolveSolanaMintMetas: vi.fn(async () => new Map()),
}));

const { writeSolanaSnapshotToLedger } = await import(
  "@/app/lib/market/solana-ledger-sync"
);

/** 1re activite on-chain du wallet : 10/03/2021. */
const FIRST_BLOCK = new Date("2021-03-10T14:00:00.000Z");
const RATE_2021_03_10 = "0.8400000000";

function snapshot(priceUsd: number | null): SolanaPortfolioSnapshot {
  return {
    address: "So11111111111111111111111111111111111111112",
    totalValueUsd: priceUsd != null ? priceUsd * 3 : null,
    native: {
      tokenAddress: null,
      symbol: "SOL",
      name: "Solana",
      balance: "3",
      decimals: 9,
      priceUsd,
      valueUsd: priceUsd != null ? priceUsd * 3 : null,
      icon: null,
      isNative: true,
    },
    tokens: [],
    fetchedAt: new Date().toISOString(),
    source: "solana-rpc",
  };
}

beforeEach(() => {
  platformFindFirst.mockReset().mockResolvedValue({ id: "pf1" });
  assetFindFirst.mockReset().mockResolvedValue(null);
  assetCreate.mockReset().mockResolvedValue({ id: "asset-sol" });
  assetUpdate.mockReset().mockResolvedValue({});
  assetFindMany.mockReset().mockResolvedValue([]);
  priceQuoteUpsert.mockReset().mockResolvedValue({});
  txFindMany.mockReset().mockResolvedValue([]);
  txUpdate.mockReset().mockResolvedValue({});
  onchainFindMany.mockReset().mockResolvedValue([
    { blockTime: FIRST_BLOCK, transfers: [{ kind: "SOL", direction: "in" }] },
  ]);
  createTransaction.mockReset().mockResolvedValue({});
  fxRateToEur.mockClear();
  // Position vide -> 1er fill -> date = blockTime on-chain
  loadLedgerForUser.mockReset().mockResolvedValue({ positions: new Map() });
  fxRatesToEurRange.mockReset().mockResolvedValue({
    status: "ok",
    byDay: new Map([
      ["2021-03-10", RATE_2021_03_10],
      [new Date().toISOString().slice(0, 10), RATE_TODAY],
    ]),
  });
});

describe("JOU-02-bis — 1er fill date d'un blockTime passe", () => {
  it("valorise au taux BCE du jour du blockTime, pas a celui de la sync", async () => {
    const res = await writeSolanaSnapshotToLedger("u1", "pf1", snapshot(30));

    expect(res.skippedFxUnknown).toBe(0);
    expect(res.txsCreated).toBe(1);
    expect(createTransaction).toHaveBeenCalledTimes(1);

    const arg = createTransaction.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.type).toBe("ACHAT");
    expect(arg.occurredAt).toBe("2021-03-10T14:00:00.000Z");
    // 30 USD x 0,84 (taux du 10/03/2021) = 25,2 EUR, et non x 0,99 (aujourd'hui)
    expect(arg.unitPrice).toBe("25.200000000000");
    expect(arg.unitPrice).not.toBe("29.700000000000");
  });

  it("un seul appel Frankfurter, plage bornee a la 1re activite du wallet", async () => {
    await writeSolanaSnapshotToLedger("u1", "pf1", snapshot(30));

    expect(fxRatesToEurRange).toHaveBeenCalledTimes(1);
    expect(fxRatesToEurRange).toHaveBeenCalledWith(
      "USD",
      "2021-03-03",
      new Date().toISOString().slice(0, 10)
    );
  });

  it("la cotation du jour reste au taux du jour (PriceQuote / manualPrice)", async () => {
    await writeSolanaSnapshotToLedger("u1", "pf1", snapshot(30));

    // 30 USD x 0,99 = 29,7 EUR : valorisation « a maintenant », taux de maintenant
    expect(priceQuoteUpsert).toHaveBeenCalledTimes(1);
    const q = priceQuoteUpsert.mock.calls[0]![0] as {
      create: { priceEur: unknown };
    };
    // Prisma.Decimal normalise les zeros de queue
    expect(String(q.create.priceEur)).toBe("29.7");
    expect(fxRateToEur).toHaveBeenCalledWith("USD");
  });
});

describe("JOU-02-bis — taux introuvable a la date de l'ecriture", () => {
  it("skip : aucune ecriture, aucun taux de repli", async () => {
    fxRatesToEurRange.mockResolvedValue({
      status: "ok",
      // Le 10/03/2021 et les 7 jours precedents sont absents de la serie
      byDay: new Map([[new Date().toISOString().slice(0, 10), RATE_TODAY]]),
    });

    const res = await writeSolanaSnapshotToLedger("u1", "pf1", snapshot(30));

    expect(createTransaction).not.toHaveBeenCalled();
    expect(res.txsCreated).toBe(0);
    expect(res.skippedFxUnknown).toBe(1);
    expect(res.skipped).toBe(1);
  });

  it("skip : la position reste declaree, elle n'est pas liquidee", async () => {
    fxRatesToEurRange.mockResolvedValue({ status: "unavailable" });

    const res = await writeSolanaSnapshotToLedger("u1", "pf1", snapshot(30));

    expect(res.skippedFxUnknown).toBe(1);
    // holdings garde l'actif : sans cela, la boucle « close zero-onchain »
    // vendrait une position qui existe pourtant on-chain.
    expect(res.holdings).toHaveLength(1);
    expect(res.holdings[0]!.quantity).toBe("3.000000000000");
    expect(createTransaction).not.toHaveBeenCalled();
  });

  it("sans prix USD : REWARD ecrit quand meme, aucun taux requis", async () => {
    fxRatesToEurRange.mockResolvedValue({ status: "unavailable" });

    const res = await writeSolanaSnapshotToLedger("u1", "pf1", snapshot(null));

    expect(res.skippedFxUnknown).toBe(0);
    expect(createTransaction).toHaveBeenCalledTimes(1);
    const arg = createTransaction.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.type).toBe("REWARD");
    expect(arg.occurredAt).toBe("2021-03-10T14:00:00.000Z");
    expect(arg.unitPrice).toBeUndefined();
  });
});
