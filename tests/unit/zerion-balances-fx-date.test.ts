/**
 * `writeZerionBalancesToLedger` — le taux appliqué à une écriture de
 * réconciliation est celui du jour de `firstSeen`, pas celui du jour de la
 * sync.
 *
 * Le writer réconcilie des soldes COURANTS mais rétrodate l'ouverture de
 * position à la première apparition on-chain du token. Le taux du jour
 * servait aux deux usages : la cotation « maintenant » (correct) et le
 * `unitPrice` de l'écriture datée 2021 (faux de toute la dérive EUR/USD).
 *
 * Limite assumée, vérifiée ici : le PRIX reste le prix spot du jour (Zerion
 * ne rend pas de prix historique par position). Seule la dimension change est
 * corrigée — `unitPrice = prix(aujourd'hui) × taux(jour de firstSeen)`.
 *
 * Prisma mocké selon la convention de `tests/unit/platforms/*.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ZerionBalanceItem } from "@/app/lib/zerion/client";
import { d } from "@/app/lib/money/decimal";

const assetFindFirst = vi.fn();
const assetCreate = vi.fn();
const assetUpdate = vi.fn();
const priceQuoteUpsert = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
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
/** Taux du jour de la sync — légitime pour la cotation, jamais pour 2021. */
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

const { writeZerionBalancesToLedger } = await import(
  "@/app/lib/zerion/ledger-sync"
);

/** Taux BCE EUR/USD (1 USD = X EUR) autour des dates testées. */
const RATE_2021_03_10 = "0.8400000000";
const RATE_2021_03_12 = "0.8380000000";
const TODAY = new Date().toISOString().slice(0, 10);

function bal(over: Partial<ZerionBalanceItem> = {}): ZerionBalanceItem {
  return {
    ticker: "ETH",
    name: "Ethereum",
    amount: 2,
    decimals: null,
    logo: null,
    usdValue: 3000,
    priceUsd: 1500,
    chainId: "ethereum",
    contractAddress: null,
    positionType: "wallet",
    ...over,
  };
}

/** Clé `firstSeenByKey` telle que construite par `buildZerionFirstSeenMap`. */
function tickerKey(ticker = "ETH", chain = "ethereum"): string {
  return `t:${chain}:${ticker.toUpperCase()}`;
}

beforeEach(() => {
  assetFindFirst.mockReset().mockResolvedValue(null);
  assetCreate.mockReset().mockResolvedValue({ id: "asset-1" });
  assetUpdate.mockReset().mockResolvedValue({});
  priceQuoteUpsert.mockReset().mockResolvedValue({});
  createTransaction.mockReset().mockResolvedValue({});
  // Ledger vide → toute ligne est une ouverture de position.
  loadLedgerForUser.mockReset().mockResolvedValue({ positions: new Map() });
  fxRateToEur.mockClear();
  fxRatesToEurRange.mockReset().mockResolvedValue({
    status: "ok",
    byDay: new Map([
      ["2021-03-10", RATE_2021_03_10],
      ["2021-03-12", RATE_2021_03_12],
      [TODAY, RATE_TODAY],
    ]),
  });
});

