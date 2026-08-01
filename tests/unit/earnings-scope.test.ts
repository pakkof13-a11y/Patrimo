import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Périmètre du calendrier de résultats.
 *
 * La règle tient en une phrase : **on n'annonce que les titres détenus**. Trois
 * mécanismes la violaient — une liste de repli codée en dur (Apple, Microsoft,
 * SAP…), un versement du calendrier américain en vrac dès que la moisson était
 * maigre, et un jeu d'exemples fictifs quand tout échouait. Les trois sont
 * retirés ; ces tests empêchent leur retour.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // Sans clé, la branche Finnhub est inerte : on teste d'abord le socle.
  vi.stubEnv("FINNHUB_API_KEY", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("resolveEarningsCalendar — portefeuille vide", () => {
  it("ne renvoie rien et n'interroge aucune source", async () => {
    const { resolveEarningsCalendar } = await import(
      "@/app/lib/news/earnings-live"
    );

    const res = await resolveEarningsCalendar({ portfolio: [], limit: 8 });

    expect(res.events).toEqual([]);
    expect(res.source).toBe("none");
    // Le point le plus important : aucun appel réseau. Interroger Apple pour
    // un utilisateur qui ne détient pas Apple, c'est déjà avoir tort.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ne retombe jamais sur un jeu d'exemples", async () => {
    const { resolveEarningsCalendar } = await import(
      "@/app/lib/news/earnings-live"
    );

    const res = await resolveEarningsCalendar({ limit: 8 });

    expect(res.source).not.toBe("mock");
    expect(res.events).toHaveLength(0);
  });
});

describe("resolveEarningsCalendar — sources en panne", () => {
  it("rend une liste vide plutôt que des annonces inventées", async () => {
    fetchMock.mockRejectedValue(new Error("réseau indisponible"));

    const { resolveEarningsCalendar } = await import(
      "@/app/lib/news/earnings-live"
    );

    const res = await resolveEarningsCalendar({
      portfolio: [{ ticker: "MC.PA", name: "LVMH" }],
      limit: 8,
    });

    expect(res.events).toEqual([]);
    expect(res.source).toBe("none");
  });
});

describe("EarningsSource", () => {
  it("ne propose plus « mock » comme provenance possible", async () => {
    const mod = await import("@/app/lib/news/earnings-live");
    // Le type a disparu à la compilation ; on vérifie ici que le module
    // n'exporte plus de fabrique d'exemples et n'en importe plus.
    expect(Object.keys(mod)).not.toContain("getEarningsCalendarMock");
  });
});
