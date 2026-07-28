import { describe, expect, it } from "vitest";
import {
  annualCostOfOwnership,
  daysUntil,
  netCarryYield,
  ownershipAlerts,
} from "@/app/lib/tangibles/ownership";

/**
 * Coût de possession — ce que la plus-value affichée ne dit pas.
 *
 * Les cas testés sont ceux où le portage change la lecture : un gain qui
 * devient une perte, une durée inconnue qu'il ne faut pas confondre avec un
 * coût nul, et les alertes qui doivent se déclencher au bon seuil.
 */

describe("coût annuel", () => {
  it("additionne prime et garde, en traitant l'absence comme zéro", () => {
    expect(
      annualCostOfOwnership({
        insurancePremiumAnnual: "120",
        storageCostAnnual: "180",
      }).toString()
    ).toBe("300");
    expect(annualCostOfOwnership({}).toString()).toBe("0");
    expect(
      annualCostOfOwnership({ storageCostAnnual: "180" }).toString()
    ).toBe("180");
  });
});

describe("plus-value nette de portage", () => {
  it("montre le gain réel une fois les frais déduits", () => {
    // La montre du seed : +3 300 € affichés, 300 €/an de coffre et
    // d'assurance depuis 7 ans → il reste 1 200 €.
    const r = netCarryYield({
      estimatedValue: "12800",
      purchasePrice: "9500",
      holdingYears: 7,
      annualCost: "300",
    });

    expect(r.grossPnlEur).toBe("3300.00");
    expect(r.totalCarryCostEur).toBe("2100.00");
    expect(r.netPnlEur).toBe("1200.00");
    expect(r.carryDragPct).toBe("63.6");
  });

  it("distingue « durée inconnue » de « aucun frais »", () => {
    // Renvoyer 0 se lirait comme « rien ne coûte », ce qui est faux : on ne
    // sait simplement pas depuis combien de temps.
    const r = netCarryYield({
      estimatedValue: "12800",
      purchasePrice: "9500",
      holdingYears: null,
      annualCost: "300",
    });

    expect(r.grossPnlEur).toBe("3300.00");
    expect(r.totalCarryCostEur).toBeNull();
    expect(r.netPnlEur).toBeNull();
    expect(r.netPnlPct).toBeNull();
  });

  it("peut retourner un gain apparent en perte réelle", () => {
    const r = netCarryYield({
      estimatedValue: "11000",
      purchasePrice: "10000",
      holdingYears: 10,
      annualCost: "250",
    });

    expect(r.grossPnlEur).toBe("1000.00");
    expect(r.netPnlEur).toBe("-1500.00");
  });

  it("n'affiche pas de part de gain absorbée sur une moins-value", () => {
    // Le ratio serait négatif, donc illisible.
    const r = netCarryYield({
      estimatedValue: "8000",
      purchasePrice: "10000",
      holdingYears: 5,
      annualCost: "100",
    });

    expect(r.netPnlEur).toBe("-2500.00");
    expect(r.carryDragPct).toBeNull();
  });
});

describe("alertes", () => {
  const now = new Date("2026-07-28T00:00:00Z");

  it("compte les jours en calendrier, échéance dépassée comprise", () => {
    expect(daysUntil(new Date("2026-08-27T00:00:00Z"), now)).toBe(30);
    expect(daysUntil(new Date("2026-07-18T00:00:00Z"), now)).toBe(-10);
  });

  it("signale un renouvellement à moins de 60 jours, pas au-delà", () => {
    const near = ownershipAlerts({
      estimatedValue: "10000",
      storageRenewalDate: "2026-09-01",
      now,
    });
    const far = ownershipAlerts({
      estimatedValue: "10000",
      storageRenewalDate: "2027-01-01",
      now,
    });

    expect(near.map((a) => a.code)).toContain("RENEWAL_DUE");
    expect(far).toHaveLength(0);
  });

  it("signale un objet de valeur gardé au domicile sans assurance", () => {
    const alert = ownershipAlerts({
      estimatedValue: "12000",
      storageType: "HOME",
      now,
    }).find((a) => a.code === "UNINSURED_AT_HOME");

    expect(alert).toBeDefined();
    // `toLocaleString("fr-FR")` sépare les milliers par une espace fine
    // insécable : la classe \s l'accepte comme l'espace ordinaire.
    expect(alert!.message).toMatch(/12\s000,00/);

    // Assuré : plus d'alerte, même au domicile.
    expect(
      ownershipAlerts({
        estimatedValue: "12000",
        storageType: "HOME",
        insurancePremiumAnnual: "90",
        now,
      })
    ).toHaveLength(0);

    // Sous le seuil : l'alerte serait du bruit.
    expect(
      ownershipAlerts({ estimatedValue: "800", storageType: "HOME", now })
    ).toHaveLength(0);
  });

  it("signale une garde qui dépasse 1 % de la valeur, avec le chiffre", () => {
    const alert = ownershipAlerts({
      estimatedValue: "10000",
      storageCostAnnual: "150",
      now,
    }).find((a) => a.code === "HIGH_CUSTODY_COST");

    expect(alert).toBeDefined();
    expect(alert!.message).toMatch(/1,5 %/);

    // Pile au seuil : pas d'alerte, le seuil est un dépassement strict.
    expect(
      ownershipAlerts({
        estimatedValue: "10000",
        storageCostAnnual: "100",
        now,
      })
    ).toHaveLength(0);
  });

  it("signale un portage supérieur au gain", () => {
    const alert = ownershipAlerts({
      estimatedValue: "11000",
      totalCarryCostEur: "2500.00",
      grossPnlEur: "1000.00",
      now,
    }).find((a) => a.code === "CARRY_EXCEEDS_GAIN");

    expect(alert).toBeDefined();
    expect(alert!.message).toMatch(/2\s500,00/);
  });

  it("ne compare rien quand la durée de détention est inconnue", () => {
    expect(
      ownershipAlerts({
        estimatedValue: "11000",
        totalCarryCostEur: null,
        grossPnlEur: "1000.00",
        now,
      })
    ).toHaveLength(0);
  });
});
