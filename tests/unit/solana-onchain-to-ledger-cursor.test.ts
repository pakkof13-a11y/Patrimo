/**
 * CRY-03 — `writeOnchainTxsToLedger` reprenait toujours les `limit` lignes
 * les plus ANCIENNES (status=success, blockTime asc) sans exclure celles déjà
 * journalisées. Au-delà de `limit` lignes en base, toute ligne plus récente
 * n'était jamais parcourue : arrêt silencieux de la journalisation.
 *
 * Ici : 150 lignes anciennes déjà au journal + 1 ligne récente (151e) → elle
 * doit être journalisée.
 *
 * Prisma mocké (table on-chain en mémoire avec take / notIn / in / cursor).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  signature: string;
  blockTime: Date;
  createdAt: Date;
  status: string;
  type: string;
  transfers: unknown;
};

const onchainFindMany = vi.fn();
const txFindMany = vi.fn();
const txFindFirst = vi.fn();
const txUpdate = vi.fn();
const assetFindMany = vi.fn();
const assetFindFirst = vi.fn();
const assetCreate = vi.fn();
const assetUpdate = vi.fn();
const createTransaction = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    blockchainOnchainTx: {
      findMany: (...a: unknown[]) => onchainFindMany(...a),
    },
    transaction: {
      findMany: (...a: unknown[]) => txFindMany(...a),
      findFirst: (...a: unknown[]) => txFindFirst(...a),
      update: (...a: unknown[]) => txUpdate(...a),
    },
    asset: {
      findMany: (...a: unknown[]) => assetFindMany(...a),
      findFirst: (...a: unknown[]) => assetFindFirst(...a),
      create: (...a: unknown[]) => assetCreate(...a),
      update: (...a: unknown[]) => assetUpdate(...a),
    },
  },
}));

vi.mock("@/app/lib/transactions/service", () => ({
  createTransaction: (...a: unknown[]) => createTransaction(...a),
}));
vi.mock("@/app/lib/portfolio/ledger-cache", () => ({
  invalidateLedgerCache: vi.fn(),
}));
vi.mock("@/app/lib/solana/token-meta", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/solana/token-meta")>();
  return {
    ...actual,
    resolveSolanaMintMeta: vi.fn(async (mint: string) => ({
      mint,
      symbol: "TOK",
      name: "Token",
      logoUrl: null,
    })),
    resolveSolanaMintMetas: vi.fn(async () => new Map()),
  };
});

const { writeOnchainTxsToLedger, ONCHAIN_NOTE_PREFIX } = await import(
  "@/app/lib/market/solana-onchain-to-ledger"
);

/** Signature base58 valide (64+ chars) unique par index. */
function sigFor(i: number): string {
  const base = "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQ";
  const suffix = String(i).padStart(4, "1").replace(/0/g, "1");
  return (base + suffix).slice(0, 88);
}

const OLD_COUNT = 150;
const RECENT_SIG = sigFor(9999);

function buildTable(): Row[] {
  const rows: Row[] = [];
  const t0 = Date.parse("2024-01-01T00:00:00.000Z");
  for (let i = 0; i < OLD_COUNT; i += 1) {
    rows.push({
      id: `row-${i}`,
      signature: sigFor(i),
      blockTime: new Date(t0 + i * 3600_000),
      createdAt: new Date(t0),
      status: "success",
      type: "TRANSFER",
      transfers: [{ kind: "SOL", direction: "in", amount: "0.5" }],
    });
  }
  rows.push({
    id: "row-recent",
    signature: RECENT_SIG,
    blockTime: new Date("2025-06-01T00:00:00.000Z"),
    createdAt: new Date("2025-06-01T00:00:00.000Z"),
    status: "success",
    type: "TRANSFER",
    transfers: [{ kind: "SOL", direction: "in", amount: "2" }],
  });
  return rows;
}

