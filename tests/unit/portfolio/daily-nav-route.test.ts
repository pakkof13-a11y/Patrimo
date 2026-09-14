import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/portfolio/daily-nav — validation des paramètres (revue P27).
 *
 * `getDailyNav` est mocké : ces tests ne portent que sur ce que la route fait
 * de `scope` / `from` / `to` avant d'appeler le moteur — jamais sur le calcul
 * lui-même, déjà couvert par `get-daily-nav.test.ts`.
 */

const getDailyNav = vi.fn();
const requireUserId = vi.fn();

vi.mock("@/app/lib/auth-helpers", () => ({
  requireUserId: () => requireUserId(),
}));

vi.mock("@/app/lib/portfolio/historical/get-daily-nav", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getDailyNav: (...a: unknown[]) => getDailyNav(...a),
  };
});

import { GET } from "@/app/api/portfolio/daily-nav/route";
import { lastCloseDay } from "@/app/lib/portfolio/historical/history-window";

function req(qs: string) {
  return new Request(`https://exemple.test/api/portfolio/daily-nav${qs}`);
}

function emptyResult(from: string, to: string) {
  return {
    scope: "financier",
    from,
    to,
    step: "day",
    points: [],
    asOfDay: null,
    fetchedAt: null,
  };
}

beforeEach(() => {
  requireUserId.mockReset().mockResolvedValue("u1");
  getDailyNav.mockReset().mockImplementation(
    async (opts: { from: string; to: string }) => emptyResult(opts.from, opts.to)
  );
});

describe("scope — vide retombe sur le défaut, invalide reste un 400", () => {
  it("?scope= (vide) sert financier, pas un 400", async () => {
    const res = await GET(req("?scope="));
    expect(res.status).toBe(200);
    expect(getDailyNav.mock.calls[0]![0].scope).toBe("financier");
  });

  it("scope absent sert financier", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(200);
    expect(getDailyNav.mock.calls[0]![0].scope).toBe("financier");
  });

  it("?scope=bogus reste un 400", async () => {
    const res = await GET(req("?scope=bogus"));
    expect(res.status).toBe(400);
    expect(getDailyNav).not.toHaveBeenCalled();
  });
});

describe("from/to — une date malformée est un 400, jamais un repli silencieux", () => {
  it("?from=2026-1-5 (forme invalide) → 400, pas le défaut d'un an", async () => {
    const res = await GET(req("?from=2026-1-5"));
    expect(res.status).toBe(400);
    expect(getDailyNav).not.toHaveBeenCalled();
  });

  it("?from=2026-02-30 (calendrier inexistant) → 400", async () => {
    const res = await GET(req("?from=2026-02-30"));
    expect(res.status).toBe(400);
    expect(getDailyNav).not.toHaveBeenCalled();
  });

  it("?to=2026-13-45 (calendrier inexistant) → 400", async () => {
    const res = await GET(req("?to=2026-13-45"));
    expect(res.status).toBe(400);
    expect(getDailyNav).not.toHaveBeenCalled();
  });

  it("from/to absents : la fenêtre par défaut se termine à lastCloseDay(), pas aujourd'hui", async () => {
    const res = await GET(req(""));
    expect(res.status).toBe(200);
    expect(getDailyNav.mock.calls[0]![0].to).toBe(lastCloseDay());
  });
});

describe("to n'est jamais borné — plafond à lastCloseDay()", () => {
  it("?to=2200-01-01 est ramené à lastCloseDay(), jamais rejoué tel quel", async () => {
    const res = await GET(req("?to=2200-01-01"));
    expect(res.status).toBe(200);
    expect(getDailyNav.mock.calls[0]![0].to).toBe(lastCloseDay());
  });

  it("?from=2200-01-01&to=2200-01-02 : from > to après plafonnement → 400", async () => {
    const res = await GET(req("?from=2200-01-01&to=2200-01-02"));
    expect(res.status).toBe(400);
    expect(getDailyNav).not.toHaveBeenCalled();
  });

  it("une fenêtre valide n'est pas altérée par le plafond", async () => {
    const res = await GET(req("?from=2026-01-01&to=2026-01-31"));
    expect(res.status).toBe(200);
    expect(getDailyNav.mock.calls[0]![0]).toMatchObject({
      from: "2026-01-01",
      to: "2026-01-31",
    });
  });
});
