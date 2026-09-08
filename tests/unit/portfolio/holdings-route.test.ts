import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/holdings — revue D29 : la seconde valorisation avait déménagé.
 *
 * `getAllocationByVenueApi` — son propre `getHoldings` complet, plus onze
 * requêtes de manches — tournait ici en parallèle du bundle, sans qu'aucun
 * consommateur ne lise `allocationByVenue` : le pavé « Répartition » du
 * tableau de bord est passé aux classes de détention en D19 P2bis, et
 * `DashboardTab` met le prop de côté à la destructuration depuis.
 *
 * C'est le motif retiré de `GET /api/portfolio` en D27 (voir
 * `portfolio-route.test.ts`), à ceci près que cette route-ci est la plus
 * chaude des deux : elle est resservie à chaque rafraîchissement de cours.
 * Mesuré à chaud sur la base de préproduction : médiane 547 ms avec, 344 ms
 * sans.
 *
 * Ces tests verrouillent le retrait — structurel (le module n'est plus
 * importé) et de contrat (le champ n'est plus dans la réponse).
 */

const getPortfolioBundle = vi.fn();
const getAllocationByVenueApi = vi.fn();
const requireUserId = vi.fn();

vi.mock("@/app/lib/auth-helpers", () => ({
  requireUserId: () => requireUserId(),
}));

vi.mock("@/app/lib/portfolio/service", () => ({
  getPortfolioBundle: (...a: unknown[]) => getPortfolioBundle(...a),
}));

vi.mock("@/app/lib/portfolio/allocation-by-venue-api", () => ({
  getAllocationByVenueApi: (...a: unknown[]) => getAllocationByVenueApi(...a),
}));

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn().mockResolvedValue({ baseCurrency: "EUR" }) },
  },
}));

import { GET } from "@/app/api/holdings/route";

beforeEach(() => {
  requireUserId.mockReset().mockResolvedValue("u1");
  getPortfolioBundle.mockReset().mockResolvedValue({
    holdings: [],
    summary: { total: 1 },
    baseCurrency: "EUR",
  });
  getAllocationByVenueApi.mockReset().mockResolvedValue({
    venues: [],
    help: {},
    total: 0,
    asOf: "2026-01-01",
    unallocatedLiabilitiesEur: 0,
  });
});

describe("GET /api/holdings ne calcule plus allocationByVenue", () => {
  it("n'appelle jamais getAllocationByVenueApi", async () => {
    await GET(new Request("https://exemple.test/api/holdings"));
    expect(getAllocationByVenueApi).not.toHaveBeenCalled();
  });

  it("la réponse ne porte pas allocationByVenue", async () => {
    const res = await GET(new Request("https://exemple.test/api/holdings"));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("allocationByVenue");
    expect(body).toMatchObject({ summary: { total: 1 }, baseCurrency: "EUR" });
  });

  it("ne charge le patrimoine qu'une fois", async () => {
    await GET(new Request("https://exemple.test/api/holdings"));
    expect(getPortfolioBundle).toHaveBeenCalledTimes(1);
  });

  it("sert toujours la devise demandée en paramètre", async () => {
    await GET(new Request("https://exemple.test/api/holdings?base=USD"));
    expect(getPortfolioBundle).toHaveBeenCalledWith("u1", "USD");
  });

  it("le module allocation-by-venue-api n'est plus importé par la route", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(__dirname, "../../../app/api/holdings/route.ts"),
      "utf8"
    );
    /*
      Le commentaire de tête raconte le retrait et cite le module : on ne
      cherche donc pas le nom, mais l'import — la seule forme qui remettrait
      le calcul sur le chemin de la requête.
    */
    expect(src).not.toMatch(/from\s+"@\/app\/lib\/portfolio\/allocation-by-venue-api"/);
  });
});
