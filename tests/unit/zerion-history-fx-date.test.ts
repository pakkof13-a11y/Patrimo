/**
 * JOU-02-bis — `writeZerionHistoryToLedger` valorise chaque transfer au taux
 * BCE du jour de SON `mined_at`, jamais au taux du jour de la sync.
 *
 * Le prix `leg.priceUsd` rendu par Zerion est celui de la date de la
 * transaction : le convertir au taux du jour mélangeait deux dates et faussait
 * le prix de revient de toute la dérive EUR/USD accumulée depuis.
 *
 * Prisma mocké selon la convention de `tests/unit/platforms/*.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZerionTxItem } from "@/app/lib/zerion/client";

const txFindFirst = vi.fn();
const assetFindFirst = vi.fn();
const assetCreate = vi.fn();
const assetUpdate = vi.fn();
const priceQuoteUpsert = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    transaction: { findFirst: (...a: unknown[]) => txFindFirst(...a) },
    asset: {
      findFirst: (...a: unknown[]) => assetFindFirst(...a),
      create: (...a: unknown[]) => assetCreate(...a),
      update: (...a: unknown[]) => assetUpdate(...a),
    },
    priceQuote: { upsert: (...a: unknown[]) => priceQuoteUpsert(...a) },
  },
}));

const createTransaction = vi.fn();
const fxRatesToEurRange = vi.fn();
/** Taux du jour de la sync — ne doit JAMAIS servir a l'historique. */
const RATE_TODAY = "0.99";
const fxRateToEur = vi.fn(async (..._a: unknown[]) => RATE_TODAY);

vi.mock("@/app/lib/transactions/service", () => ({
  createTransaction: (...a: unknown[]) => createTransaction(...a),
}));
vi.mock("@/app/lib/market/fx", () => ({
  fxRateToEur: (...a: unknown[]) => fxRateToEur(...a),
  fxRatesToEurRange: (...a: unknown[]) => fxRatesToEurRange(...a),
}));
vi.mock("@/app/lib/portfolio/service", () => ({ loadLedgerForUser: vi.fn() }));
vi.mock("@/app/lib/portfolio/ledger-cache", () => ({
  invalidateLedgerCache: vi.fn(),
}));

const { writeZerionHistoryToLedger } = await import(
  "@/app/lib/zerion/ledger-sync"
);

/** Taux BCE EUR/USD (1 USD = X EUR) autour des dates testees. */
const RATE_2021_03_10 = "0.8400000000";
const RATE_2021_03_12 = "0.8380000000";

function tx(over: Partial<ZerionTxItem> & { hash: string }): ZerionTxItem {
  return {
    hash: over.hash,
    date: null,
    timestampUnix: over.timestampUnix ?? 1_600_000_000,
    occurredAtIso: over.occurredAtIso ?? null,
    type: "TRADE",
    status: "success",
    chainId: "ethereum",
    application: null,
    isTrash: false,
    transfers: over.transfers ?? [],
  };
}

function leg(over: {
  priceUsd: number | null;
  amount?: number;
  ticker?: string;
}) {
  return {
    direction: "in" as const,
    ticker: over.ticker ?? "ETH",
    name: "Ethereum",
    amount: over.amount ?? 1,
    priceUsd: over.priceUsd,
    valueUsd: over.priceUsd != null ? over.priceUsd * (over.amount ?? 1) : null,
    logo: null,
    contractAddress: null,
  };
}

beforeEach(() => {
  txFindFirst.mockReset().mockResolvedValue(null);
  assetFindFirst.mockReset().mockResolvedValue(null);
  assetCreate.mockReset().mockResolvedValue({ id: "asset-1" });
  assetUpdate.mockReset().mockResolvedValue({});
  priceQuoteUpsert.mockReset().mockResolvedValue({});
  createTransaction.mockReset().mockResolvedValue({});
  fxRateToEur.mockClear();
  fxRatesToEurRange.mockReset().mockResolvedValue({
    status: "ok",
    byDay: new Map([
      ["2021-03-10", RATE_2021_03_10],
      ["2021-03-12", RATE_2021_03_12],
      [new Date().toISOString().slice(0, 10), RATE_TODAY],
    ]),
  });
});

