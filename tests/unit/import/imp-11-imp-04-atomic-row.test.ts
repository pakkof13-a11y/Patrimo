import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportDraftRow } from "@/app/lib/import/map-rows";

/**
 * IMP-11 et IMP-04 — atomicité PAR LIGNE de l'import CSV.
 *
 * Les deux tickets se referment avec le même mécanisme : `resolveOrCreateAsset`
 * (qui peut créer un `Asset`) et `createTransaction` d'une même ligne partagent
 * désormais un seul `prisma.$transaction`. Ce faux client Prisma est un
 * mini-magasin EN MÉMOIRE (tableaux `assets` / `transactions` /
 * `envelopeEvents`) dont `$transaction` prend un instantané avant d'exécuter
 * le callback et le restaure si celui-ci lève — la même sémantique qu'un vrai
 * ROLLBACK Postgres. C'est ce qui permet de prouver un vrai rollback, pas
 * seulement que les mocks ont été appelés dans le bon ordre.
 */

type Row = Record<string, unknown>;

function makeFakeDb() {
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}-${++counter}`;

  const state = {
    assets: [] as Row[],
    transactions: [] as Row[],
    envelopeEvents: [] as Row[],
  };

  function matches(row: Row, where: Record<string, unknown>): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && "equals" in (v as Record<string, unknown>)) {
        const clause = v as { equals: unknown; mode?: string };
        const rowValue = row[k];
        if (clause.mode === "insensitive") {
          return (
            typeof rowValue === "string" &&
            typeof clause.equals === "string" &&
            rowValue.toLowerCase() === clause.equals.toLowerCase()
          );
        }
        return rowValue === clause.equals;
      }
      return row[k] === v;
    });
  }

  /**
   * Marqueur de panne : toute ligne dont les notes contiennent ce jeton fait
   * échouer `transaction.create`, comme le ferait une contrainte Postgres ou
   * un taux FX inconnu en base réelle.
   */
  const FORCE_FAIL = "FORCE_FAIL_INSERT";

  const client: {
    platform: { findFirst: (a: { where: Record<string, unknown> }) => Promise<Row | null> };
    asset: {
      findFirst: (a: { where: Record<string, unknown> }) => Promise<Row | null>;
      create: (a: { data: Row }) => Promise<Row>;
      count: (a: { where: Record<string, unknown> }) => Promise<number>;
    };
    assetEnvelopeEvent: { create: (a: { data: Row }) => Promise<Row> };
    transaction: {
      count: (a: { where: Record<string, unknown> }) => Promise<number>;
      findFirst: (a: { where: Record<string, unknown> }) => Promise<Row | null>;
      findMany: (a: { where: Record<string, unknown> }) => Promise<Row[]>;
      create: (a: { data: Row }) => Promise<Row>;
    };
    $transaction: <T>(fn: (tx: typeof client) => Promise<T>) => Promise<T>;
  } = {
    platform: {
      findFirst: async ({ where }) =>
        where.id === "p1" && where.userId === "u1"
          ? { id: "p1", userId: "u1", name: "Test" }
          : null,
    },
    asset: {
      findFirst: async ({ where }) => state.assets.find((a) => matches(a, where)) ?? null,
      create: async ({ data }) => {
        const asset = { id: nextId("asset"), createdAt: new Date(), ...data };
        state.assets.push(asset);
        return asset;
      },
      count: async ({ where }) =>
        state.assets.filter((a) => a.userId === where.userId).length,
    },
    assetEnvelopeEvent: {
      create: async ({ data }) => {
        const evt = { id: nextId("evt"), ...data };
        state.envelopeEvents.push(evt);
        return evt;
      },
    },
    transaction: {
      count: async ({ where }) =>
        state.transactions.filter((t) => t.userId === where.userId).length,
      findFirst: async ({ where }) => {
        const rows = state.transactions
          .filter((t) => t.userId === where.userId)
          .sort(
            (a, b) =>
              (b.occurredAt as Date).getTime() - (a.occurredAt as Date).getTime()
          );
        return rows[0] ?? null;
      },
      findMany: async ({ where }) =>
        state.transactions
          .filter((t) => t.userId === where.userId)
          .slice()
          .sort(
            (a, b) =>
              (a.occurredAt as Date).getTime() - (b.occurredAt as Date).getTime()
          ),
      create: async ({ data }) => {
        if (typeof data.notes === "string" && data.notes.includes(FORCE_FAIL)) {
          throw new Error("panne simulée d'insertion (FX_RATE_UNKNOWN, contrainte…)");
        }
        const tx = { id: nextId("tx"), ...data };
        state.transactions.push(tx);
        return tx;
      },
    },
    $transaction: async (fn) => {
      // Instantané avant le callback : restauré si `fn` lève, exactement
      // comme un ROLLBACK — c'est ce qui rend ce test capable de détecter un
      // Asset ou une Transaction qui aurait fuité hors de la transaction.
      // Une copie superficielle suffit : les lignes ne sont jamais mutées en
      // place une fois créées (seulement `push`ées), et certains champs sont
      // des `Prisma.Decimal` qu'un clonage profond (structuredClone) ne sait
      // pas copier.
      const snapshot = {
        assets: state.assets.slice(),
        transactions: state.transactions.slice(),
        envelopeEvents: state.envelopeEvents.slice(),
      };
      try {
        return await fn(client);
      } catch (e) {
        state.assets = snapshot.assets;
        state.transactions = snapshot.transactions;
        state.envelopeEvents = snapshot.envelopeEvents;
        throw e;
      }
    },
  };

  return { client, state, FORCE_FAIL };
}

let db: ReturnType<typeof makeFakeDb>;

vi.mock("@/app/lib/prisma", () => ({
  get prisma() {
    return db.client;
  },
}));

beforeEach(() => {
  db = makeFakeDb();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function row(overrides: Partial<ImportDraftRow>): ImportDraftRow {
  return {
    line: 1,
    selected: true,
    status: "ok",
    errors: [],
    warnings: [],
    type: "ACHAT",
    occurredAt: "2024-01-10T00:00:00.000Z",
    ticker: "AAPL",
    name: "Apple",
    quantity: "10",
    unitPrice: "100",
    fees: "0",
    currency: "EUR",
    cashAmount: null,
    notes: null,
    platformName: null,
    assetClass: "ACTIONS",
    raw: {},
    ...overrides,
  } as ImportDraftRow;
}

async function commit(rows: ImportDraftRow[]) {
  vi.resetModules();
  const mod = await import("@/app/lib/import/commit");
  return mod.commitImportRows({
    userId: "u1",
    platformId: "p1",
    rows,
    skipDuplicates: false,
  });
}

describe("IMP-11 — Asset + Transaction atomiques par ligne", () => {
  it("un Asset créé pour une ligne qui échoue ensuite ne doit pas rester en base (pas d'orphelin)", async () => {
    // Ticker inconnu : resolveOrCreateAsset va créer un nouvel Asset. Quantité
    // 0 : createTransaction lève INVALID_QTY *après* cette création, dans la
    // même transaction — le comportement réel avant le fix (472aad6, lot A
    // n'ayant traité que IMP-04).
    const result = await commit([
      row({ ticker: "ZZZ", name: "Zorro Corp", quantity: "0" }),
    ]);

    expect(result.created).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toMatch(/Quantité/);

    // La preuve IMP-11 : aucun Asset fantôme, aucune Transaction fantôme.
    expect(db.state.assets).toHaveLength(0);
    expect(db.state.transactions).toHaveLength(0);
    expect(result.assetsCreated).toBe(0);
  });

  it("une ligne valide garde son Asset : le rollback ne s'applique qu'aux lignes en échec", async () => {
    const result = await commit([row({ ticker: "AAPL", quantity: "5" })]);

    expect(result.created).toBe(1);
    expect(result.errors).toEqual([]);
    expect(db.state.assets).toHaveLength(1);
    expect(db.state.transactions).toHaveLength(1);
    expect(result.assetsCreated).toBe(1);
  });
});

describe("IMP-04 — un insert en échec sur une ligne ne corrompt ni la base ni le ledgerState suivant", () => {
  it("la ligne du milieu échoue : aucune trace en base, les lignes voisines non affectées, le ledgerState reste correct pour la suivante", async () => {
    const rows = [
      row({ line: 1, ticker: "AAPL", type: "ACHAT", quantity: "10" }),
      row({
        line: 2,
        ticker: "AAPL",
        type: "VENTE",
        quantity: "10",
        notes: db.FORCE_FAIL,
      }),
      row({ line: 3, ticker: "AAPL", type: "VENTE", quantity: "10" }),
    ];

    const result = await commit(rows);

    // Ligne 2 échoue ; 1 et 3 réussissent.
    expect(result.created).toBe(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(2);

    // Un seul Asset (AAPL, réutilisé via le cache du lot par les 3 lignes) ;
    // deux Transaction persistées (lignes 1 et 3) — rien de la ligne 2.
    expect(db.state.assets).toHaveLength(1);
    expect(db.state.transactions).toHaveLength(2);
    const types = db.state.transactions.map((t) => t.type);
    expect(types).toEqual(["ACHAT", "VENTE"]);

    /*
      La preuve que `ledgerState` n'a pas été corrompu par la ligne 2 : si la
      VENTE de 10 de la ligne 2 avait été appliquée à l'état partagé en
      mémoire AVANT l'échec de l'insert (régression que ce correctif exclut),
      la position AAPL serait retombée à 0 et la VENTE de 10 de la ligne 3
      aurait été refusée (survente) — ou silencieusement clampée. Elle est ici
      acceptée telle quelle : la position réelle (10, issue de la seule ligne
      1 committée) est bien ce que la ligne 3 a vu.
    */
    expect(result.created).toBe(2);
  });

  it("une ligne dont l'insert échoue et qui aurait dû créer un Asset ne laisse ni Asset ni Transaction", async () => {
    const rows = [
      row({
        line: 1,
        ticker: "NEWCO",
        name: "Newco Inc",
        type: "ACHAT",
        quantity: "3",
        notes: db.FORCE_FAIL,
      }),
      row({ line: 2, ticker: "AAPL", type: "ACHAT", quantity: "1" }),
    ];

    const result = await commit(rows);

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.line).toBe(1);

    // Seul l'Asset de la ligne 2 (AAPL) doit exister — pas de NEWCO orphelin.
    expect(db.state.assets).toHaveLength(1);
    expect(db.state.assets[0]!.ticker).toBe("AAPL");
    expect(db.state.transactions).toHaveLength(1);
  });
});
