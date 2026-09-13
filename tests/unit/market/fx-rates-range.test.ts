import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `fxRatesToEurRange` — la brique IMP-03 : un seul appel Frankfurter par
 * devise pour toute une plage de dates, jamais un repli sur la table
 * statique quand la serie n'est pas demontree.
 */

function rangeResponse(byDay: Record<string, number>) {
  const rates: Record<string, { USD: number }> = {};
  for (const day of Object.keys(byDay)) rates[day] = { USD: byDay[day]! };
  return new Response(JSON.stringify({ rates }), { status: 200 });
}

let fetchMock: ReturnType<typeof vi.fn>;

async function moduleNeuf() {
  vi.resetModules();
  return import("@/app/lib/market/fx");
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fxRatesToEurRange", () => {
  it("rend un taux par jour de fixing, un seul appel", async () => {
    fetchMock.mockResolvedValue(
      rangeResponse({ "2021-06-14": 1.21, "2021-06-15": 1.2125 })
    );
    const { fxRatesToEurRange } = await moduleNeuf();

    const out = await fxRatesToEurRange("USD", "2021-06-08", "2021-06-15");

    expect(out.status).toBe("ok");
    if (out.status === "ok") {
      expect(Number(out.byDay.get("2021-06-15"))).toBeCloseTo(1 / 1.2125, 9);
      expect(out.byDay.size).toBe(2);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      "2021-06-08..2021-06-15"
    );
  });

  it("404 ou devise absente de la reponse : unsupported", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 404 }));
    const { fxRatesToEurRange } = await moduleNeuf();

    expect((await fxRatesToEurRange("XXX", "2021-01-01", "2021-01-31")).status).toBe(
      "unsupported"
    );
  });

  it("devise absente des taux rendus (200 mais vide) : unsupported", async () => {
    fetchMock.mockResolvedValue(rangeResponse({}));
    const { fxRatesToEurRange } = await moduleNeuf();

    expect((await fxRatesToEurRange("USD", "2021-01-01", "2021-01-31")).status).toBe(
      "unsupported"
    );
  });

  it("panne reseau, 5xx, timeout : unavailable, jamais FALLBACK", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    const { fxRatesToEurRange } = await moduleNeuf();

    expect((await fxRatesToEurRange("USD", "2021-01-01", "2021-01-31")).status).toBe(
      "unavailable"
    );
  });

  it("EUR n'est jamais interrogeable ici mais l'appelant ne l'appelle pas pour EUR", async () => {
    // Documente juste l'absence de garde speciale EUR dans cette fonction :
    // l'appelant (commit.ts) court-circuite l'EUR avant d'y arriver.
    fetchMock.mockResolvedValue(rangeResponse({ "2021-01-04": 1 }));
    const { fxRatesToEurRange } = await moduleNeuf();
    await fxRatesToEurRange("EUR", "2021-01-01", "2021-01-31");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
