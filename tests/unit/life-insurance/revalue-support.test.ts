import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Réévaluation d'un support : le relevé donne un **encours total**, la base
 * stocke un **prix unitaire**.
 *
 * Écrire le total tel quel multipliait la position par sa quantité — un fonds
 * euro de 25 000 parts passait de 25 500 € à 637 millions. Ces tests verrouillent
 * la division, et la purge du cache de cotation qui sinon rendait la
 * réévaluation sans effet tout en répondant « enregistré ».
 */

const assetFindFirst = vi.fn();
const assetUpdate = vi.fn();
const txAggregate = vi.fn();
const quoteDeleteMany = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    asset: {
      findFirst: (...a: unknown[]) => assetFindFirst(...a),
      update: (...a: unknown[]) => assetUpdate(...a),
    },
    transaction: { aggregate: (...a: unknown[]) => txAggregate(...a) },
    priceQuote: { deleteMany: (...a: unknown[]) => quoteDeleteMany(...a) },
  },
}));

vi.mock("@/app/lib/transactions/service", () => ({
  createTransaction: vi.fn(),
}));

import {
  LifeInsuranceInputError,
  revalueSupport,
} from "@/app/lib/life-insurance/support-service";
import { Prisma } from "@/app/lib/prisma-client/client";

beforeEach(() => {
  assetFindFirst.mockReset().mockResolvedValue({ id: "a1" });
  assetUpdate.mockReset().mockResolvedValue({});
  quoteDeleteMany.mockReset().mockResolvedValue({ count: 1 });
  txAggregate
    .mockReset()
    .mockResolvedValue({ _sum: { quantity: new Prisma.Decimal(1) } });
});

/** Prix unitaire effectivement écrit. */
function writtenPrice(): string {
  return String(assetUpdate.mock.calls[0]![0].data.manualPrice);
}

describe("revalueSupport", () => {
  it("divise l'encours par la quantité", async () => {
    // 25 000 parts, encours 26 000 € → 1,04 € l'unité.
    txAggregate.mockResolvedValue({
      _sum: { quantity: new Prisma.Decimal(25_000) },
    });

    await revalueSupport("u1", "a1", "26000");

    expect(writtenPrice()).toBe("1.04");
  });

  it("écrit le montant tel quel pour une quantité de 1", async () => {
    await revalueSupport("u1", "a1", "9200");
    expect(writtenPrice()).toBe("9200");
  });

  it("gère une quantité fractionnaire", async () => {
    txAggregate.mockResolvedValue({
      _sum: { quantity: new Prisma.Decimal("0.5") },
    });
    await revalueSupport("u1", "a1", "1000");
    expect(writtenPrice()).toBe("2000");
  });

  it("purge le cache de cotation, qui primerait sur le prix saisi", async () => {
    await revalueSupport("u1", "a1", "9200");
    expect(quoteDeleteMany).toHaveBeenCalledWith({ where: { assetId: "a1" } });
  });

  it("refuse une position sans quantité plutôt que de diviser par zéro", async () => {
    txAggregate.mockResolvedValue({
      _sum: { quantity: new Prisma.Decimal(0) },
    });

    await expect(revalueSupport("u1", "a1", "1000")).rejects.toThrow(
      LifeInsuranceInputError
    );
    expect(assetUpdate).not.toHaveBeenCalled();
  });

  it("refuse une quantité absente", async () => {
    txAggregate.mockResolvedValue({ _sum: { quantity: null } });
    await expect(revalueSupport("u1", "a1", "1000")).rejects.toThrow(
      LifeInsuranceInputError
    );
  });

  it("refuse une valorisation négative", async () => {
    await expect(revalueSupport("u1", "a1", "-5")).rejects.toThrow(
      LifeInsuranceInputError
    );
    expect(assetUpdate).not.toHaveBeenCalled();
  });

  it("refuse un montant illisible", async () => {
    await expect(revalueSupport("u1", "a1", "beaucoup")).rejects.toThrow(
      LifeInsuranceInputError
    );
  });

  it("accepte la virgule décimale", async () => {
    await revalueSupport("u1", "a1", "1234,56");
    expect(writtenPrice()).toBe("1234.56");
  });

  it("n'écrit rien si le support n'appartient pas à l'utilisateur", async () => {
    assetFindFirst.mockResolvedValue(null);
    await expect(revalueSupport("u1", "a1", "1000")).rejects.toThrow(
      LifeInsuranceInputError
    );
    expect(assetUpdate).not.toHaveBeenCalled();
    expect(quoteDeleteMany).not.toHaveBeenCalled();
  });

  it("filtre sur l'utilisateur et l'enveloppe AV", async () => {
    await revalueSupport("u1", "a1", "1000");
    expect(assetFindFirst.mock.calls[0]![0].where).toMatchObject({
      id: "a1",
      userId: "u1",
      accountType: "AV",
    });
  });
});
