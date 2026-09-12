import { describe, expect, it, vi } from "vitest";

/**
 * Câblage `row.closedAt` → `openedAt`/`closedAt` écrits en base.
 *
 * Les tests de `parseFuturesTimestamp` prouvent qu'un epoch millisecondes en
 * chaîne se lit sur sa vraie année ; ils ne prouvent pas que l'import s'en
 * sert. Un trade de 2024 daté d'aujourd'hui n'est pas un détail d'affichage :
 * il déplace le P&L réalisé d'un exercice fiscal à l'autre.
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

describe("applyFuturesImport — datation de la position écrite", () => {
  it("écrit un trade daté en epoch millisecondes sur son instant UTC de 2024, pas aujourd'hui", async () => {
    findUnique.mockResolvedValue(null);
    create.mockResolvedValue({ id: "tp1" });

    // 1710505845000 = 2024-03-15T12:30:45Z
    const res = await applyFuturesImport("u1", "BINANCE", [
      {
        exchangeTradeId: "888",
        pair: "BTCUSDT",
        direction: "LONG",
        sizeContracts: "0.5",
        entryPrice: "60000",
        exitPrice: "66000",
        leverage: "10",
        realizedPnl: "3000",
        fundingPaid: "-5",
        commissionPaid: "-3",
        closedAt: "1710505845000",
      },
    ]);

    expect(res).toEqual({ created: 1, updated: 0, errors: 0 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();

    const written = create.mock.calls[0][0].data as {
      openedAt: Date;
      closedAt: Date | null;
      isOpen: boolean;
    };

    expect(written.isOpen).toBe(false);
    expect(written.closedAt?.toISOString()).toBe("2024-03-15T12:30:45.000Z");
    expect(written.openedAt.toISOString()).toBe("2024-03-15T12:30:45.000Z");
    expect(written.closedAt?.getUTCFullYear()).toBe(2024);
    expect(written.openedAt.getUTCFullYear()).toBe(2024);
    // Jamais le repli « maintenant » : un trade de 2024 ne date pas de cette année.
    expect(written.openedAt.getUTCFullYear()).not.toBe(
      new Date().getUTCFullYear()
    );
  });
});
