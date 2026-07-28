import { describe, expect, it } from "vitest";
import {
  PFU_INCOME_TAX_RATE,
  PFU_TOTAL_RATE,
  ratePct,
  SOCIAL_CHARGES_RATE,
  SOCIAL_CHARGES_RATE_LEGACY,
} from "@/app/lib/tax/rates";
import { SOCIAL_CHARGES_RATE as AV_SOCIAL_RATE } from "@/app/lib/life-insurance/fiscal";
import { CAPITAL_GAIN_SOCIAL_RATE } from "@/app/lib/real-estate/tax/capital-gain";
import { SOCIAL_RATE as RENTAL_SOCIAL_RATE } from "@/app/lib/real-estate/tax/rental-income";
import {
  PEA_INCOME_TAX_RATE,
  PEA_SOCIAL_CHARGES_RATE,
} from "@/app/lib/securities/pea";

describe("taux du capital 2026", () => {
  it("le PFU vaut 31,4 % — 12,8 % d'IR et 18,6 % de prélèvements sociaux", () => {
    expect(Number(PFU_INCOME_TAX_RATE)).toBe(0.128);
    expect(Number(SOCIAL_CHARGES_RATE)).toBe(0.186);
    expect(Number(PFU_TOTAL_RATE)).toBeCloseTo(
      Number(PFU_INCOME_TAX_RATE) + Number(SOCIAL_CHARGES_RATE),
      10
    );
  });

  it("le taux antérieur à 2026 reste disponible pour le découpage historique", () => {
    expect(Number(SOCIAL_CHARGES_RATE_LEGACY)).toBe(0.172);
  });
});

describe("le PEA suit les taux du capital", () => {
  it("reprend les constantes partagées plutôt que d'en figer une copie", () => {
    expect(PEA_INCOME_TAX_RATE).toBe(PFU_INCOME_TAX_RATE);
    expect(PEA_SOCIAL_CHARGES_RATE).toBe(SOCIAL_CHARGES_RATE);
  });
});

/**
 * Garde-fou contre une harmonisation trop zélée.
 *
 * La hausse de 2026 ne touche pas tout : l'assurance-vie, les PEL/CEL/PEP, les
 * revenus fonciers et les plus-values immobilières restent à 17,2 %. Aligner
 * ces modules sur `SOCIAL_CHARGES_RATE` serait une régression déguisée en
 * nettoyage — ces tests la feraient échouer immédiatement.
 */
describe("produits restés à 17,2 %", () => {
  it("l'assurance-vie ne suit pas la hausse", () => {
    expect(AV_SOCIAL_RATE).toBe(0.172);
    expect(AV_SOCIAL_RATE).not.toBe(Number(SOCIAL_CHARGES_RATE));
  });

  it("les plus-values immobilières non plus", () => {
    expect(CAPITAL_GAIN_SOCIAL_RATE.toNumber()).toBe(0.172);
  });

  it("les revenus fonciers non plus", () => {
    expect(RENTAL_SOCIAL_RATE.toNumber()).toBe(0.172);
  });
});

describe("ratePct", () => {
  it("rend un taux lisible en français", () => {
    expect(ratePct("0.186")).toBe("18,6 %");
    expect(ratePct("0.128")).toBe("12,8 %");
    expect(ratePct("0.314")).toBe("31,4 %");
  });
});
