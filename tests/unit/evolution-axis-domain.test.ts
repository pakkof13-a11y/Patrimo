import { describe, expect, it } from "vitest";
import { symmetricZeroDomain } from "@/components/dashboard/portfolio-evolution-charts";

/**
 * Régression : l'axe de la vue décomposée affichait « 219,2 k » et « 80,8 k ».
 * La borne valait `maxAbs × 1,12`, donc un nombre quelconque, et Recharts
 * découpait cette plage en graduations tout aussi quelconques.
 */
describe("symmetricZeroDomain", () => {
  it("reste symétrique autour de zéro", () => {
    const [lo, hi] = symmetricZeroDomain([120, -80, 45]);
    expect(lo).toBe(-hi);
  });

  it("arrondit la borne à un palier lisible", () => {
    // Cas observé : maxAbs ≈ 195 700 donnait 219 184.
    const [, hi] = symmetricZeroDomain([195_700, -120_000]);
    expect(hi).toBe(200_000);
  });

  it("englobe toujours la valeur extrême", () => {
    const samples = [
      [1], [9], [11], [99], [101], [999], [1001],
      [1234, -5678], [195_700], [2_400_000], [0.4], [7.5],
    ];
    for (const values of samples) {
      const maxAbs = Math.max(...values.map(Math.abs));
      const [lo, hi] = symmetricZeroDomain(values);
      expect(hi, `borne trop basse pour ${maxAbs}`).toBeGreaterThanOrEqual(maxAbs);
      expect(lo).toBe(-hi);
    }
  });

  it("ne colle pas la borne à la valeur extrême quand elle tombe pile dessus", () => {
    // 200 000 est déjà un palier : sans marge, la barre toucherait le bord.
    const [, hi] = symmetricZeroDomain([200_000]);
    expect(hi).toBeGreaterThan(200_000);
  });

  it("choisit un palier de la famille 1 / 2 / 2,5 / 5 × 10ⁿ", () => {
    const allowed = (v: number) => {
      const exp = Math.floor(Math.log10(v));
      const frac = v / Math.pow(10, exp);
      return [1, 2, 2.5, 5, 10].some((s) => Math.abs(frac - s) < 1e-9);
    };
    for (const values of [[3_100], [64_000], [195_700], [880], [12.3]]) {
      const [, hi] = symmetricZeroDomain(values);
      expect(allowed(hi), `palier inattendu : ${hi}`).toBe(true);
    }
  });

  it("reste borné sur une série vide ou nulle", () => {
    expect(symmetricZeroDomain([])).toEqual([-1, 1]);
    expect(symmetricZeroDomain([0, 0])).toEqual([-1, 1]);
    expect(symmetricZeroDomain([NaN, Infinity])).toEqual([-1, 1]);
  });
});
