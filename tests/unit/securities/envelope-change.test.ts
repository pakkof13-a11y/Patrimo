/**
 * Changement d'enveloppe fiscale d'une ligne titre.
 *
 * `setAssetAccount` refuse de **créer** un rattachement incohérent. Ce fichier
 * couvre l'autre bout du même invariant : changer l'`accountType` d'une ligne
 * déjà rattachée ne doit pas laisser un compte d'une autre famille fiscale.
 *
 * Ce que le défaut produisait n'était pas une ligne orpheline — visible — mais
 * une ligne **mal attribuée** : une ligne PEA affichée dans la carte d'un CTO,
 * comptée dans sa valeur liquidative et dans son rapport fiscal, invisible du
 * bandeau des non rattachées puisqu'elle avait bien un compte.
 *
 * Prisma est mocké : la question porte sur ce que la route **écrit**, pas sur
 * la base. Aucune donnée réelle, aucun seed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { envelopeChangeBreaksAttachment } from "@/app/lib/securities/constants";

const assetFindFirst = vi.fn();
const assetUpdateMany = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    asset: {
      findFirst: (...a: unknown[]) => assetFindFirst(...a),
      updateMany: (...a: unknown[]) => assetUpdateMany(...a),
    },
  },
}));

vi.mock("@/app/lib/auth-helpers", () => ({
  requireUserId: async () => "user-1",
}));

const { PATCH } = await import("@/app/api/assets/[id]/account-type/route");

/** Une ligne titre, éventuellement rattachée à un compte. */
function ligne(over: Record<string, unknown> = {}) {
  return {
    id: "asset-1",
    userId: "user-1",
    name: "Air Liquide",
    accountType: "PEA",
    securitiesAccountId: null,
    securitiesAccount: null,
    realEstate: null,
    indirectRealEstate: null,
    ...over,
  };
}

/** Le corps `data` réellement transmis à Prisma pour l'écriture. */
async function ecritureApresChangement(
  asset: ReturnType<typeof ligne>,
  vers: string
) {
  assetFindFirst.mockReset();
  assetUpdateMany.mockReset();
  // 1er appel : la lecture ; 2nd : la relecture après écriture.
  assetFindFirst
    .mockResolvedValueOnce(asset)
    .mockResolvedValueOnce({ ...asset, accountType: vers });
  assetUpdateMany.mockResolvedValue({ count: 1 });

  const res = await PATCH(
    new Request("http://localhost/api/assets/asset-1/account-type", {
      method: "PATCH",
      body: JSON.stringify({ accountType: vers }),
      headers: { "content-type": "application/json" },
    }),
    { params: Promise.resolve({ id: "asset-1" }) }
  );

  return {
    status: res.status,
    data: assetUpdateMany.mock.calls[0]?.[0]?.data as
      | Record<string, unknown>
      | undefined,
  };
}

beforeEach(() => {
  assetFindFirst.mockReset();
  assetUpdateMany.mockReset();
});

describe("envelopeChangeBreaksAttachment — la règle, isolée", () => {
  it("CTO → PEA sur un compte CTO : le rattachement ne survit pas", () => {
    expect(envelopeChangeBreaksAttachment("CTO", "PEA")).toBe(true);
  });

  it("PEA → CTO sur un compte PEA : le rattachement ne survit pas", () => {
    expect(envelopeChangeBreaksAttachment("PEA", "CTO")).toBe(true);
  });

  it("PEA-PME et PEA sont la même famille fiscale : rien à défaire", () => {
    // Les deux plans obéissent au même régime ; seul leur plafond diffère.
    expect(envelopeChangeBreaksAttachment("PEA_PME", "PEA")).toBe(false);
    expect(envelopeChangeBreaksAttachment("PEA", "PEA")).toBe(false);
  });

  it("CTO → CTO : rien à défaire", () => {
    expect(envelopeChangeBreaksAttachment("CTO", "CTO")).toBe(false);
  });

  it("sortir des titres emporte le rattachement", () => {
    // Un actif devenu AV ou CRYPTO n'a plus rien à faire sur un compte titres.
    expect(envelopeChangeBreaksAttachment("CTO", "AV")).toBe(true);
    expect(envelopeChangeBreaksAttachment("PEA", "CRYPTO")).toBe(true);
  });

  it("aucun rattachement : rien à défaire", () => {
    expect(envelopeChangeBreaksAttachment(null, "PEA")).toBe(false);
    expect(envelopeChangeBreaksAttachment(undefined, "CTO")).toBe(false);
  });

  it("type de compte inconnu : on détache plutôt que de parier", () => {
    expect(envelopeChangeBreaksAttachment("INCONNU", "PEA")).toBe(true);
  });
});

