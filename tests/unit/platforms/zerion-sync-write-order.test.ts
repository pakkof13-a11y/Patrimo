import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/wallets/zerion/sync` — Prisma mocké.
 *
 * API-W-03 : `walletAddress` / `walletApiKey` étaient écrits en base AVANT
 * l'appel `fetchZerionPortfolio`. Une clé API invalide (401 AUTH côté
 * Zerion) finissait donc par écraser une clé valide déjà enregistrée, alors
 * même que la requête se terminait en erreur.
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

vi.mock("@/app/lib/crypto/defi-sync", () => ({
  syncDefiPositions: vi.fn().mockResolvedValue({ positionsSeen: 0, txsCreated: 0 }),
}));

const fetchZerionPortfolio = vi.fn();

vi.mock("@/app/lib/zerion", async () => {
  const actual = await vi.importActual<typeof import("@/app/lib/zerion")>(
    "@/app/lib/zerion"
  );
  return {
    ...actual,
    fetchZerionPortfolio: (...a: unknown[]) => fetchZerionPortfolio(...a),
    writeZerionHistoryToLedger: vi.fn().mockResolvedValue({}),
    writeZerionBalancesToLedger: vi.fn().mockResolvedValue({}),
    repairZerionReconciliationDates: vi.fn().mockResolvedValue(0),
  };
});

const { POST } = await import("@/app/api/wallets/zerion/sync/route");
const { ZerionError } = await import("@/app/lib/zerion");

const VALID_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const OLD_ADDRESS = "0x0000000000000000000000000000000000dEaD";

const requete = (body: unknown) =>
  new Request("http://localhost/api/wallets/zerion/sync", {
    method: "POST",
    body: JSON.stringify(body),
  });

const plateforme = (walletApiKey: string | null, walletAddress: string | null) => ({
  id: "pf1",
  name: "Ledger EVM",
  logoKey: "ETHEREUM",
  walletAddress,
  walletApiKey,
});

beforeEach(() => {
  update.mockReset();
  findFirst.mockReset();
  fetchZerionPortfolio.mockReset();
});

describe("API-W-03 — l'écriture n'a lieu qu'après succès de fetchZerionPortfolio", () => {
  it("clé API invalide (401 AUTH simulé) : platform.update n'est jamais appelé", async () => {
    findFirst.mockResolvedValue(plateforme("clef-valide-existante", OLD_ADDRESS));
    fetchZerionPortfolio.mockRejectedValue(
      new ZerionError("Clé API invalide", "AUTH", 401)
    );

    const res = await POST(
      requete({
        platformId: "pf1",
        address: VALID_ADDRESS,
        apiKey: "nouvelle-clef-invalide",
      })
    );

    expect(res.status).toBe(401);
    const bodyJson = (await res.json()) as { code: string };
    expect(bodyJson.code).toBe("AUTH");
    expect(update).not.toHaveBeenCalled();
  });

  it("succès Zerion : platform.update persiste alors l'adresse/clé fournies", async () => {
    findFirst.mockResolvedValue(plateforme("ancienne-clef", OLD_ADDRESS));
    fetchZerionPortfolio.mockResolvedValue({
      balances: [],
      transactions: [],
      historyTruncated: false,
      historyPageCount: 1,
    });

    const res = await POST(
      requete({
        platformId: "pf1",
        address: VALID_ADDRESS,
        apiKey: "nouvelle-clef-valide",
        writeLedger: false,
      })
    );

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { id: "pf1" },
      data: { walletAddress: VALID_ADDRESS, walletApiKey: "nouvelle-clef-valide" },
    });
  });
});
