import { describe, expect, it } from "vitest";
import {
  formatDayMonthParis,
  formatHeroAmount,
  formatLongDateParis,
  formatShortDateParis,
  formatSignedAmount,
  formatSignedPct,
  formatValuationTimeParis,
} from "@/app/lib/ui/hero-format";

/**
 * Les règles typographiques de la carte de tête.
 *
 * Elles paraissent cosmétiques et ne le sont pas : un « + » manquant fait lire
 * une hausse comme un solde, et une heure affichée là où aucune mesure n'a eu
 * lieu invente une précision que la donnée n'a pas.
 */

describe("dates", () => {
  const vendrediSoir = "2026-01-09T22:59:59.999Z"; // 23 h 59 à Paris

  it("date longue avec le jour de la semaine", () => {
    const s = formatLongDateParis(vendrediSoir);
    expect(s).toContain("vendredi");
    expect(s).toContain("9");
    expect(s).toContain("2026");
  });

  it("date courte sans jour de la semaine", () => {
    const s = formatShortDateParis(vendrediSoir);
    expect(s).not.toContain("vendredi");
    expect(s).toContain("2026");
  });

  it("jour et mois seuls pour le renvoi vers la dernière valo", () => {
    const s = formatDayMonthParis(vendrediSoir);
    expect(s).not.toContain("2026");
    expect(s).toContain("9");
  });

  it("une date illisible ne produit pas « Invalid Date »", () => {
    expect(formatLongDateParis("pas-une-date")).toBe("");
    expect(formatShortDateParis("pas-une-date")).toBe("");
    expect(formatDayMonthParis("pas-une-date")).toBe("");
  });
});

describe("heure de valorisation", () => {
  it("23:59 est un marqueur de clôture, pas une heure de mesure", () => {
    /*
      Tous les points d'historique sont horodatés à la fin de leur journée
      civile. Afficher cette heure ferait croire à une valorisation prise à
      minuit moins une.
    */
    expect(formatValuationTimeParis("2026-01-09T22:59:59.999Z")).toBeNull();
  });

  it("une heure réelle, elle, est rendue", () => {
    // 13:30 UTC = 14:30 à Paris en janvier (UTC+1).
    expect(formatValuationTimeParis("2026-01-09T13:30:00.000Z")).toBe("14:30");
  });

  it("une date illisible ne rend pas d'heure", () => {
    expect(formatValuationTimeParis("pas-une-date")).toBeNull();
  });
});

describe("montant de tête", () => {
  it("sans centimes au-delà de 10 000", () => {
    expect(formatHeroAmount(2_800_300.47)).not.toContain(",");
  });

  it("avec centimes en dessous de 10 000", () => {
    expect(formatHeroAmount(3_200.45)).toContain("45");
  });

  it("le seuil de 10 000 bascule bien", () => {
    expect(formatHeroAmount(9_999.99)).toContain(",");
    expect(formatHeroAmount(10_000)).not.toContain(",");
  });

  it("un montant non fini s'affiche en tiret, jamais en NaN", () => {
    expect(formatHeroAmount(Number.NaN)).toBe("—");
    expect(formatHeroAmount(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("variations signées", () => {
  const abs = (v: number) => `${v.toFixed(2)} €`;

  it("le plus est explicite sur une hausse", () => {
    expect(formatSignedAmount(120, abs)).toBe("+120.00 €");
    expect(formatSignedPct(1.24)).toBe("+1,2 %");
  });

  it("la baisse porte un vrai signe moins, pas un trait d'union", () => {
    expect(formatSignedAmount(-120, abs)).toBe("−120.00 €");
    expect(formatSignedPct(-0.35)).toBe("−0,4 %");
    // U+2212, et non U+002D.
    expect(formatSignedPct(-1).charCodeAt(0)).toBe(0x2212);
  });

  it("zéro est compté comme une non-baisse", () => {
    expect(formatSignedAmount(0, abs)).toBe("+0.00 €");
    expect(formatSignedPct(0)).toBe("+0,0 %");
  });
});