describe("PATCH account-type — ce que la route écrit réellement", () => {
  it("CTO → PEA détache un compte CTO devenu incompatible", async () => {
    const { status, data } = await ecritureApresChangement(
      ligne({
        accountType: "CTO",
        securitiesAccountId: "acc-cto",
        securitiesAccount: { envelopeType: "CTO" },
      }),
      "PEA"
    );

    expect(status).toBe(200);
    expect(data).toEqual({ accountType: "PEA", securitiesAccountId: null });
  });

  it("PEA → CTO détache un compte PEA devenu incompatible", async () => {
    const { status, data } = await ecritureApresChangement(
      ligne({
        accountType: "PEA",
        securitiesAccountId: "acc-pea",
        securitiesAccount: { envelopeType: "PEA" },
      }),
      "CTO"
    );

    expect(status).toBe(200);
    expect(data).toEqual({ accountType: "CTO", securitiesAccountId: null });
  });

  it("PEA sur un PEA-PME : le rattachement est conservé", async () => {
    /*
      Le détachement doit être chirurgical. Détacher « par prudence » à chaque
      changement ferait perdre un rattachement que l'utilisateur avait posé à
      la main, sans que rien ne le justifie.
    */
    const { data } = await ecritureApresChangement(
      ligne({
        accountType: "PEA",
        securitiesAccountId: "acc-pea-pme",
        securitiesAccount: { envelopeType: "PEA_PME" },
      }),
      "PEA"
    );

    expect(data).toEqual({ accountType: "PEA" });
    expect(data).not.toHaveProperty("securitiesAccountId");
  });

  it("une ligne non rattachée n'écrit aucun détachement", async () => {
    const { data } = await ecritureApresChangement(
      ligne({ accountType: "CTO", securitiesAccountId: null }),
      "PEA"
    );

    expect(data).toEqual({ accountType: "PEA" });
  });

  it("sortir des titres vers l'assurance-vie détache aussi", async () => {
    const { data } = await ecritureApresChangement(
      ligne({
        accountType: "CTO",
        securitiesAccountId: "acc-cto",
        securitiesAccount: { envelopeType: "CTO" },
      }),
      "AV"
    );

    expect(data).toEqual({ accountType: "AV", securitiesAccountId: null });
  });
});

describe("fiscalité — aucune ligne incompatible ne peut rester dans un compte", () => {
  /**
   * Le rapport fiscal et la valeur liquidative d'un compte se construisent en
   * filtrant les positions sur `securitiesAccountId`, **sans** revérifier
   * l'enveloppe. C'est un choix sain — le filtre serait redondant si l'état
   * incohérent ne peut pas exister — mais il ne tient que si les deux portes
   * qui écrivent ce champ le garantissent.
   *
   * Il n'y en a que deux : le rattachement (`setAssetAccount`, qui refuse déjà
   * un couple incompatible) et le changement d'enveloppe (qui détache). Ce
   * tableau vérifie la seconde sur **tous** les couples possibles, plutôt que
   * sur les deux ou trois auxquels on pense spontanément.
   */
  const ENVELOPPES = ["PEA", "PEA_PME", "CTO"] as const;
  const FAMILLES = ["PEA", "CTO", "AV", "CRYPTO", "IMMOBILIER"] as const;

  it.each(ENVELOPPES)(
    "un compte %s ne conserve que des lignes de sa propre famille fiscale",
    (envelopeType) => {
      const familleDuCompte = envelopeType === "CTO" ? "CTO" : "PEA";

      for (const nouvelleFamille of FAMILLES) {
        const detache = envelopeChangeBreaksAttachment(
          envelopeType,
          nouvelleFamille
        );
        const compatible = nouvelleFamille === familleDuCompte;

        // Compatible ⇒ on garde ; incompatible ⇒ on détache. Jamais l'inverse :
        // détacher à tort perd un rattachement posé à la main, garder à tort
        // fait entrer la ligne dans le mauvais rapport fiscal.
        expect(detache).toBe(!compatible);
      }
    }
  );

  it("aucun couple (compte, ligne) incompatible ne survit", () => {
    /*
      Formulé à l'envers du test précédent : on énumère les états finaux
      possibles et on vérifie qu'aucun état incohérent n'en fait partie.
    */
    const survivants: Array<{ compte: string; ligne: string }> = [];
    for (const envelopeType of ENVELOPPES) {
      for (const ligneFamille of FAMILLES) {
        if (!envelopeChangeBreaksAttachment(envelopeType, ligneFamille)) {
          survivants.push({ compte: envelopeType, ligne: ligneFamille });
        }
      }
    }

    expect(survivants).toEqual([
      { compte: "PEA", ligne: "PEA" },
      { compte: "PEA_PME", ligne: "PEA" },
      { compte: "CTO", ligne: "CTO" },
    ]);
  });
});
