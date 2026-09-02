import { describe, expect, it } from "vitest";
import {
  coverageRatio,
  insuranceStatus,
  isOverInsured,
  isUnderInsured,
  ownershipAlerts,
} from "@/app/lib/tangibles/ownership";

/**
 * Couverture d'assurance.
 *
 * Le module répond à une question simple mal posée par la plupart des
 * inventaires : « suis-je correctement couvert ? ». Deux écueils y sont
 * traités — une police échue ne couvre rien quel que soit son capital, et un
 * ratio calculé sur une donnée absente ne vaut pas zéro.
 */

const now = new Date("2026-07-28T00:00:00Z");

describe("ratio de couverture", () => {
  it("rapporte le capital assuré à la valeur estimée", () => {
    expect(coverageRatio("10000", "8000")!.toString()).toBe("0.8");
    expect(coverageRatio("10000", "12000")!.toString()).toBe("1.2");
  });

  it("ne calcule rien quand une donnée manque", () => {
    // Un ratio nul se lirait « sous-assuré », alors qu'on ne sait rien.
    expect(coverageRatio("10000", null)).toBeNull();
    expect(coverageRatio("0", "8000")).toBeNull();
  });

  it("place les seuils en dépassement strict", () => {
    // Pile à 80 % ou 120 %, la couverture est jugée acceptable : le seuil
    // marque le début de l'anomalie, pas le cas limite lui-même.
    expect(isUnderInsured(coverageRatio("10000", "8000")!)).toBe(false);
    expect(isUnderInsured(coverageRatio("10000", "7999")!)).toBe(true);
    expect(isOverInsured(coverageRatio("10000", "12000")!)).toBe(false);
    expect(isOverInsured(coverageRatio("10000", "12001")!)).toBe(true);
  });
});

describe("statut de couverture", () => {
  it("classe une couverture adéquate, insuffisante ou excessive", () => {
    const base = { estimatedValue: "10000", now };
    expect(insuranceStatus({ ...base, insuranceValue: "10000" })).toBe("OK");
    expect(insuranceStatus({ ...base, insuranceValue: "5000" })).toBe("UNDER");
    expect(insuranceStatus({ ...base, insuranceValue: "20000" })).toBe("OVER");
  });

  it("traite l'absence d'assurance comme telle, pas comme une sous-assurance", () => {
    expect(
      insuranceStatus({ estimatedValue: "10000", insuranceValue: null, now })
    ).toBe("NONE");
    expect(
      insuranceStatus({ estimatedValue: "10000", insuranceValue: "0", now })
    ).toBe("NONE");
  });

  it("fait primer l'échéance sur le montant", () => {
    // Une police échue ne couvre rien : annoncer « sous-assuré » laisserait
    // croire qu'augmenter le capital suffirait.
    expect(
      insuranceStatus({
        estimatedValue: "10000",
        insuranceValue: "3000",
        insuranceExpiryDate: "2026-01-01",
        now,
      })
    ).toBe("EXPIRED");
    expect(
      insuranceStatus({
        estimatedValue: "10000",
        insuranceValue: "10000",
        insuranceExpiryDate: "2026-08-10",
        now,
      })
    ).toBe("EXPIRING");
  });
});

describe("alertes d'assurance", () => {
  it("chiffre le reste à charge d'une sous-assurance", () => {
    const alert = ownershipAlerts({
      estimatedValue: "20000",
      insuranceValue: "10000",
      now,
    }).find((a) => a.code === "UNDER_INSURED");

    expect(alert).toBeDefined();
    expect(alert!.message).toMatch(/50 %/);
    expect(alert!.message).toMatch(/10\s000,00/);
  });

  it("signale une prime payée sur une valeur non indemnisable", () => {
    const alert = ownershipAlerts({
      estimatedValue: "10000",
      insuranceValue: "20000",
      now,
    }).find((a) => a.code === "OVER_INSURED");

    expect(alert).toBeDefined();
    expect(alert!.message).toMatch(/10\s000,00/);
  });

  it("signale une police échue avant tout le reste", () => {
    const alerts = ownershipAlerts({
      estimatedValue: "20000",
      insuranceValue: "5000",
      insuranceExpiryDate: "2026-05-01",
      now,
    });

    // Sous-assuré ET échu : l'échéance passe devant, c'est ce qui coûte le
    // plus cher si on l'ignore.
    expect(alerts[0]!.code).toBe("POLICY_EXPIRED");
    expect(alerts.map((a) => a.code)).toContain("UNDER_INSURED");
  });

  it("met en garde contre une multirisque habitation sur un objet de valeur", () => {
    const alert = ownershipAlerts({
      estimatedValue: "30000",
      insuranceValue: "30000",
      insuranceType: "MULTI_RISK",
      now,
    }).find((a) => a.code === "NON_SPECIFIC_COVER");

    expect(alert).toBeDefined();
    expect(alert!.message).toMatch(/plafonné/i);

    // Un contrat dédié ne déclenche rien.
    expect(
      ownershipAlerts({
        estimatedValue: "30000",
        insuranceValue: "30000",
        insuranceType: "FINE_ART",
        now,
      })
    ).toHaveLength(0);
  });

  it("signale une expertise trop ancienne pour servir de base", () => {
    const alert = ownershipAlerts({
      estimatedValue: "20000",
      insuranceValue: "20000",
      appraisalDate: "2019-03-01",
      now,
    }).find((a) => a.code === "STALE_APPRAISAL");

    expect(alert).toBeDefined();
    expect(alert!.message).toMatch(/7 ans/);

    // Récente : rien à signaler.
    expect(
      ownershipAlerts({
        estimatedValue: "20000",
        insuranceValue: "20000",
        appraisalDate: "2024-03-01",
        now,
      })
    ).toHaveLength(0);
  });

  it("n'invente aucune alerte d'assurance sur un objet non assuré", () => {
    // Sans capital déclaré, ni sous-assurance ni échéance n'ont de sens ;
    // seule l'alerte « valeur au domicile » reste pertinente.
    const alerts = ownershipAlerts({
      estimatedValue: "20000",
      insuranceValue: null,
      insuranceExpiryDate: "2020-01-01",
      insuranceType: "MULTI_RISK",
      storageType: "HOME",
      now,
    });

    expect(alerts.map((a) => a.code)).toEqual(["UNINSURED_AT_HOME"]);
  });
});
