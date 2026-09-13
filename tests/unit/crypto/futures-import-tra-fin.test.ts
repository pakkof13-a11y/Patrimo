import { describe, expect, it, vi } from "vitest";

/**
 * TRA-02 / FIN-03 — ce que `applyFuturesImport` écrit pour une position venue
 * d'un relevé exchange.
 *
 * TRA-02 : un relevé sans colonne levier ne dit pas « levier 1× » — le lever à
 * 1 par défaut sous-évaluait la marge requise et le prix de liquidation
 * estimé de toute position dont l'export ne fournit pas cette colonne. La
 * colonne `leverage` est NOT NULL en base (aucune migration dans ce lot) :
 * on ne peut ni fabriquer une valeur, ni y écrire une absence. La ligne est
 * donc rejetée à la création faute de levier réel ; à la mise à jour, le
 * levier déjà en base (réel) n'est simplement pas touché.
 *
 * FIN-03 : `realizedPnl` doit être le montant BRUT rapporté par l'exchange.
 * Stocker un montant déjà net (funding et commission déjà déduits) fait
 * déduire les mêmes frais une seconde fois à la lecture
 * (`realizedNetPnl` / `closedNetPnl`), qui les retranche du `realizedPnl` lu
 * en base.
 */

const findUnique = vi.fn();
const create = vi.fn();
const update = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    tradingPosition: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      create: (...args: unknown[]) => create(...args),
      update: (...args: unknown[]) => update(...args),
    },
  },
}));

const { applyFuturesImport } = await import(
  "@/app/lib/crypto/futures-import-service"
);

function baseRow(over: Partial<Parameters<typeof applyFuturesImport>[2][number]> = {}) {
  return {
    exchangeTradeId: "1",
    pair: "BTCUSDT",
    direction: "LONG" as const,
    sizeContracts: "0.5",
    entryPrice: "60000",
    exitPrice: "66000",
    leverage: "10",
    realizedPnl: "3000",
    fundingPaid: "5",
    commissionPaid: "3",
    closedAt: "2024-03-15T12:30:45Z",
    ...over,
  };
}

describe("applyFuturesImport — levier absent (TRA-02)", () => {
  it("rejette une nouvelle position sans lui fabriquer un levier de 1", async () => {
    findUnique.mockResolvedValue(null);

    const res = await applyFuturesImport("u1", "BINANCE", [
      baseRow({ exchangeTradeId: "tra-02", leverage: null }),
    ]);

    expect(create).not.toHaveBeenCalled();
    expect(res).toEqual({ created: 0, updated: 0, errors: 1 });
  });

  it("crée la position quand le relevé fournit un levier réel", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: "tp2" });

    await applyFuturesImport("u1", "BINANCE", [
      baseRow({ exchangeTradeId: "tra-02b", leverage: "20" }),
    ]);

    const written = create.mock.calls.at(-1)![0].data as { leverage: string };
    expect(written.leverage).toBe("20.00");
  });

  it("sur une position déjà connue, laisse le levier en base intact plutôt que de l'écraser", async () => {
    findUnique.mockResolvedValue({ id: "existing-1" });
    update.mockResolvedValue({ id: "existing-1" });

    await applyFuturesImport("u1", "BINANCE", [
      baseRow({ exchangeTradeId: "tra-02c", leverage: null }),
    ]);

    expect(update).toHaveBeenCalledTimes(1);
    const written = update.mock.calls.at(-1)![0].data as Record<string, unknown>;
    expect("leverage" in written).toBe(false);
  });
});

describe("applyFuturesImport — realizedPnl brut, pas net (FIN-03)", () => {
  it("stocke le realizedPnl du relevé tel quel, funding et commission non déduits", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: "tp3" });

    await applyFuturesImport("u1", "BINANCE", [
      baseRow({
        exchangeTradeId: "fin-03",
        realizedPnl: "3000",
        fundingPaid: "5",
        commissionPaid: "3",
      }),
    ]);

    const written = create.mock.calls.at(-1)![0].data as {
      realizedPnl: string | null;
      fundingPaid: string | null;
      commissionPaid: string | null;
    };
    // Brut, pas 3000 - 5 - 3 = 2992 : sinon la lecture (realizedNetPnl) le
    // retrancherait une seconde fois à partir de ces mêmes colonnes.
    expect(written.realizedPnl).toBe("3000.00");
    expect(written.fundingPaid).toBe("5");
    expect(written.commissionPaid).toBe("3");
  });

  it("n'invente pas de realizedPnl pour une position encore ouverte", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: "tp4" });

    await applyFuturesImport("u1", "BINANCE", [
      baseRow({ exchangeTradeId: "open-1", exitPrice: null, realizedPnl: null }),
    ]);

    const written = create.mock.calls.at(-1)![0].data as { realizedPnl: string | null };
    expect(written.realizedPnl).toBeNull();
  });
});
