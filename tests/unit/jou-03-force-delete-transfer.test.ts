import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * JOU-03 — force-delete d'une plateforme B qui a reçu (ou envoyé) un
 * TRANSFERT_CASH / TRANSFERT_TITRE depuis (ou vers) une plateforme A qui
 * RESTE, ne doit plus faire réapparaître le cash/la quantité sur A.
 *
 * Repro (audit/raw/journal.md) : APPORT 1000€ sur A, TRANSFERT_CASH 400€ A→B
 * (une seule ligne Transaction, platformId=A, toPlatformId=B). Avant le fix,
 * `DELETE /api/platforms?id=B&force=1` supprimait cette ligne via le OR
 * `platformId===B OR toPlatformId===B` — donc aussi le débit de A — et le
 * rejeu du journal faisait remonter le cash de A à 1000€ (+400 fantômes).
 * Même mécanique pour TRANSFERT_TITRE (la quantité transférée réapparaît).
 *
 * Magasin Prisma minimal en mémoire, scopé aux seules opérations que la
 * route DELETE force émet (pas de FK réelles simulées ici : seul le contenu
 * des lignes Transaction après l'appel nous intéresse — c'est lui qu'on
 * rejoue ensuite avec le vrai moteur `app/lib/accounting/ledger.ts`).
 */

type Row = Record<string, unknown> & { id: string };
type Where = Record<string, unknown>;

function matches(row: Row, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") {
      return (v as Where[]).some((sub) => matches(row, sub));
    }
    if (k === "NOT") {
      return !matches(row, v as Where);
    }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const cond = v as Record<string, unknown>;
      if ("not" in cond) return row[k] !== cond.not;
      if ("in" in cond) return (cond.in as unknown[]).includes(row[k]);
      if ("notIn" in cond) return !(cond.notIn as unknown[]).includes(row[k]);
      if ("is" in cond) {
        // Filtre relationnel simplifié — non utilisé par les tests ci-dessous
        // (aucune liability seedée), mais gardé pour ne pas planter si appelé.
        return true;
      }
      return false;
    }
    return row[k] === v;
  });
}

function makeFakeStore() {
  const tables = new Map<string, Row[]>();
  const table = (model: string): Row[] => {
    let rows = tables.get(model);
    if (!rows) {
      rows = [];
      tables.set(model, rows);
    }
    return rows;
  };

  function modelHandler(model: string) {
    return {
      findFirst: async ({ where }: { where: Where }) =>
        table(model).find((r) => matches(r, where)) ?? null,
      findMany: async (args?: { where?: Where }) =>
        table(model).filter((r) => matches(r, args?.where)),
      count: async (args?: { where?: Where }) =>
        table(model).filter((r) => matches(r, args?.where)).length,
      deleteMany: async ({ where }: { where: Where }) => {
        const victims = table(model).filter((r) => matches(r, where));
        const ids = new Set(victims.map((r) => r.id));
        tables.set(model, table(model).filter((r) => !ids.has(r.id)));
        return { count: victims.length };
      },
      updateMany: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
        let count = 0;
        for (const row of table(model)) {
          if (matches(row, where)) {
            Object.assign(row, data);
            count++;
          }
        }
        return { count };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = table(model).find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      },
    };
  }

  const client: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "$transaction") {
          return async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(client);
        }
        if (typeof prop !== "string" || prop === "then") return undefined;
        return modelHandler(prop);
      },
    }
  );

  return {
    client,
    seed: (model: string, row: Row) => table(model).push(row),
    table,
  };
}

let store: ReturnType<typeof makeFakeStore>;

vi.mock("@/app/lib/prisma", () => ({
  get prisma() {
    return store.client;
  },
}));

vi.mock("@/app/lib/auth-helpers", () => ({
  requireUserId: async () => "u-1",
}));

import { DELETE } from "@/app/api/platforms/route";
import { replayTransactions } from "@/app/lib/accounting/ledger";
import { d } from "@/app/lib/money/decimal";
import type { LedgerTx } from "@/app/lib/accounting/types";

const USER = "u-1";
const A = "platform-a";
const B = "platform-b";

function seedBase() {
  store = makeFakeStore();
  store.seed("platform", { id: A, userId: USER, name: "A" });
  store.seed("platform", { id: B, userId: USER, name: "B" });
}

