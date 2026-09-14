import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/portfolio — revue P27.2 : une seconde valorisation que personne
 * ne lisait.
 *
 * `getAllocationByVenueApi` (onze requêtes, valorisation complète du
 * patrimoine) était appelée en plus de `getPortfolioBundle`, sans qu'aucun
 * consommateur ne lise `allocationByVenue` sur cette route : le tableau de
 * bord lit `holdingsQ.data.allocationByVenue`, servi par `/api/holdings`.
 * Ces tests verrouillent le retrait — structurel (le module n'est plus
 * importé) et de contrat (le champ n'est plus dans la réponse).
 */

const getPortfolioBundle = vi.fn();
const recordPortfolioSnapshot = vi.fn();
const getAllocationByVenueApi = vi.fn();
const requireUserId = vi.fn();

vi.mock("@/app/lib/auth-helpers", () => ({
  requireUserId: () => requireUserId(),
}));

vi.mock("@/app/lib/portfolio/service", () => ({
  getPortfolioBundle: (...a: unknown[]) => getPortfolioBundle(...a),
  recordPortfolioSnapshot: (...a: unknown[]) => recordPortfolioSnapshot(...a),
}));

vi.mock("@/app/lib/portfolio/allocation-by-venue-api", () => ({
  getAllocationByVenueApi: (...a: unknown[]) => getAllocationByVenueApi(...a),
}));

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue({ baseCurrency: "EUR" }) },
    portfolioSnapshot: { count: vi.fn().mockResolvedValue(1) },
  },
}));

import { GET } from "@/app/api/portfolio/route";

beforeEach(() => {
  requireUserId.mockReset().mockResolvedValue("u1");
  getPortfolioBundle.mockReset().mockResolvedValue({
    summary: { total: 1 },
    allocation: { slices: [] },
  });
  recordPortfolioSnapshot.mockReset().mockResolvedValue(undefined);
  getAllocationByVenueApi.mockReset().mockResolvedValue({
    venues: [],
    help: {},
    total: 0,
    asOf: "2026-01-01",
  });
});

describe("GET /api/portfolio ne calcule plus allocationByVenue", () => {
  it("n'appelle jamais getAllocationByVenueApi", async () => {
    await GET(new Request("https://exemple.test/api/portfolio"));
    expect(getAllocationByVenueApi).not.toHaveBeenCalled();
  });

  it("la réponse ne porte pas allocationByVenue", async () => {
    const res = await GET(new Request("https://exemple.test/api/portfolio"));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("allocationByVenue");
    expect(body).toMatchObject({
      summary: { total: 1 },
      allocation: { slices: [] },
      baseCurrency: "EUR",
    });
  });

  it("le module allocation-by-venue-api n'est plus importé par la route", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(__dirname, "../../../app/api/portfolio/route.ts"),
      "utf8"
    );
    expect(src).not.toMatch(/allocation-by-venue-api/);
  });
});
