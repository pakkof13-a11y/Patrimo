import { describe, expect, it } from "vitest";
import {
  accountTypeForEnvelope,
  eligibleAccounts,
  isSecuritiesEnvelopeType,
  isSingleAccountEnvelope,
  securitiesEnvelopeLabel,
  SINGLE_ACCOUNT_ENVELOPES,
} from "@/app/lib/securities/constants";

describe("securitiesEnvelopeLabel", () => {
  it("traduit les trois types", () => {
    expect(securitiesEnvelopeLabel("PEA")).toBe("PEA");
    expect(securitiesEnvelopeLabel("PEA_PME")).toBe("PEA-PME");
    expect(securitiesEnvelopeLabel("CTO")).toBe("Compte-titres");
  });

  it("retombe sur la valeur brute si inconnue", () => {
    expect(securitiesEnvelopeLabel("INCONNU")).toBe("INCONNU");
  });
});

describe("isSecuritiesEnvelopeType", () => {
  it("accepte les types connus, rejette le reste", () => {
    expect(isSecuritiesEnvelopeType("PEA")).toBe(true);
    expect(isSecuritiesEnvelopeType("CTO")).toBe(true);
    expect(isSecuritiesEnvelopeType("AV")).toBe(false);
    expect(isSecuritiesEnvelopeType("")).toBe(false);
  });
});

describe("isSingleAccountEnvelope", () => {
  it("PEA et PEA-PME sont limités à un par personne", () => {
    expect(isSingleAccountEnvelope("PEA")).toBe(true);
    expect(isSingleAccountEnvelope("PEA_PME")).toBe(true);
  });

  it("le compte-titres ordinaire ne l'est pas", () => {
    expect(isSingleAccountEnvelope("CTO")).toBe(false);
  });

  it("la liste ne contient que les deux plans réglementés", () => {
    expect([...SINGLE_ACCOUNT_ENVELOPES].sort()).toEqual(["PEA", "PEA_PME"]);
  });
});

describe("accountTypeForEnvelope", () => {
  it("PEA et PEA-PME partagent la famille fiscale PEA", () => {
    expect(accountTypeForEnvelope("PEA")).toBe("PEA");
    expect(accountTypeForEnvelope("PEA_PME")).toBe("PEA");
  });

  it("le compte-titres a la sienne", () => {
    expect(accountTypeForEnvelope("CTO")).toBe("CTO");
  });
});

describe("eligibleAccounts", () => {
  const comptes = [
    { id: "pea", envelopeType: "PEA" },
    { id: "pme", envelopeType: "PEA_PME" },
    { id: "cto1", envelopeType: "CTO" },
    { id: "cto2", envelopeType: "CTO" },
  ];

  it("une ligne PEA peut aller sur un PEA ou un PEA-PME", () => {
    expect(eligibleAccounts("PEA", comptes).map((a) => a.id)).toEqual([
      "pea",
      "pme",
    ]);
  });

  it("une ligne CTO ne voit que les comptes-titres", () => {
    expect(eligibleAccounts("CTO", comptes).map((a) => a.id)).toEqual([
      "cto1",
      "cto2",
    ]);
  });

  it("ne propose jamais un rattachement que le service refuserait", () => {
    // Déplacer une ligne d'un CTO vers un PEA est un transfert de titres, pas
    // une correction de saisie : l'option ne doit pas être offerte.
    const pourCto = eligibleAccounts("CTO", comptes);
    expect(pourCto.some((a) => a.envelopeType.startsWith("PEA"))).toBe(false);
  });

  it("ignore une enveloppe inconnue plutôt que de la proposer", () => {
    const avecIntrus = [...comptes, { id: "x", envelopeType: "LIVRET_A" }];
    expect(eligibleAccounts("CTO", avecIntrus).map((a) => a.id)).toEqual([
      "cto1",
      "cto2",
    ]);
  });

  it("aucun compte compatible → liste vide", () => {
    expect(eligibleAccounts("PEA", [{ envelopeType: "CTO" }])).toEqual([]);
    expect(eligibleAccounts("CTO", [])).toEqual([]);
  });
});