describe("JOU-02-bis — taux a la date de l'evenement on-chain", () => {
  it("une tx de 2021 est valorisee au taux BCE de 2021, pas a celui du jour", async () => {
    const res = await writeZerionHistoryToLedger("u1", "pf1", [
      tx({
        hash: "0xold",
        occurredAtIso: "2021-03-10T14:00:00.000Z",
        transfers: [leg({ priceUsd: 1500, amount: 2 })],
      }),
    ]);

    expect(res.historyTxsCreated).toBe(1);
    expect(res.skippedFxUnknown).toBe(0);
    expect(createTransaction).toHaveBeenCalledTimes(1);

    const arg = createTransaction.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.occurredAt).toBe("2021-03-10T14:00:00.000Z");
    // 1500 USD x 0,84 (taux du 10/03/2021) = 1260 EUR, et non x 0,99 (aujourd'hui)
    expect(arg.unitPrice).toBe("1260.000000000000");
    expect(arg.unitPrice).not.toBe("1485.000000000000");
    // Le taux du jour n'est jamais consulte par l'import d'historique
    expect(fxRateToEur).not.toHaveBeenCalled();
  });

  it("jour sans fixing BCE (week-end) : dernier fixing anterieur, pas le taux du jour", async () => {
    // 2021-03-13 = samedi ; dernier fixing publie = vendredi 12
    await writeZerionHistoryToLedger("u1", "pf1", [
      tx({
        hash: "0xsat",
        occurredAtIso: "2021-03-13T09:00:00.000Z",
        transfers: [leg({ priceUsd: 1000 })],
      }),
    ]);

    const arg = createTransaction.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.unitPrice).toBe("838.000000000000");
  });

  it("un seul appel Frankfurter pour tout le lot", async () => {
    await writeZerionHistoryToLedger("u1", "pf1", [
      tx({
        hash: "0xa",
        occurredAtIso: "2021-03-10T10:00:00.000Z",
        transfers: [leg({ priceUsd: 1500 })],
      }),
      tx({
        hash: "0xb",
        occurredAtIso: "2021-03-12T10:00:00.000Z",
        transfers: [leg({ priceUsd: 1600 })],
      }),
      tx({
        hash: "0xc",
        occurredAtIso: "2021-03-10T18:00:00.000Z",
        transfers: [leg({ priceUsd: 1700 })],
      }),
    ]);

    expect(fxRatesToEurRange).toHaveBeenCalledTimes(1);
    // Plage bornee par les dates du lot, elargie de 7 j en arriere pour le repli
    expect(fxRatesToEurRange).toHaveBeenCalledWith(
      "USD",
      "2021-03-03",
      "2021-03-12"
    );
    expect(createTransaction).toHaveBeenCalledTimes(3);
  });
});

describe("JOU-02-bis — taux introuvable : la ligne n'est pas creee", () => {
  it("trou de plus de 7 jours dans la serie : skip, aucun taux de repli", async () => {
    const res = await writeZerionHistoryToLedger("u1", "pf1", [
      tx({
        hash: "0xgap",
        occurredAtIso: "2021-06-01T10:00:00.000Z",
        transfers: [leg({ priceUsd: 2500 })],
      }),
    ]);

    expect(createTransaction).not.toHaveBeenCalled();
    expect(res.historyTxsCreated).toBe(0);
    expect(res.skippedFxUnknown).toBe(1);
    expect(res.skipped).toBe(1);
    // Ni tx a fxRateToEur "1", ni actif cree pour une ligne refusee
    expect(assetCreate).not.toHaveBeenCalled();
  });

  it("fournisseur BCE injoignable : aucune ecriture valorisee inventee", async () => {
    fxRatesToEurRange.mockResolvedValue({ status: "unavailable" });

    const res = await writeZerionHistoryToLedger("u1", "pf1", [
      tx({
        hash: "0xdown",
        occurredAtIso: "2021-03-10T10:00:00.000Z",
        transfers: [leg({ priceUsd: 1500 })],
      }),
    ]);

    expect(createTransaction).not.toHaveBeenCalled();
    expect(res.skippedFxUnknown).toBe(1);
  });

  it("transfer sans prix USD : importe quand meme, aucun taux requis", async () => {
    fxRatesToEurRange.mockResolvedValue({ status: "unavailable" });

    const res = await writeZerionHistoryToLedger("u1", "pf1", [
      tx({
        hash: "0xairdrop",
        occurredAtIso: "2021-03-10T10:00:00.000Z",
        transfers: [leg({ priceUsd: null, amount: 42, ticker: "FOO" })],
      }),
    ]);

    expect(res.historyTxsCreated).toBe(1);
    expect(res.skippedFxUnknown).toBe(0);
    const arg = createTransaction.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.type).toBe("REWARD");
    expect(arg.quantity).toBe("42.000000000000");
    expect(arg.unitPrice).toBeUndefined();
  });
});
