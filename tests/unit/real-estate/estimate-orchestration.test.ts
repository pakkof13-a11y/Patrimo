import { describe, expect, it } from "vitest";
import {
  classifyRadiusSource,
  STRICT_RADIUS_STEPS_M,
  WIDE_RADIUS_STEPS_M,
  RADIUS_STEPS_M,
} from "@/app/lib/real-estate/estimate";

describe("STRICT_RADIUS_STEPS_M / WIDE_RADIUS_STEPS_M", () => {
  it("se composent pour former RADIUS_STEPS_M, dans l'ordre", () => {
    expect(RADIUS_STEPS_M).toEqual([
      ...STRICT_RADIUS_STEPS_M,
      ...WIDE_RADIUS_STEPS_M,
    ]);
  });

  it("ne se chevauchent pas — le dernier palier strict précède le premier élargi", () => {
    const maxStrict = STRICT_RADIUS_STEPS_M[STRICT_RADIUS_STEPS_M.length - 1]!;
    const minWide = WIDE_RADIUS_STEPS_M[0]!;
    expect(maxStrict).toBeLessThan(minWide);
  });
});

describe("classifyRadiusSource", () => {
  it("classe les rayons du palier strict en DVF_LOCAL", () => {
    for (const r of STRICT_RADIUS_STEPS_M) {
      expect(classifyRadiusSource(r)).toBe("DVF_LOCAL");
    }
  });

  it("classe les rayons du palier élargi en DVF_ELARGI", () => {
    for (const r of WIDE_RADIUS_STEPS_M) {
      expect(classifyRadiusSource(r)).toBe("DVF_ELARGI");
    }
  });

  it("classe un rayon forcé (hors paliers) selon le même seuil", () => {
    // `radiusM` peut être imposé par l'appelant, hors de la liste de paliers —
    // la classification doit rester cohérente avec la frontière strict/élargi.
    const maxStrict = STRICT_RADIUS_STEPS_M[STRICT_RADIUS_STEPS_M.length - 1]!;
    expect(classifyRadiusSource(maxStrict)).toBe("DVF_LOCAL");
    expect(classifyRadiusSource(maxStrict + 1)).toBe("DVF_ELARGI");
    expect(classifyRadiusSource(1)).toBe("DVF_LOCAL");
    expect(classifyRadiusSource(50_000)).toBe("DVF_ELARGI");
  });
});
