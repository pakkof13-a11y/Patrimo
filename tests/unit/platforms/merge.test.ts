import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `mergePlatforms` (app/lib/platforms/upsert.ts) — deux defauts reels, meme
 * fonction :
 *
 * 1. PRI-01/PLA-03 : une plateforme source portant un `SecuritiesAccount`
 *    (PEA/PEA_PME/CTO) faisait echouer `platform.delete` en P2003 --
 *    `SecuritiesAccount.platformId` est `onDelete: Restrict` dans le schema,
 *    et n'etait jamais deplace (contrairement a Asset/Transaction).
 * 2. JOU-01 : un TRANSFERT_CASH/TRANSFERT_TITRE deja existant entre la source
 *    et la cible se retrouve, une fois fusionne, avec platformId ===
 *    toPlatformId -- ce que `applyTransaction` (ledger.ts) refuse via
 *    `AccountingError "SAME_PLATFORM"`. La fusion doit donc etre refusee
 *    plutot que de casser tout rejeu ulterieur du journal.
 */

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

const { db, fakePrisma, reset } = vi.hoisted(() => {
  const db: {
    platforms: Row[];
    assets: Row[];
    transactions: Row[];
    securitiesAccounts: Row[];
  } = { platforms: [], assets: [], transactions: [], securitiesAccounts: [] };

  const matches = (row: Row, where: Where = {}): boolean => {
    for (const [key, expected] of Object.entries(where)) {
      if (expected === undefined) continue;
      if (key === "OR" && Array.isArray(expected)) {
        if (!(expected as Where[]).some((w) => matches(row, w))) return false;
        continue;
      }
      if (
        expected !== null &&
        typeof expected === "object" &&
        "in" in (expected as Row)
      ) {
        const list = (expected as { in: unknown[] }).in;
        if (!list.includes(row[key])) return false;
      } else if (row[key] !== expected) return false;
    }
    return true;
  };

  const find = (rows: Row[], where?: Where) =>
    rows.find((r) => matches(r, where)) ?? null;
  const filter = (rows: Row[], where?: Where) =>
    rows.filter((r) => matches(r, where));

  const updateMany = (rows: Row[], where: Where, data: Row) => {
    const hit = filter(rows, where);
    for (const row of hit) Object.assign(row, data);
    return { count: hit.length };
  };

  const fakePrisma = {
    platform: {
      findFirst: async ({ where }: { where?: Where }) =>
        find(db.platforms, where),
      delete: async ({ where }: { where: { id: string } }) => {
        const stillLinked = db.securitiesAccounts.some(
          (a) => a.platformId === where.id
        );
        if (stillLinked) {
          const err = new Error(
            "Foreign key constraint violated: SecuritiesAccount_platformId_fkey"
          ) as Error & { code?: string };
          err.code = "P2003";
          throw err;
        }
        const idx = db.platforms.findIndex((p) => p.id === where.id);
        if (idx === -1) throw new Error("plateforme absente");
        const [removed] = db.platforms.splice(idx, 1);
        return removed;
      },
    },
    asset: {
      updateMany: async ({ where, data }: { where: Where; data: Row }) =>
        updateMany(db.assets, where, data),
    },
    transaction: {
      findMany: async ({ where }: { where?: Where }) =>
        filter(db.transactions, where),
      updateMany: async ({ where, data }: { where: Where; data: Row }) =>
        updateMany(db.transactions, where, data),
    },
    securitiesAccount: {
      updateMany: async ({ where, data }: { where: Where; data: Row }) =>
        updateMany(db.securitiesAccounts, where, data),
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(fakePrisma),
  };

  const reset = () => {
    db.platforms = [];
    db.assets = [];
    db.transactions = [];
    db.securitiesAccounts = [];
  };

  return { db, fakePrisma, reset };
});

vi.mock("@/app/lib/prisma", () => ({ prisma: fakePrisma }));

import { mergePlatforms } from "@/app/lib/platforms/upsert";
import { replayTransactions } from "@/app/lib/accounting/ledger";
import { AccountingError } from "@/app/lib/accounting/types";
import type { LedgerTx } from "@/app/lib/accounting/types";
import { d } from "@/app/lib/money/decimal";

const USER = "u-merge";

function platform(id: string) {
  db.platforms.push({ id, userId: USER, name: id, type: "COURTIER" });
}

beforeEach(() => {
  reset();
});

describe("mergePlatforms -- PRI-01/PLA-03 (SecuritiesAccount Restrict)", () => {
  it("avant le correctif : un SecuritiesAccount rattache a la source fait echouer platform.delete (P2003)", async () => {
    platform("src");
    platform("dst");
    db.securitiesAccounts.push({
      id: "sa-1",
      userId: USER,
      platformId: "src",
      envelopeType: "PEA",
    });

    await expect(
      fakePrisma.platform.delete({ where: { id: "src" } })
    ).rejects.toMatchObject({ code: "P2003" });
  });

  it("apres le correctif : la fusion reussit et deplace le SecuritiesAccount vers la cible", async () => {
    platform("src");
    platform("dst");
    db.securitiesAccounts.push({
      id: "sa-1",
      userId: USER,
      platformId: "src",
      envelopeType: "PEA",
    });

    const result = await mergePlatforms(USER, "src", "dst");

    expect(result.securitiesAccountsMoved).toBe(1);
    expect(db.securitiesAccounts[0]!.platformId).toBe("dst");
    expect(db.platforms.find((p) => p.id === "src")).toBeUndefined();
  });
});

describe("mergePlatforms -- JOU-01 (transfert intra-fusion casse SAME_PLATFORM)", () => {
  function ledgerTx(over: Partial<LedgerTx>): LedgerTx {
    return {
      id: "tx-transfert",
      type: "TRANSFERT_CASH",
      platformId: "src",
      toPlatformId: "dst",
      fees: d(0),
      currency: "EUR",
      fxRateToEur: d(1),
      cashAmountOriginal: d(100),
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
      ...over,
    };
  }

  it("sans le garde-fou : la fusion aurait laisse platformId === toPlatformId, et le rejeu leve SAME_PLATFORM", () => {
    const apresFusionNaive = ledgerTx({ platformId: "dst", toPlatformId: "dst" });

    expect(() => replayTransactions([apresFusionNaive])).toThrow(AccountingError);
    try {
      replayTransactions([apresFusionNaive]);
      throw new Error("devrait avoir leve");
    } catch (e) {
      expect((e as AccountingError).code).toBe("SAME_PLATFORM");
    }
  });

  it("avec le correctif : la fusion est refusee avant toute ecriture, et le journal reste rejouable", async () => {
    platform("src");
    platform("dst");
    db.transactions.push({
      id: "tx-transfert",
      userId: USER,
      type: "TRANSFERT_CASH",
      platformId: "src",
      toPlatformId: "dst",
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    await expect(mergePlatforms(USER, "src", "dst")).rejects.toThrow(
      /tx-transfert/
    );

    const avant = ledgerTx({ allowNegativeCash: true });
    expect(() => replayTransactions([avant])).not.toThrow();
    expect(db.platforms.map((p) => p.id).sort()).toEqual(["dst", "src"]);
  });

  it("un transfert dans l'autre sens (dst vers src) est detecte aussi", async () => {
    platform("src");
    platform("dst");
    db.transactions.push({
      id: "tx-retour",
      userId: USER,
      type: "TRANSFERT_TITRE",
      platformId: "dst",
      toPlatformId: "src",
      occurredAt: new Date("2026-02-01T00:00:00.000Z"),
    });

    await expect(mergePlatforms(USER, "src", "dst")).rejects.toThrow(
      /tx-retour/
    );
  });

  it("une fusion sans transfert intra-fusion preexistant reussit normalement", async () => {
    platform("src");
    platform("dst");
    db.transactions.push({
      id: "tx-achat",
      userId: USER,
      type: "ACHAT",
      platformId: "src",
      toPlatformId: null,
      occurredAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const result = await mergePlatforms(USER, "src", "dst");
    expect(result.transactionsMoved).toBe(1);
    expect(db.transactions[0]!.platformId).toBe("dst");
  });
});
