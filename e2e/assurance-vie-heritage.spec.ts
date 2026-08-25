import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Les champs d'avant le journal ne peuvent plus créer de valeur hors patrimoine.
 *
 * `LifeInsurance.cashEuro` et `LifeInsuranceProduct` précèdent la bascule des
 * supports vers le journal. Le module les additionnait à l'encours, le
 * patrimoine ne les comptait pas : 37 800 € d'écart sur le compte de
 * démonstration. Le script de migration les classe « supports à migrer », pas
 * « doublons » — ce sont donc des montants réels, à reprendre, jamais à effacer.
 *
 * La règle retenue : le journal fait foi, ce qui l'attend est annoncé à part, et
 * aucun nouveau montant ne rejoint la voie morte.
 */

const suffix = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function json(request: APIRequestContext, path: string) {
  const res = await request.get(path);
  expect(res.ok(), `${path} → ${res.status()}`).toBeTruthy();
  return res.json();
}

test.describe("Assurance-vie — héritage de l'ancienne saisie", () => {
  test("créer un contrat avec un fonds euro hérité n'écrit pas ce montant", async ({
    request,
  }) => {
    const s = suffix();
    const res = await request.post("/api/life-insurance", {
      data: {
        insurer: `E2E Assureur ${s}`,
        openDate: "2024-01-01",
        cashEuro: "5000",
        currency: "EUR",
        premiumsBefore2017Eur: "0",
        premiumsAfter2017Eur: "0",
      },
    });
    expect(res.status(), await res.text()).toBe(201);

    // Le contrat existe, mais sans montant hors patrimoine.
    const av = await json(request, "/api/life-insurance");
    const cree = (av.policies ?? []).find(
      (p: { insurer: string }) => p.insurer === `E2E Assureur ${s}`
    );
    expect(cree, "Le contrat doit être créé").toBeTruthy();
    expect(Number(cree.cashEuro)).toBe(0);
    expect(Number(cree.legacyOutstandingEur)).toBe(0);
    expect(Number(cree.outstandingEur)).toBe(0);

    await request.delete(`/api/life-insurance?id=${encodeURIComponent(cree.id)}`);
  });

  test("porter un fonds euro sur un contrat existant est refusé, et le dit", async ({
    request,
  }) => {
    const av = await json(request, "/api/life-insurance");
    const contrat = (av.policies ?? [])[0];
    expect(contrat, "Aucun contrat d'assurance-vie").toBeTruthy();

    const res = await request.put("/api/life-insurance", {
      data: { id: contrat.id, cashEuro: "1000" },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain("journal");

    // Rien n'a bougé.
    const apres = await json(request, "/api/life-insurance");
    expect(apres.totalLegacyOutstandingEur).toBe(av.totalLegacyOutstandingEur);
  });

  test("créer une ligne de produit hérité est refusé", async ({ request }) => {
    const av = await json(request, "/api/life-insurance");
    const contrat = (av.policies ?? [])[0];
    expect(contrat).toBeTruthy();

    const res = await request.post("/api/life-insurance", {
      data: {
        kind: "product",
        lifeInsuranceId: contrat.id,
        name: "Produit hérité",
        currentValue: "1000",
        currency: "EUR",
      },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error).toContain("journal");
  });

  test("les reliquats existants restent lisibles, contrat par contrat", async ({
    request,
  }) => {
    /*
      Rétrocompatibilité : un compte non migré doit continuer de voir ses
      montants. Ils sortent de l'encours, ils ne sortent pas de l'écran.
    */
    const av = await json(request, "/api/life-insurance");
    const policies = (av.policies ?? []) as Array<{
      insurer: string;
      cashEuro: string;
      outstandingEur: string;
      legacyOutstandingEur: string;
      products: unknown[];
    }>;

    for (const p of policies) {
      // Le reliquat annoncé est bien celui des anciens champs du contrat.
      const attendu =
        Number(p.cashEuro) +
        (p.products as Array<{ currentValue: string }>).reduce(
          (a, x) => a + Number(x.currentValue),
          0
        );
      expect(
        Number(p.legacyOutstandingEur),
        `${p.insurer} : reliquat annoncé ${p.legacyOutstandingEur}, champs hérités ${attendu}`
      ).toBeCloseTo(attendu, 2);
    }

    // Et le total du module reste l'encours seul, jamais l'encours + reliquat.
    const somme = policies.reduce((a, p) => a + Number(p.outstandingEur), 0);
    expect(somme).toBeCloseTo(Number(av.totalOutstandingEur), 2);
  });

  test("un contrat sans support affiche un encours nul, pas un vide", async ({
    request,
  }) => {
    const s = suffix();
    const res = await request.post("/api/life-insurance", {
      data: {
        insurer: `E2E Contrat Vide ${s}`,
        openDate: "2025-01-01",
        cashEuro: "0",
        currency: "EUR",
        premiumsBefore2017Eur: "0",
        premiumsAfter2017Eur: "0",
      },
    });
    expect(res.status(), await res.text()).toBe(201);

    const av = await json(request, "/api/life-insurance");
    const vide = (av.policies ?? []).find(
      (p: { insurer: string }) => p.insurer === `E2E Contrat Vide ${s}`
    );
    expect(vide).toBeTruthy();
    expect(Number(vide.outstandingEur)).toBe(0);

    await request.delete(`/api/life-insurance?id=${encodeURIComponent(vide.id)}`);
  });
});
