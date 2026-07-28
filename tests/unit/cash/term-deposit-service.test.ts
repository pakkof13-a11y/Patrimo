import { describe, expect, it } from "vitest";
import {
  TermDepositInputError,
  daysUntilMaturity,
  maturityStatus,
  validatePrincipal,
  validateTermDepositDates,
} from "@/app/lib/cash/term-deposit-service";

describe("validateTermDepositDates", () => {
  it("accepte une échéance postérieure à l'ouverture", () => {
    const { openedAt, maturityDate } = validateTermDepositDates(
      "2026-01-01",
      "2027-01-01"
    );
    expect(openedAt.getFullYear()).toBe(2026);
    expect(maturityDate.getFullYear()).toBe(2027);
  });

  it("rejette une échéance antérieure ou égale à l'ouverture", () => {
    expect(() => validateTermDepositDates("2026-01-01", "2025-01-01")).toThrow(
      TermDepositInputError
    );
    expect(() => validateTermDepositDates("2026-01-01", "2026-01-01")).toThrow(
      /postérieure/i
    );
  });

  it("rejette une date invalide", () => {
    expect(() => validateTermDepositDates("pas une date", "2027-01-01")).toThrow(
      /ouverture invalide/i
    );
    expect(() => validateTermDepositDates("2026-01-01", "pas une date")).toThrow(
      /échéance invalide/i
    );
  });
});

describe("validatePrincipal", () => {
  it("accepte un principal positif", () => {
    expect(() => validatePrincipal("1000")).not.toThrow();
  });

  it("rejette un principal nul ou négatif", () => {
    expect(() => validatePrincipal("0")).toThrow();
    expect(() => validatePrincipal("-100")).toThrow();
  });
});

describe("maturityStatus / daysUntilMaturity", () => {
  const now = new Date("2026-06-15T00:00:00Z");

  it("ACTIVE avant l'échéance", () => {
    expect(maturityStatus(new Date("2026-12-01"), now)).toBe("ACTIVE");
    expect(daysUntilMaturity(new Date("2026-06-25"), now)).toBe(10);
  });

  it("MATURED à l'échéance ou après", () => {
    expect(maturityStatus(new Date("2026-06-15"), now)).toBe("MATURED");
    expect(maturityStatus(new Date("2026-01-01"), now)).toBe("MATURED");
    expect(daysUntilMaturity(new Date("2026-06-01"), now)).toBeLessThan(0);
  });
});