function requete(id: string) {
  return new Request(
    `http://localhost/api/platforms?id=${encodeURIComponent(id)}&force=1`,
    { method: "DELETE" }
  );
}

function tx(partial: Partial<LedgerTx> & Pick<LedgerTx, "id" | "type" | "platformId">): LedgerTx {
  return {
    fees: d(0),
    currency: "EUR",
    fxRateToEur: d(1),
    occurredAt: new Date("2024-01-01T00:00:00Z"),
    ...partial,
  };
}

beforeEach(() => {
  seedBase();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("JOU-03 — TRANSFERT_CASH survit au force-delete de sa destination", () => {
  beforeEach(() => {
    store.seed("transaction", {
      id: "t-apport",
      userId: USER,
      type: "APPORT",
      platformId: A,
      toPlatformId: null,
      assetId: null,
      cashAmountOriginal: "1000",
      fxRateToEur: "1",
      fees: "0",
      occurredAt: new Date("2024-01-01"),
    });
    store.seed("transaction", {
      id: "t-transfert",
      userId: USER,
      type: "TRANSFERT_CASH",
      platformId: A,
      toPlatformId: B,
      assetId: null,
      cashAmountOriginal: "400",
      fxRateToEur: "1",
      fees: "0",
      occurredAt: new Date("2024-02-01"),
    });
  });

  it("golden : force-delete de B laisse le cash de A à 600€ (pas 1000€)", async () => {
    const res = await DELETE(requete(B));
    expect(res.status).toBe(200);

    // B a bien disparu, et aucune transaction ne pointe plus vers elle.
    expect(store.table("platform").some((p) => p.id === B)).toBe(false);
    const remaining = store.table("transaction");
    expect(remaining.every((r) => r.platformId !== B && r.toPlatformId !== B)).toBe(true);

    // Le transfert a été converti en écriture à un seul côté sur A.
    const survivor = remaining.find((r) => r.id === "t-transfert");
    expect(survivor).toBeDefined();
    expect(survivor?.toPlatformId).toBeNull();
    expect(survivor?.platformId).toBe(A);
    expect(survivor?.type).toBe("TRANSFERT_CASH");

    // Rejeu du vrai moteur sur ce qui reste : le débit de 400€ tient toujours.
    const ledgerTxs = remaining.map((r) =>
      tx({
        id: r.id as string,
        type: r.type as LedgerTx["type"],
        platformId: r.platformId as string,
        toPlatformId: r.toPlatformId as string | null,
        cashAmountOriginal: d(r.cashAmountOriginal as string),
        fxRateToEur: d(r.fxRateToEur as string),
        fees: d(r.fees as string),
        occurredAt: r.occurredAt as Date,
      })
    );
    const state = replayTransactions(ledgerTxs);
    expect((state.cashByPlatform.get(A) ?? d(0)).toFixed(2)).toBe("600.00");
    expect(state.cashByPlatform.has(B)).toBe(false);
  });
});

describe("JOU-03 — TRANSFERT_TITRE (A→B) survit au force-delete de sa destination", () => {
  const ASSET = "asset-x";

  beforeEach(() => {
    // L'actif est « home » sur A, pas sur B : la conversion s'applique.
    store.seed("asset", { id: ASSET, userId: USER, platformId: A });
    store.seed("transaction", {
      id: "t-achat",
      userId: USER,
      type: "ACHAT",
      platformId: A,
      toPlatformId: null,
      assetId: ASSET,
      quantity: "10",
      unitPrice: "100",
      fxRateToEur: "1",
      fees: "0",
      occurredAt: new Date("2024-01-01"),
    });
    store.seed("transaction", {
      id: "t-transfert-titre",
      userId: USER,
      type: "TRANSFERT_TITRE",
      platformId: A,
      toPlatformId: B,
      assetId: ASSET,
      quantity: "4",
      fxRateToEur: "1",
      fees: "0",
      occurredAt: new Date("2024-02-01"),
    });
  });

  it("golden : force-delete de B laisse la quantité de A à 6 (pas 10)", async () => {
    const res = await DELETE(requete(B));
    expect(res.status).toBe(200);

    const remaining = store.table("transaction");
    const survivor = remaining.find((r) => r.id === "t-transfert-titre");
    expect(survivor?.toPlatformId).toBeNull();
    expect(survivor?.platformId).toBe(A);

    const ledgerTxs = remaining.map((r) =>
      tx({
        id: r.id as string,
        type: r.type as LedgerTx["type"],
        platformId: r.platformId as string,
        toPlatformId: r.toPlatformId as string | null,
        assetId: r.assetId as string | null,
        quantity: r.quantity != null ? d(r.quantity as string) : null,
        unitPrice: r.unitPrice != null ? d(r.unitPrice as string) : null,
        fxRateToEur: d(r.fxRateToEur as string),
        fees: d(r.fees as string),
        occurredAt: r.occurredAt as Date,
      })
    );
    const state = replayTransactions(ledgerTxs);
    const posA = state.positions.get(`${ASSET}::${A}`);
    expect(posA?.quantity.toFixed(0)).toBe("6");
    expect(state.positions.has(`${ASSET}::${B}`)).toBe(false);
  });
});

describe("JOU-03 — TRANSFERT_CASH (B→A) survit au force-delete de sa source", () => {
  beforeEach(() => {
    store.seed("transaction", {
      id: "t-apport-b",
      userId: USER,
      type: "APPORT",
      platformId: B,
      toPlatformId: null,
      assetId: null,
      cashAmountOriginal: "1000",
      fxRateToEur: "1",
      fees: "0",
      occurredAt: new Date("2024-01-01"),
    });
    store.seed("transaction", {
      id: "t-transfert-in",
      userId: USER,
      type: "TRANSFERT_CASH",
      platformId: B,
      toPlatformId: A,
      assetId: null,
      cashAmountOriginal: "400",
      fxRateToEur: "1",
      fees: "0",
      occurredAt: new Date("2024-02-01"),
    });
  });

  it("golden : force-delete de B convertit le crédit reçu par A en APPORT (400€ conservés)", async () => {
    const res = await DELETE(requete(B));
    expect(res.status).toBe(200);

    const remaining = store.table("transaction");
    const survivor = remaining.find((r) => r.id === "t-transfert-in");
    expect(survivor?.type).toBe("APPORT");
    expect(survivor?.platformId).toBe(A);
    expect(survivor?.toPlatformId).toBeNull();

    const ledgerTxs = remaining.map((r) =>
      tx({
        id: r.id as string,
        type: r.type as LedgerTx["type"],
        platformId: r.platformId as string,
        toPlatformId: r.toPlatformId as string | null,
        cashAmountOriginal: d(r.cashAmountOriginal as string),
        fxRateToEur: d(r.fxRateToEur as string),
        fees: d(r.fees as string),
        occurredAt: r.occurredAt as Date,
      })
    );
    const state = replayTransactions(ledgerTxs);
    expect((state.cashByPlatform.get(A) ?? d(0)).toFixed(2)).toBe("400.00");
  });
});

describe("JOU-03 — TRANSFERT_TITRE (B→A) : cas refusé, PRU non reconstituable", () => {
  const ASSET = "asset-y";

  beforeEach(() => {
    store.seed("asset", { id: ASSET, userId: USER, platformId: B });
    store.seed("transaction", {
      id: "t-achat-b",
      userId: USER,
      type: "ACHAT",
      platformId: B,
      toPlatformId: null,
      assetId: ASSET,
      quantity: "10",
      unitPrice: "100",
      fxRateToEur: "1",
      fees: "0",
      occurredAt: new Date("2024-01-01"),
    });
    // L'actif transféré reste vivant : son « home » (asset.platformId) est A,
    // pas B — donc pas emporté par la suppression des actifs de B.
    store.seed("asset", { id: "asset-y-home-a", userId: USER, platformId: A });
    store.seed("transaction", {
      id: "t-transfert-titre-in",
      userId: USER,
      type: "TRANSFERT_TITRE",
      platformId: B,
      toPlatformId: A,
      assetId: "asset-y-home-a",
      quantity: "4",
      fxRateToEur: "1",
      fees: "0",
      occurredAt: new Date("2024-02-01"),
    });
  });

  it("refuse le force-delete (409) plutôt que d'inventer ou de perdre le PRU transféré", async () => {
    const res = await DELETE(requete(B));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("TRANSFER_TITRE_SOURCE_UNRESOLVED");

    // Rien n'a été supprimé : refus avant toute mutation.
    expect(store.table("platform").some((p) => p.id === B)).toBe(true);
    expect(store.table("transaction").some((r) => r.id === "t-transfert-titre-in")).toBe(true);
  });
});
