import { describe, expect, it } from "vitest";
import {
  TermDepositInputError,
  daysUntilMaturity,
  maturityStatus,
  validatePenaltyPct,
  validatePrincipal,
  validateRatePercent,
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

/*
  Le taux et la pénalité partaient nus vers `new Prisma.Decimal(...)`.

  `decimalString` accepte explicitement la chaîne vide, et `new Decimal("")`
  lève — mesuré : `[DecimalError] Invalid argument:`. Cette exception n'est pas
  une `TermDepositInputError`, donc le `catch` des routes la relayait : 500 sur
  une saisie simplement incomplète. `principal` était protégé, ces deux-là non.
*/
describe("validateRatePercent", () => {
  it("accepte un taux ordinaire", () => {
    expect(() => validateRatePercent("3.25")).not.toThrow();
    // Un taux nul est un fait, pas une erreur de saisie.
    expect(() => validateRatePercent("0")).not.toThrow();
  });

  it("refuse la chaîne vide plutôt que de la laisser lever plus loin", () => {
    expect(() => validateRatePercent("")).toThrow(TermDepositInputError);
  });

  it("refuse ce qui n'est pas un nombre, sans laisser filer de DecimalError", () => {
    // `d("abc")` lève : le garde doit intercepter, pas propager.
    expect(() => validateRatePercent("abc")).toThrow(TermDepositInputError);
  });

  /*
    Les bornes ne sont pas une vérité économique : elles attrapent la virgule
    mal placée et l'import mal lu. Un taux négatif n'existe pas sur ce produit.
  */
  it("refuse un taux négatif ou hors d'échelle", () => {
    expect(() => validateRatePercent("-1")).toThrow(/entre 0 et 100/);
    expect(() => validateRatePercent("325")).toThrow(/entre 0 et 100/);
  });
});

describe("validatePenaltyPct", () => {
  it("accepte une pénalité ordinaire, refuse le reste", () => {
    expect(() => validatePenaltyPct("50")).not.toThrow();
    expect(() => validatePenaltyPct("")).toThrow(TermDepositInputError);
    expect(() => validatePenaltyPct("abc")).toThrow(TermDepositInputError);
    expect(() => validatePenaltyPct("101")).toThrow(TermDepositInputError);
  });
});

describe("validatePrincipal", () => {
  it("refuse un principal illisible sans laisser filer de DecimalError", () => {
    // Le schéma l'écarte déjà, mais ce service ne doit pas dépendre d'un garde
    // distant : le même raisonnement que le verrou d'accrual des livrets.
    expect(() => validatePrincipal("abc")).toThrow(TermDepositInputError);
    expect(() => validatePrincipal("")).toThrow(TermDepositInputError);
    expect(() => validatePrincipal("0")).toThrow(TermDepositInputError);
  });

  it("accepte un principal strictement positif", () => {
    expect(() => validatePrincipal("100000")).not.toThrow();
  });
});
