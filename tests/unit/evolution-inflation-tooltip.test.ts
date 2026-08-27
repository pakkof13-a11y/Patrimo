import { describe, expect, it } from "vitest";
import {
  formatPctOrUnavailable,
  formatSignedPct,
  inflationUnavailableLabel,
} from "@/components/dashboard/portfolio-evolution-charts";

describe("tooltip inflation — 0 % n'est pas une absence", () => {
  it("un vrai zéro s'affiche comme 0,0 %", () => {
    expect(formatPctOrUnavailable(0, "Inflation indisponible")).toBe(
      formatSignedPct(0)
    );
    expect(formatPctOrUnavailable(0, "Inflation indisponible")).toContain("0");
  });

  it("une valeur manquante ne devient jamais 0 %", () => {
    expect(formatPctOrUnavailable(undefined, "Inflation indisponible")).toBe(
      "Inflation indisponible"
    );
    expect(formatPctOrUnavailable(null, "Inflation indisponible")).toBe(
      "Inflation indisponible"
    );
    expect(formatPctOrUnavailable(Number.NaN, "Inflation indisponible")).toBe(
      "Inflation indisponible"
    );
  });

  it("le libellé suit le nom du benchmark", () => {
    expect(inflationUnavailableLabel("Inflation (IPC France)")).toBe(
      "Inflation indisponible"
    );
    expect(inflationUnavailableLabel("CAC 40")).toBe("CAC 40 indisponible");
  });
});
