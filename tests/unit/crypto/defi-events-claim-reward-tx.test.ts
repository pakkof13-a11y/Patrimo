import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/crypto/defi/positions/[id]/events` — Prisma mocké.
 *
 * API-W-01 : une `eventDate` invalide passait la validation de la route
 * (`z.string().min(1)`), atteignait `claimReward()` — qui décrémente
 * `DefiReward.accruedQuantity` en auto-commit — puis `recordEvent()`
 * rejetait la date et renvoyait 400. Rejouer la même requête invalide
 * décrémentait l'accru une fois de plus à chaque tentative, sans jamais
 * journaliser d'événement.
 *
 * Correction : la date est validée dans le schéma zod avant tout accès
 * Prisma, et `claimReward` + `recordEvent` commettent dans une seule
 * transaction (`prisma.$transaction`) — un rejet de l'un annule l'autre.
 */

const findFirstPosition = vi.fn();
const rewardFindUnique = vi.fn();
const rewardUpdate = vi.fn();
const eventFindFirst = vi.fn();
const eventCreate = vi.fn();

function txClient() {
  return {
    defiReward: {
      findUnique: (...a: unknown[]) => rewardFindUnique(...a),
      update: (...a: unknown[]) => rewardUpdate(...a),
    },
    defiEvent: {
      findFirst: (...a: unknown[]) => eventFindFirst(...a),
      create: (...a: unknown[]) => eventCreate(...a),
    },
  };
}

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    defiPositionDetail: {
      findFirst: (...a: unknown[]) => findFirstPosition(...a),
    },
    defiReward: {
      findUnique: (...a: unknown[]) => rewardFindUnique(...a),
      update: (...a: unknown[]) => rewardUpdate(...a),
    },
    defiEvent: {
      findFirst: (...a: unknown[]) => eventFindFirst(...a),
      create: (...a: unknown[]) => eventCreate(...a),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(txClient()),
  },
}));

vi.mock("@/app/lib/auth-helpers", () => ({ requireUserId: async () => "u1" }));

const { POST } = await import("@/app/api/crypto/defi/positions/[id]/events/route");

const requete = (body: unknown) =>
  new Request("http://localhost/api/crypto/defi/positions/pos1/events", {
    method: "POST",
    body: JSON.stringify(body),
  });

const ctx = () => ({ params: Promise.resolve({ id: "pos1" }) });

const reward = () => ({
  id: "rw1",
  accruedQuantity: "100",
  claimedQuantity: "0",
  valueEur: null,
});

beforeEach(() => {
  findFirstPosition.mockReset().mockResolvedValue({ id: "pos1", status: "ACTIVE" });
  rewardFindUnique.mockReset().mockResolvedValue(reward());
  rewardUpdate.mockReset();
  eventFindFirst.mockReset().mockResolvedValue(null);
  eventCreate.mockReset().mockResolvedValue({ id: "ev1" });
});

describe("API-W-01 — CLAIM_REWARD et son événement commettent ensemble", () => {
  it("eventDate invalide : 400 avant tout effet, defiReward.update jamais appelé", async () => {
    const res = await POST(
      requete({
        eventType: "CLAIM_REWARD",
        eventDate: "pas-une-date",
        symbol: "CRV",
        quantity: "10",
      }),
      ctx()
    );

    expect(res.status).toBe(400);
    expect(rewardUpdate).not.toHaveBeenCalled();
  });

  it("rejouer le même 400 deux fois : toujours aucun décrément cumulatif", async () => {
    const body = {
      eventType: "CLAIM_REWARD",
      eventDate: "pas-une-date",
      symbol: "CRV",
      quantity: "10",
    };

    const res1 = await POST(requete(body), ctx());
    const res2 = await POST(requete(body), ctx());

    expect(res1.status).toBe(400);
    expect(res2.status).toBe(400);
    expect(rewardUpdate).not.toHaveBeenCalled();
  });

  it("eventDate valide : claimReward et recordEvent commettent tous les deux", async () => {
    const res = await POST(
      requete({
        eventType: "CLAIM_REWARD",
        eventDate: "2026-01-01T00:00:00.000Z",
        symbol: "CRV",
        quantity: "10",
      }),
      ctx()
    );

    expect(res.status).toBe(201);
    expect(rewardUpdate).toHaveBeenCalledTimes(1);
    expect(eventCreate).toHaveBeenCalledTimes(1);
  });
});
