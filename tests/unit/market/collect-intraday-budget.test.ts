import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T-2b — le passage planifié tient dans le budget de la plateforme.
 *
 * Offre Hobby : 60 s de plafond, pas de `maxDuration = 300`. Le POST mesuré en
 * preview partait en 504 à 60,1 s — le travail progressait en base, mais le
 * rapport était perdu, donc impossible de savoir s'il fallait relancer.
 *
 * Ce que ces tests protègent : quand le backfill a consommé le budget,
 * l'intraday n'est pas lancé « au cas où », et le rapport rendu dit qu'il faut
 * relancer et combien d'actifs restent.
 */

const backfill = vi.fn();
const collectIntraday = vi.fn();
const collectDailyForAssets = vi.fn();
const requireUserId = vi.fn();

vi.mock("@/app/lib/market/backfill-closes", () => ({
  backfillDailyClosesFromFirstTx: (...a: unknown[]) => backfill(...a),
}));

vi.mock("@/app/lib/market/intraday-collector", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    collectIntradayBars: (...a: unknown[]) => collectIntraday(...a),
    collectDailyClosesForAssets: (...a: unknown[]) => collectDailyForAssets(...a),
  };
});

vi.mock("@/app/lib/auth-helpers", () => ({
  requireUserId: () => requireUserId(),
}));

import { POST } from "@/app/api/cron/collect-intraday/route";

function rapportBackfill(over: Record<string, unknown> = {}) {
  return {
    assetsConsidered: 95,
    assetsStale: 42,
    assetsFilled: 12,
    closesWritten: 900,
    errors: [],
    day: "2026-09-04",
    assetsFromFirstTx: 95,
    assetsRemaining: 0,
    stoppedForBudget: false,
    ...over,
  };
}

const requete = () =>
  new Request("https://exemple.test/api/cron/collect-intraday", { method: "POST" });

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("CRON_SECRET", "");
  backfill.mockReset().mockResolvedValue(rapportBackfill());
  collectIntraday.mockReset().mockResolvedValue({ interval: "1h", barsCreated: 3 });
  collectDailyForAssets.mockReset();
  requireUserId.mockReset().mockResolvedValue("u1");
});

describe("POST /api/cron/collect-intraday — budget et progression", () => {
  it("transmet au backfill une échéance strictement sous le plafond de 60 s", async () => {
    const avant = Date.now();
    await POST(requete());

    const opts = backfill.mock.calls[0]![0] as { budget: { deadlineAt: number } };
    const marge = opts.budget.deadlineAt - avant;
    expect(marge).toBeGreaterThan(0);
    // Une réponse rendue vaut mieux qu'un 504 : il doit rester de quoi
    // sérialiser le rapport après le dernier appel fournisseur.
    expect(marge).toBeLessThanOrEqual(50_000);
  });

  it("budget épuisé → l'intraday est sauté, et le rapport le dit", async () => {
    backfill.mockResolvedValue(
      rapportBackfill({ stoppedForBudget: true, assetsRemaining: 30 })
    );

    const body = (await (await POST(requete())).json()) as {
      progress: { needsMoreRuns: boolean; remainingAssets: number; stoppedBy: string };
      intraday: unknown;
      intradaySkipped: string | null;
      daily: { errors: unknown[] };
    };

    expect(collectIntraday).not.toHaveBeenCalled();
    expect(body.intraday).toBeNull();
    expect(body.intradaySkipped).toBe("budget");
    expect(body.progress).toEqual({
      needsMoreRuns: true,
      remainingAssets: 30,
      stoppedBy: "budget",
    });
    // Un arrêt par budget n'est pas une panne fournisseur.
    expect(body.daily.errors).toEqual([]);
  });

  it("travail terminé → l'intraday passe et rien n'est à relancer", async () => {
    const body = (await (await POST(requete())).json()) as {
      progress: { needsMoreRuns: boolean; remainingAssets: number; stoppedBy: string };
      intradaySkipped: string | null;
    };

    expect(collectIntraday).toHaveBeenCalledTimes(1);
    expect(body.intradaySkipped).toBeNull();
    expect(body.progress).toEqual({
      needsMoreRuns: false,
      remainingAssets: 0,
      stoppedBy: "completion",
    });
  });

  it("sans session ni secret, aucune collecte n'est déclenchée", async () => {
    requireUserId.mockResolvedValue(null);
    const res = await POST(requete());
    expect(res.status).toBe(401);
    expect(backfill).not.toHaveBeenCalled();
    expect(collectIntraday).not.toHaveBeenCalled();
  });
});
