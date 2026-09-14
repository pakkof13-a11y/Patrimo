import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/wallets/solana/sync` — Prisma mocké.
 *
 * API-W-02 : l'adresse fournie était écrite en base (`platform.update`)
 * AVANT la validation de son format. Une adresse mal formée finissait donc
 * par écraser une adresse valide déjà enregistrée, alors même que la
 * requête se terminait en 400 INVALID_ADDRESS.
 */

const update = vi.fn();
const findFirst = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    platform: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      update: (...a: unknown[]) => update(...a),
    },
  },
}));

vi.mock("@/app/lib/auth-helpers", () => ({ requireUserId: async () => "u1" }));

vi.mock("@/app/lib/api/simple-rate-limit", () => ({
  consumeRateLimit: async () => ({ ok: true, remaining: 3 }),
}));

// Le RPC lui-même n'est pas le sujet ici : seul l'ordre écriture/validation
// est sous contrôle. `syncSolanaWalletFull` ne doit jamais être atteint
// quand l'adresse est invalide.
const syncSolanaWalletFull = vi.fn();
const fetchWalletBalanceSnapshot = vi.fn();

vi.mock("@/app/lib/solana", async () => {
  const actual = await vi.importActual<typeof import("@/app/lib/solana")>(
    "@/app/lib/solana"
  );
  return {
    ...actual,
    syncSolanaWalletFull: (...a: unknown[]) => syncSolanaWalletFull(...a),
    fetchWalletBalanceSnapshot: (...a: unknown[]) =>
      fetchWalletBalanceSnapshot(...a),
  };
});

const { POST } = await import("@/app/api/wallets/solana/sync/route");

const VALID_ADDRESS = "5QQuBjEBuHCAKUcE2c9DbVr3r2w3pnJg93eqVjf4tKnf";

const requete = (body: unknown) =>
  new Request("http://localhost/api/wallets/solana/sync", {
    method: "POST",
    body: JSON.stringify(body),
  });

const plateforme = (walletAddress: string | null) => ({
  id: "pf1",
  name: "Phantom",
  type: "CRYPTO",
  walletAddress,
  lastKnownSignature: null,
  lastSyncedAt: null,
});

beforeEach(() => {
  update.mockReset();
  findFirst.mockReset();
  syncSolanaWalletFull.mockReset().mockResolvedValue({
    ledger: null,
    ledgerError: null,
    txSync: null,
    snapshot: { balanceSol: 0, tokens: [] },
  });
  fetchWalletBalanceSnapshot.mockReset();
});

describe("API-W-02 — l'écriture n'a lieu qu'après validation du format", () => {
  it("adresse mal formée : platform.update n'est jamais appelé, 400 INVALID_ADDRESS", async () => {
    findFirst.mockResolvedValue(plateforme(VALID_ADDRESS));

    const res = await POST(
      requete({ platformId: "pf1", address: "0xdead-pas-du-base58" })
    );

    expect(res.status).toBe(400);
    const bodyJson = (await res.json()) as { code: string };
    expect(bodyJson.code).toBe("INVALID_ADDRESS");
    expect(update).not.toHaveBeenCalled();
    expect(syncSolanaWalletFull).not.toHaveBeenCalled();
  });

  it("adresse valide et différente : platform.update est appelé une fois validée", async () => {
    findFirst.mockResolvedValue(plateforme("ancienne-adresse-differente"));

    const res = await POST(requete({ platformId: "pf1", address: VALID_ADDRESS }));

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: "pf1" },
      data: { walletAddress: VALID_ADDRESS },
    });
  });

  it("adresse manquante et aucune adresse en base : 400 NO_WALLET, aucune écriture", async () => {
    findFirst.mockResolvedValue(plateforme(null));

    const res = await POST(requete({ platformId: "pf1" }));

    expect(res.status).toBe(400);
    const bodyJson = (await res.json()) as { code: string };
    expect(bodyJson.code).toBe("NO_WALLET");
    expect(update).not.toHaveBeenCalled();
  });
});
