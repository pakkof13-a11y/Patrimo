import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Fenêtre du calendrier de résultats (P4, D23).
 *
 * L'« univers » (vrac, sans symbole) portait sur vingt-quatre heures — trop
 * étroit pour la barre de jours J−7…J+7 de l'écran, qui laisserait onze jours
 * cliquables mais silencieux. Ces tests figent la fenêtre réellement envoyée
 * au fournisseur, pas seulement ce que le code affirme faire dans ses
 * commentaires.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ earningsCalendar: [] }),
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("FINNHUB_API_KEY", "test-key-not-real");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveEarningsCalendar — fenêtre de l'univers (clé présente)", () => {
  it("interroge Finnhub sans symbole sur J-7…J+7, pas 24 h", async () => {
    const { resolveEarningsCalendar } = await import(
      "@/app/lib/news/earnings-live"
    );

    await resolveEarningsCalendar({ portfolio: [], limit: 8 });

    const universeCall = fetchMock.mock.calls.find(([url]) => {
      const u = String(url);
      return (
        u.includes("finnhub.io/api/v1/calendar/earnings") &&
        !u.includes("symbol=")
      );
    });
    expect(universeCall).toBeDefined();

    const url = new URL(String(universeCall![0]));
    const from = new Date(url.searchParams.get("from") + "T00:00:00Z").getTime();
    const to = new Date(url.searchParams.get("to") + "T00:00:00Z").getTime();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    // ~J-7 (tolérance 1 j pour l'arrondi jour civil) et ~J+7, pas ~J+1.
    expect(from).toBeLessThanOrEqual(now - 6 * DAY);
    expect(from).toBeGreaterThanOrEqual(now - 8 * DAY);
    expect(to).toBeGreaterThanOrEqual(now + 6 * DAY);
    expect(to).toBeLessThanOrEqual(now + 8 * DAY);
  });

  it("rapporte diagnostics.universeSource=finnhub avec une clé valide", async () => {
    const { resolveEarningsCalendar } = await import(
      "@/app/lib/news/earnings-live"
    );

    const res = await resolveEarningsCalendar({ portfolio: [], limit: 8 });

    expect(res.diagnostics.universeSource).toBe("finnhub");
  });
});

describe("resolveEarningsCalendar — diagnostics sans clé", () => {
  it("rapporte diagnostics.universeSource=no-key et universeRaw=0", async () => {
    vi.stubEnv("FINNHUB_API_KEY", "");
    const { resolveEarningsCalendar } = await import(
      "@/app/lib/news/earnings-live"
    );

    const res = await resolveEarningsCalendar({ portfolio: [], limit: 8 });

    expect(res.diagnostics.universeSource).toBe("no-key");
    expect(res.diagnostics.universeRaw).toBe(0);
    expect(res.diagnostics.universeKept).toBe(0);
    // Sans clé, aucun appel Finnhub — ni pour l'univers, ni par symbole.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
