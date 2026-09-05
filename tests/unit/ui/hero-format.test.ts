import { describe, expect, it } from "vitest";
import {
  formatDayMonthParis,
  formatHeroAmount,
  formatLongDateParis,
  formatShortDateParis,
  formatSignedAmount,
  formatSignedPct,
  formatValuationTimeParis,
  parseSignedScreenAmount,
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

describe("relecture d'un montant signé à l'écran", () => {
  const fr = (v: number) =>
    v.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + " €";

  it("relit une hausse et une baisse telles que formatSignedAmount les pose", () => {
    expect(parseSignedScreenAmount(formatSignedAmount(359_144.65, fr))).toBeCloseTo(
      359_144.65,
      2
    );
    expect(parseSignedScreenAmount(formatSignedAmount(-179_572.325, fr))).toBeCloseTo(
      -179_572.33,
      2
    );
  });

  it("garde le signe derrière le préfixe Marché / Flux", () => {
    expect(parseSignedScreenAmount(`Marché ${formatSignedAmount(-179_572.33, fr)}`)).toBeCloseTo(
      -179_572.33,
      2
    );
    expect(parseSignedScreenAmount(`Flux ${formatSignedAmount(538_716.98, fr)}`)).toBeCloseTo(
      538_716.98,
      2
    );
  });

  it("sans U+2212, |marché + flux − variation| casse de 2·|marché|", () => {
    /*
      Repro du 359 144,65 € mesuré trois fois sur « Tout » : le marché de
      la fenêtre est négatif, formatSignedAmount le préfixe d'un moins
      typographique, et un parseur `[^\d,.-]` le jette. L'identité à
      l'écran n'était pas fausse — c'est la mesure qui inversait le marché.
    */
    const marche = -179_572.325;
    const flux = 538_716.98;
    const variation = marche + flux;
    const ecran = {
      variation: formatSignedAmount(variation, fr),
      marche: `Marché ${formatSignedAmount(marche, fr)}`,
      flux: `Flux ${formatSignedAmount(flux, fr)}`,
    };

    expect(
      Math.abs(
        parseSignedScreenAmount(ecran.marche) +
          parseSignedScreenAmount(ecran.flux) -
          parseSignedScreenAmount(ecran.variation)
      )
    ).toBeLessThan(1);

    const ancien = (texte: string) =>
      Number(
        texte
          .replace(/[^\d,.-]/g, "")
          .replace(/\./g, "")
          .replace(",", ".")
      );
    expect(
      Math.abs(ancien(ecran.marche) + ancien(ecran.flux) - ancien(ecran.variation))
    ).toBeCloseTo(2 * Math.abs(marche), 0);
    expect(
      Math.abs(ancien(ecran.marche) + ancien(ecran.flux) - ancien(ecran.variation))
    ).toBeCloseTo(359_144.65, 0);
  });
});
