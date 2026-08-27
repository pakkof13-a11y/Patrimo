import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSEE_CPI_MOM_IDBANK,
  DEFAULT_INSEE_CPI_YOY_IDBANK,
  inseeCpiProvider,
} from "@/app/lib/macro/providers/insee-cpi";

/**
 * Validation **réelle** contre l'INSEE. Ignoré en CI : pas de réseau garanti,
 * et le chantier interdit de fabriquer des données pour faire passer un test.
 *
 * Lancer : `CPI_LIVE=1 npx vitest run tests/unit/macro/insee-cpi-live.test.ts`
 */
const live = process.env.CPI_LIVE === "1";

describe.skipIf(!live)("INSEE BDM — collecte réelle", () => {
  it("récupère MoM et YoY de l'IPC France ensemble", async () => {
    const obs = await inseeCpiProvider.fetch({ sinceMonths: 8 });
    expect(obs.length).toBeGreaterThanOrEqual(6);

    const byPeriod = new Map(obs.map((o) => [o.period, o]));
    // Publications INSEE définitives (Informations rapides) :
    // mai 2026 MoM +0,1 % / YoY +2,4 % ; juillet 2026 MoM +0,6 % / YoY +2,1 %.
    const mai = byPeriod.get("2026-05");
    const juillet = byPeriod.get("2026-07");
    expect(mai, `idBank MoM ${DEFAULT_INSEE_CPI_MOM_IDBANK}`).toBeDefined();
    expect(juillet, `idBank YoY ${DEFAULT_INSEE_CPI_YOY_IDBANK}`).toBeDefined();
    expect(mai!.monthlyRate).toBeCloseTo(0.001, 6);
    expect(mai!.yearlyRate).toBeCloseTo(0.024, 6);
    expect(juillet!.monthlyRate).toBeCloseTo(0.006, 6);
    expect(juillet!.yearlyRate).toBeCloseTo(0.021, 6);
  }, 25_000);
});