describe("reconciliation Zerion — taux a la date de firstSeen", () => {
  it("GOLDEN : ouverture datee 2021 au taux BCE de 2021, cotation courante au taux du jour", async () => {
    const res = await writeZerionBalancesToLedger(
      "u1",
      "pf1",
      [bal()],
      new Map([[tickerKey(), "2021-03-10T14:00:00.000Z"]])
    );

    expect(res.txsCreated).toBe(1);
    expect(res.skippedFxUnknown).toBe(0);

    // 1) Journal : date firstSeen, valorise au taux de CE jour-la.
    const arg = createTransaction.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.occurredAt).toBe("2021-03-10T14:00:00.000Z");
    expect(arg.type).toBe("ACHAT");
    // 1500 USD x 0,84 (10/03/2021) = 1260 EUR — et non x 0,99 (aujourd'hui)
    expect(arg.unitPrice).toBe("1260.000000000000");
    expect(arg.unitPrice).not.toBe("1485.000000000000");

    // 2) Cotation courante : toujours le taux du jour, 1500 x 0,99 = 1485.
    expect(fxRateToEur).toHaveBeenCalledWith("USD");
    const quote = priceQuoteUpsert.mock.calls[0]![0] as {
      create: { priceEur: unknown };
    };
    expect(Number(String(quote.create.priceEur))).toBe(1485);
    // Valeur rapportee au patrimoine : 2 x 1485 = 2970 EUR.
    expect(res.holdings[0]!.valueEurApprox).toBe(2970);
  });

  it("firstSeen un week-end : dernier fixing BCE anterieur, pas le taux du jour", async () => {
    // 2021-03-13 = samedi ; dernier fixing publie = vendredi 12 (0,838)
    await writeZerionBalancesToLedger(
      "u1",
      "pf1",
      [bal({ priceUsd: 1000, usdValue: 2000 })],
      new Map([[tickerKey(), "2021-03-13T09:00:00.000Z"]])
    );

    const arg = createTransaction.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.unitPrice).toBe("838.000000000000");
  });

  it("un seul appel Frankfurter pour tout le lot de soldes", async () => {
    await writeZerionBalancesToLedger(
      "u1",
      "pf1",
      [
        bal({ ticker: "ETH" }),
        bal({ ticker: "USDC", priceUsd: 1, usdValue: 500, amount: 500 }),
        bal({ ticker: "WBTC", priceUsd: 40000, usdValue: 400, amount: 0.01 }),
      ],
      new Map([
        [tickerKey("ETH"), "2021-03-10T10:00:00.000Z"],
        [tickerKey("USDC"), "2021-03-12T10:00:00.000Z"],
        [tickerKey("WBTC"), "2021-03-10T18:00:00.000Z"],
      ])
    );

    expect(fxRatesToEurRange).toHaveBeenCalledTimes(1);
    // Plage : plus ancien firstSeen elargi de 7 j en arriere → aujourd'hui
    expect(fxRatesToEurRange).toHaveBeenCalledWith("USD", "2021-03-03", TODAY);
    expect(createTransaction).toHaveBeenCalledTimes(3);
  });

  it("ajustement de re-sync (position deja ouverte) : date et valorise au jour", async () => {
    loadLedgerForUser.mockResolvedValue({
      positions: new Map([["asset-1::pf1", { quantity: d(1) }]]),
    });

    await writeZerionBalancesToLedger(
      "u1",
      "pf1",
      [bal()],
      new Map([[tickerKey(), "2021-03-10T14:00:00.000Z"]])
    );

    const arg = createTransaction.mock.calls[0]![0] as Record<string, unknown>;
    expect(String(arg.occurredAt).slice(0, 10)).toBe(TODAY);
    // Ecriture datee d'aujourd'hui → taux d'aujourd'hui : 1500 x 0,99
    expect(arg.unitPrice).toBe("1485.000000000000");
    expect(arg.quantity).toBe("1.000000000000");
  });

  it("sans firstSeen : ouverture datee du jour, taux du jour", async () => {
    await writeZerionBalancesToLedger("u1", "pf1", [bal()], new Map());

    const arg = createTransaction.mock.calls[0]![0] as Record<string, unknown>;
    expect(String(arg.occurredAt).slice(0, 10)).toBe(TODAY);
    expect(arg.unitPrice).toBe("1485.000000000000");
  });
});

describe("reconciliation Zerion — taux introuvable : la ligne n'est pas creee", () => {
  it("GOLDEN : trou de plus de 7 jours dans la serie → skip, aucun taux de repli", async () => {
    const res = await writeZerionBalancesToLedger(
      "u1",
      "pf1",
      [bal()],
      new Map([[tickerKey(), "2021-06-01T10:00:00.000Z"]])
    );

    expect(createTransaction).not.toHaveBeenCalled();
    expect(res.txsCreated).toBe(0);
    expect(res.skippedFxUnknown).toBe(1);
    // La position existe on-chain : elle reste declaree, a la quantite du
    // ledger (inchangee). Seule l'ecriture de reconciliation manque.
    expect(res.holdings).toHaveLength(1);
    expect(res.holdings[0]!.quantity).toBe("0.000000000000");
    expect(res.errors).toBe(0);
  });

  it("fournisseur BCE injoignable : aucune ecriture valorisee inventee", async () => {
    fxRatesToEurRange.mockResolvedValue({ status: "unavailable" });

    const res = await writeZerionBalancesToLedger(
      "u1",
      "pf1",
      [bal()],
      new Map([[tickerKey(), "2021-03-10T14:00:00.000Z"]])
    );

    expect(createTransaction).not.toHaveBeenCalled();
    expect(res.skippedFxUnknown).toBe(1);
    // La cotation courante ne depend pas de la serie historique.
    expect(priceQuoteUpsert).toHaveBeenCalledTimes(1);
  });

  it("solde sans prix USD : REWARD ecrit quand meme, aucun taux requis", async () => {
    fxRatesToEurRange.mockResolvedValue({ status: "unavailable" });

    const res = await writeZerionBalancesToLedger(
      "u1",
      "pf1",
      [bal({ ticker: "FOO", amount: 42, priceUsd: null, usdValue: null })],
      new Map([[tickerKey("FOO"), "2021-03-10T10:00:00.000Z"]])
    );

    expect(res.txsCreated).toBe(1);
    expect(res.skippedFxUnknown).toBe(0);
    const arg = createTransaction.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.type).toBe("REWARD");
    expect(arg.quantity).toBe("42.000000000000");
    expect(arg.occurredAt).toBe("2021-03-10T10:00:00.000Z");
    expect(arg.unitPrice).toBeUndefined();
  });
});
