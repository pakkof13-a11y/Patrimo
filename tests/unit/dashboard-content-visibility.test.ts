import { describe, expect, it } from "vitest";
import { dashboardBlocksFor, resolveDashboardMaturity } from "@/app/lib/dashboard/maturity";
import { resolveDashboardContentVisibility } from "@/components/dashboard/dashboard-content-visibility";

/**
 * Régression : un compte avec une plateforme et zéro transaction atterrit en
 * maturité « setup », pas « empty » (le cockpit intercepte ce dernier cas en
 * amont). `dashboardBlocksFor("setup")` masque tous ses blocs — c'était juste
 * pour les blocs analytiques, ça ne l'était plus pour la carte de tête et le
 * journal, qui savent dire l'absence sans rien inventer. Sans plancher,
 * `DashboardTab` ne rendait plus rien : un écran blanc après la création de
 * la première plateforme.
 */
describe("resolveDashboardContentVisibility", () => {
  it("garde la carte de tête et le journal visibles en maturité setup (une plateforme, zéro transaction)", () => {
    const maturity = resolveDashboardMaturity({
      platformCount: 1,
      transactionCount: 0,
      holdingCount: 0,
    });
    expect(maturity).toBe("setup");

    const blocks = dashboardBlocksFor(maturity);
    // Le bloc source ne les affiche pas — c'est justement ce que le plancher corrige.
    expect(blocks.showEvolutionChart).toBe(false);

    const visibility = resolveDashboardContentVisibility(maturity, blocks);
    expect(visibility.showHeroCard).toBe(true);
    expect(visibility.showJournal).toBe(true);
  });

  it("n'invente rien en maturité empty — le cockpit porte déjà cet état", () => {
    const maturity = resolveDashboardMaturity({
      platformCount: 0,
      transactionCount: 0,
      holdingCount: 0,
    });
    expect(maturity).toBe("empty");

    const blocks = dashboardBlocksFor(maturity);
    const visibility = resolveDashboardContentVisibility(maturity, blocks);
    expect(visibility.showHeroCard).toBe(false);
    expect(visibility.showJournal).toBe(false);
  });

  it("suit les blocs analytiques dès que le compte est actif", () => {
    const maturity = resolveDashboardMaturity({
      platformCount: 2,
      transactionCount: 5,
      holdingCount: 3,
    });
    expect(maturity).toBe("active");

    const blocks = dashboardBlocksFor(maturity);
    const visibility = resolveDashboardContentVisibility(maturity, blocks);
    expect(visibility.showHeroCard).toBe(blocks.showEvolutionChart);
    expect(visibility.showJournal).toBe(blocks.showEvolutionChart);
  });
});
