import { test, expect } from "@playwright/test";
import { gotoDashboard } from "./helpers";

/**
 * Onglet « PEA & CTO ».
 *
 * Couvre ce que le tableau Positions ne portait pas : l'unicité légale du PEA,
 * le plafond de versement croisé PEA + PEA-PME, l'antériorité fiscale et la
 * simulation de retrait. Le CTO sert de témoin — il ne doit afficher ni
 * plafond, ni règle des 5 ans.
 */

/**
 * Chaque test repart d'un état vide : les comptes sont uniques par enveloppe
 * (un seul PEA par personne), donc un résidu d'un test précédent ferait échouer
 * la création du suivant. On supprime via l'API plutôt que par l'UI — c'est du
 * nettoyage de fixture, pas le comportement testé.
 */
async function resetAccounts(request: import("@playwright/test").APIRequestContext) {
  const res = await request.get("/api/securities");
  if (!res.ok()) return;
  const body = await res.json();
  for (const account of body.accounts ?? []) {
    await request.delete(`/api/securities/accounts/${account.id}`);
  }
}

async function firstBrokerId(
  request: import("@playwright/test").APIRequestContext
): Promise<string> {
  const body = await (await request.get("/api/platforms")).json();
  const platforms = body.platforms ?? [];
  const broker = platforms.find(
    (p: { type?: string }) => p.type === "COURTIER"
  );
  return (broker ?? platforms[0]).id;
}

test.describe("PEA & CTO", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await resetAccounts(page.request);
    await page.goto("/pea-cto", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("securities-panel")).toBeVisible({
      timeout: 20_000,
    });
  });

  test.afterEach(async ({ page }) => {
    await resetAccounts(page.request);
  });

  test("ouvre un PEA et refuse le second — la loi n'en autorise qu'un", async ({
    page,
  }) => {
    await page.getByTestId("securities-form-toggle").click();
    await expect(page.getByTestId("securities-form")).toBeVisible();

    await page.getByTestId("securities-envelope-type").selectOption("PEA");
    await page.getByTestId("securities-platform").selectOption({ index: 1 });
    await page.getByTestId("securities-open-date").fill("2019-03-01");
    await page.getByTestId("securities-submit").click();
    await expect(page.getByText("Compte enregistré")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("securities-account-card")).toHaveCount(1);

    // Second PEA : refusé avec un message métier, pas une erreur technique.
    await page.getByTestId("securities-form-toggle").click();
    await page.getByTestId("securities-envelope-type").selectOption("PEA");
    await page.getByTestId("securities-platform").selectOption({ index: 1 });
    await page.getByTestId("securities-open-date").fill("2021-05-01");
    await page.getByTestId("securities-submit").click();

    await expect(page.getByText(/vous détenez déjà un PEA/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("securities-account-card")).toHaveCount(1);
  });

  test("plusieurs CTO sont acceptés, et n'affichent ni plafond ni règle des 5 ans", async ({
    page,
  }) => {
    for (const openDate of ["2020-01-01", "2022-06-15"]) {
      await page.getByTestId("securities-form-toggle").click();
      await page.getByTestId("securities-envelope-type").selectOption("CTO");
      await page.getByTestId("securities-platform").selectOption({ index: 1 });
      await page.getByTestId("securities-open-date").fill(openDate);
      await page.getByTestId("securities-submit").click();
      await expect(page.getByText("Compte enregistré")).toBeVisible({
        timeout: 15_000,
      });
    }

    await expect(page.getByTestId("securities-account-card")).toHaveCount(2);
    // Un compte-titres n'a ni plafond de versement ni antériorité fiscale.
    await expect(page.getByTestId("securities-room-gauge")).toHaveCount(0);
    await expect(page.getByTestId("securities-maturity")).toHaveCount(0);
  });

  test("le plafond du PEA-PME tient compte des versements du PEA", async ({
    page,
  }) => {
    const brokerId = await firstBrokerId(page.request);

    // Le plafond croisé se vérifie sur des montants précis : on met en place
    // l'état par l'API, l'objet du test étant ce que l'écran en déduit.
    const pea = await (
      await page.request.post("/api/securities/accounts", {
        data: {
          envelopeType: "PEA",
          platformId: brokerId,
          openDate: "2019-03-01",
        },
      })
    ).json();
    await page.request.post(
      `/api/securities/accounts/${pea.id}/contributions`,
      { data: { type: "DEPOSIT", amountEur: "150000", occurredAt: "2019-04-01" } }
    );
    await page.request.post("/api/securities/accounts", {
      data: {
        envelopeType: "PEA_PME",
        platformId: brokerId,
        openDate: "2024-02-01",
      },
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("securities-account-card")).toHaveCount(2);

    // Le PEA est plein : plus aucune place, et la borne est son plafond propre.
    const captions = page.getByTestId("securities-room-caption");
    await expect(captions.first()).toContainText(/0,00\s*€ de versement/);

    // Le PEA-PME est vide : isolément il afficherait 225 000 €. Il rend
    // 75 000 € parce que le PEA plein consomme le plafond commun — et l'écran
    // doit l'expliquer, sans quoi le chiffre paraît faux.
    const pmeCaption = captions.nth(1);
    await expect(pmeCaption).toContainText("75 000,00");
    await expect(pmeCaption).toContainText(/plafond commun PEA \+ PEA-PME/i);
  });

  test("l'antériorité ne dit jamais « exonéré » sans les prélèvements sociaux", async ({
    page,
  }) => {
    const brokerId = await firstBrokerId(page.request);
    await page.request.post("/api/securities/accounts", {
      data: {
        envelopeType: "PEA",
        platformId: brokerId,
        openDate: "2019-03-01",
      },
    });
    await page.request.post("/api/securities/accounts", {
      data: {
        envelopeType: "PEA_PME",
        platformId: brokerId,
        openDate: "2024-02-01",
      },
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    const maturity = page.getByTestId("securities-maturity");
    await expect(maturity).toHaveCount(2);

    // Plan mûr : l'impôt sur le revenu tombe, les prélèvements sociaux restent.
    await expect(maturity.first()).toContainText("IR exonéré");
    await expect(maturity.first()).toContainText("17,2");
    // Plan récent : les deux composantes sont annoncées.
    await expect(maturity.nth(1)).toContainText("12,8");
    await expect(maturity.nth(1)).toContainText("17,2");
  });

  test("le simulateur refuse un retrait supérieur à la valeur du plan", async ({
    page,
  }) => {
    const brokerId = await firstBrokerId(page.request);
    await page.request.post("/api/securities/accounts", {
      data: {
        envelopeType: "PEA",
        platformId: brokerId,
        openDate: "2019-03-01",
      },
    });

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("securities-account-toggle").first().click();
    await page
      .getByTestId("securities-withdrawal-amount")
      .first()
      .fill("999999999");

    // Ne rien calculer vaut mieux qu'afficher un montant faux.
    await expect(
      page.getByText(/supérieur à la valeur du plan/i)
    ).toBeVisible();
    await expect(page.getByTestId("securities-withdrawal-result")).toHaveCount(
      0
    );
  });

  test("les anciennes URL d'enveloppe mènent à l'onglet dédié", async ({
    page,
  }) => {
    await page.goto("/positions/pea", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("securities-panel")).toBeVisible({
      timeout: 20_000,
    });

    await page.goto("/positions/cto", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("securities-panel")).toBeVisible({
      timeout: 20_000,
    });
  });
});
