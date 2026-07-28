import { describe, expect, it } from "vitest";
import {
  DefiInputError,
  validateRewardLegs,
  type ExtraRewardLeg,
} from "@/app/lib/crypto/defi-manual-service";

describe("validateRewardLegs", () => {
  it("accepte l'absence de rewards additionnels", () => {
    expect(() => validateRewardLegs("CRV", [])).not.toThrow();
    expect(() => validateRewardLegs(null, [])).not.toThrow();
  });

  it("accepte plusieurs rewards distincts", () => {
    const legs: ExtraRewardLeg[] = [
      { symbol: "CVX", amount: "10", valueEur: "50" },
      { symbol: "3CRV", amount: "5", valueEur: "12" },
    ];
    expect(() => validateRewardLegs("CRV", legs)).not.toThrow();
  });

  it("rejette un jeton dupliqué avec le reward principal", () => {
    const legs: ExtraRewardLeg[] = [{ symbol: "crv", amount: "1", valueEur: "1" }];
    expect(() => validateRewardLegs("CRV", legs)).toThrow(/distincts/i);
  });

  it("rejette des jetons dupliqués entre rewards additionnels", () => {
    const legs: ExtraRewardLeg[] = [
      { symbol: "CVX", amount: "1", valueEur: "1" },
      { symbol: "cvx", amount: "2", valueEur: "2" },
    ];
    expect(() => validateRewardLegs("CRV", legs)).toThrow(/distincts/i);
  });

  it("rejette une quantité invalide", () => {
    const legs: ExtraRewardLeg[] = [{ symbol: "CVX", amount: "0", valueEur: "1" }];
    expect(() => validateRewardLegs("CRV", legs)).toThrow(DefiInputError);
  });

  it("rejette une valeur en euros négative", () => {
    const legs: ExtraRewardLeg[] = [{ symbol: "CVX", amount: "1", valueEur: "-1" }];
    expect(() => validateRewardLegs("CRV", legs)).toThrow(DefiInputError);
  });

  it("accepte une valeur en euros nulle (reward pas encore priçable)", () => {
    const legs: ExtraRewardLeg[] = [{ symbol: "CVX", amount: "1", valueEur: "0" }];
    expect(() => validateRewardLegs("CRV", legs)).not.toThrow();
  });

  it("rejette au-delà de 5 rewards additionnels", () => {
    const legs: ExtraRewardLeg[] = Array.from({ length: 6 }, (_, i) => ({
      symbol: `TOK${i}`,
      amount: "1",
      valueEur: "1",
    }));
    expect(() => validateRewardLegs("CRV", legs)).toThrow(/5 rewards/i);
  });
});
