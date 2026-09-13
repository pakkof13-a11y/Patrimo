import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * FX-03 — le repli statique se rendait comme un taux BCE.
 *
 * `fx.ts` sait depuis toujours si `rates` vient de Frankfurter ou de la table
 * de repli (`cache.isFallback`), mais `GET /api/fx` ne le transmettait jamais
 * — la réponse avait la même forme, fondée ou non. Ce fichier verrouille
 * `isFallback: true` quand le cache est en repli, absent/`false` quand le
 * taux est réel, sur les trois formes de réponse qui portent `rates`
 * (`?from&to&amount`, `?from` seul, sans paramètre). Le chemin `date=`, qui a
 * déjà son propre `source`, n'est pas concerné et reste vérifié ailleurs.
 */

const requireUserId = vi.fn();

vi.mock("@/app/lib/auth-helpers", () => ({
  requireUserId: () => requireUserId(),
}));

let fetchMock: ReturnType<typeof vi.fn>;

function reponseFrankfurter(rates: Record<string, number>) {
  return new Response(JSON.stringify({ rates }), { status: 200 });
}

beforeEach(() => {
  requireUserId.mockReset().mockResolvedValue("u1");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Module neuf à chaque test : le cache FX est un état de module. */
async function routeNeuve() {
  vi.resetModules();
  return import("@/app/api/fx/route");
}

describe("GET /api/fx — isFallback", () => {
  it("taux réel : isFallback est false (ou absent), jamais true", async () => {
    fetchMock.mockResolvedValue(reponseFrankfurter({ USD: 1.1 }));
    const { GET } = await routeNeuve();

    const res = await GET(new Request("https://exemple.test/api/fx"));
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.isFallback).not.toBe(true);
  });

  it("Frankfurter en panne : isFallback vaut true sur la réponse sans paramètre", async () => {
    fetchMock.mockRejectedValue(new Error("FX HTTP 503"));
    const { GET } = await routeNeuve();

    const res = await GET(new Request("https://exemple.test/api/fx"));
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.isFallback).toBe(true);
    expect(body.rates).toBeDefined();
  });

  it("Frankfurter en panne : isFallback vaut true avec ?from seul", async () => {
    fetchMock.mockRejectedValue(new Error("FX HTTP 503"));
    const { GET } = await routeNeuve();

    const res = await GET(new Request("https://exemple.test/api/fx?from=USD"));
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.isFallback).toBe(true);
    expect(body.fxRateToEur).toBeDefined();
  });

  it("Frankfurter en panne : isFallback vaut true avec ?from&to&amount", async () => {
    fetchMock.mockRejectedValue(new Error("FX HTTP 503"));
    const { GET } = await routeNeuve();

    const res = await GET(
      new Request("https://exemple.test/api/fx?from=USD&to=EUR&amount=100")
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.isFallback).toBe(true);
    expect(body.converted).toBeDefined();
  });

  it("le chemin ?date= garde son propre `source`, non affecté", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ rates: { USD: 1.1 } }), { status: 200 })
    );
    const { GET } = await routeNeuve();

    const res = await GET(
      new Request("https://exemple.test/api/fx?from=USD&date=2024-01-15")
    );
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.source).toBe("frankfurter-historical");
    expect(body).not.toHaveProperty("isFallback");
  });
});
