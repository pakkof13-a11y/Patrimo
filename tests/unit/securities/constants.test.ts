import { describe, expect, it } from "vitest";
import {
  accountTypeForEnvelope,
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