/** Simule findMany Prisma : where.signature in/notIn, status, blockTime not null, orderBy, cursor, skip, take. */
function simulateFindMany(table: Row[], args: unknown): Row[] {
  const a = args as {
    where?: {
      signature?: { in?: string[]; notIn?: string[] };
      status?: string;
      blockTime?: { not?: null };
      type?: { not?: string };
      createdAt?: { gte?: Date };
    };
    orderBy?: unknown;
    take?: number;
    skip?: number;
    cursor?: { id?: string };
  };
  let rows = [...table];
  const w = a.where ?? {};
  if (w.signature?.in) rows = rows.filter((r) => w.signature!.in!.includes(r.signature));
  if (w.signature?.notIn) rows = rows.filter((r) => !w.signature!.notIn!.includes(r.signature));
  if (w.status) rows = rows.filter((r) => r.status === w.status);
  if (w.blockTime && "not" in w.blockTime) rows = rows.filter((r) => r.blockTime != null);
  if (w.type?.not) rows = rows.filter((r) => r.type !== w.type!.not);
  if (w.createdAt?.gte) rows = rows.filter((r) => r.createdAt >= w.createdAt!.gte!);
  rows.sort((x, y) => {
    const d = x.blockTime.getTime() - y.blockTime.getTime();
    return d !== 0 ? d : x.id.localeCompare(y.id);
  });
  if (a.cursor?.id) {
    const idx = rows.findIndex((r) => r.id === a.cursor!.id);
    rows = idx >= 0 ? rows.slice(idx) : [];
  }
  if (a.skip) rows = rows.slice(a.skip);
  if (a.take != null) rows = rows.slice(0, a.take);
  return rows;
}

beforeEach(() => {
  const table = buildTable();
  // Journal : les 150 anciennes sont déjà journalisées (date = blockTime)
  const journal = table.slice(0, OLD_COUNT).map((r) => ({
    id: `j-${r.id}`,
    notes: `${ONCHAIN_NOTE_PREFIX}${r.signature}] [wallet-sync:solana] TRANSFER in SOL`,
    occurredAt: r.blockTime,
  }));

  onchainFindMany.mockReset().mockImplementation(async (args: unknown) =>
    simulateFindMany(table, args)
  );
  txFindMany.mockReset().mockResolvedValue(journal);
  txFindFirst.mockReset().mockImplementation(async (args: unknown) => {
    const contains = (args as { where?: { notes?: { contains?: string } } })
      ?.where?.notes?.contains;
    const hit = contains ? journal.find((j) => j.notes.includes(contains)) : null;
    return hit ? { id: hit.id } : null;
  });
  txUpdate.mockReset().mockResolvedValue({});
  assetFindMany.mockReset().mockResolvedValue([]);
  assetFindFirst.mockReset().mockResolvedValue({ id: "asset-sol", ticker: "SOL", name: "Solana" });
  assetCreate.mockReset().mockResolvedValue({ id: "asset-sol" });
  assetUpdate.mockReset().mockResolvedValue({});
  createTransaction.mockReset().mockResolvedValue({ id: "new-tx" });
});

describe("CRY-03 — plafond `limit` et lignes déjà journalisées", () => {
  it("151e ligne (récente, non journalisée) est journalisée malgré 150 anciennes déjà au journal", async () => {
    const res = await writeOnchainTxsToLedger("u1", "pf1", { limit: 150 });

    const notesWritten = createTransaction.mock.calls.map(
      (c) => (c[0] as { notes: string }).notes
    );
    expect(notesWritten.some((n) => n.includes(`${ONCHAIN_NOTE_PREFIX}${RECENT_SIG}]`))).toBe(true);
    expect(res.journalCreated).toBe(1);
    expect(res.errors).toBe(0);
  });

  it("n'écrit aucun doublon pour les 150 lignes déjà journalisées", async () => {
    await writeOnchainTxsToLedger("u1", "pf1", { limit: 150 });

    expect(createTransaction).toHaveBeenCalledTimes(1);
    const notes = (createTransaction.mock.calls[0]![0] as { notes: string }).notes;
    expect(notes).toContain(RECENT_SIG);
  });
});
