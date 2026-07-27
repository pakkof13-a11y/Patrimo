import { describe, expect, it } from "vitest";
import { matchesPnlFilter, parsePnlFilter } from "@/app/lib/portfolio/pnl-filter";

describe("parsePnlFilter", () => {
  it("reconnaît gain/loss, tout le reste retombe sur all", () => {
    expect(parsePnlFilter("gain")).toBe("gain");
    expect(parsePnlFilter("loss")).toBe("loss");
    expect(parsePnlFilter("all")).toBe("all");
    expect(parsePnlFilter(undefined)).toBe("all");
    expect(parsePnlFilter(null)).toBe("all");
    expect(parsePnlFilter("bogus")).toBe("all");
  });
});

describe("matchesPnlFilter", () => {
  it("all : tout passe, y compris zéro et invalide", () => {
    expect(matchesPnlFilter("0", "all")).toBe(true);
    expect(matchesPnlFilter("NaN", "all")).toBe(true);
    expect(matchesPnlFilter(-5, "all")).toBe(true);
  });

  it("gain : strictement positif seulement", () => {
    expect(matchesPnlFilter("100", "gain")).toBe(true);
    expect(matchesPnlFilter("0", "gain")).toBe(false);
    expect(matchesPnlFilter("-1", "gain")).toBe(false);
  });

  it("loss : strictement négatif seulement", () => {
    expect(matchesPnlFilter("-1", "loss")).toBe(true);
    expect(matchesPnlFilter("0", "loss")).toBe(false);
    expect(matchesPnlFilter("100", "loss")).toBe(false);
  });

  it("valeur non numérique exclue des filtres gain/loss", () => {
    expect(matchesPnlFilter("abc", "gain")).toBe(false);
    expect(matchesPnlFilter("abc", "loss")).toBe(false);
  });
});
