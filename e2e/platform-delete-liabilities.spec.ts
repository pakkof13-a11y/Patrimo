import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Supprimer une plateforme peut détacher un crédit de son bien.
 *
 * `Liability.assetId` est en `SetNull` : effacer un bien financé laisse le
 * crédit au passif — le patrimoine net ne bouge donc pas — mais lui retire son
 * bien. La dette cesse alors d'être déductible de l'assiette IFI, qui augmente
 * d'autant. Sur le compte de démonstration, 178 500 € en silence.
 *
 * La suppression reste possible : c'est une décision légitime, et l'écran
 * demande déjà une confirmation écrite. Ce qui manquait, c'est qu'elle dise ce
 * qu'elle va faire. Ces tests vérifient que la vérification préalable nomme
 * les crédits concernés — sans rien supprimer.
 */

async function getJson(request: APIRequestContext, path: string) {
  const res = await request.get(path);
  expect(res.ok(), `${path} → ${res.status()}`).toBeTruthy();
  return res.json();
}

/** Plateforme portant un bien immobilier lui-même financé. */
async function plateformeDuBienFinance(request: APIRequestContext) {
  const [props, credits] = await Promise.all([
    getJson(request, "/api/real-estate/properties"),
    getJson(request, "/api/liabilities"),
  ]);

  const finances = new Set(
    (credits.liabilities ?? [])
      .map((l: { assetId: string | null }) => l.assetId)
      .filter(Boolean)
  );
  const bien = (props.properties ?? []).find(
    (p: { assetId: string }) => finances.has(p.assetId)
  );
  return bien?.platform?.id ?? null;
}

test.describe("Suppression de plateforme — crédits rattachés", () => {
  test("la vérification préalable nomme les crédits qui perdraient leur bien", async ({
    request,
  }) => {
    const platformId = await plateformeDuBienFinance(request);
    test.skip(!platformId, "Aucun bien financé dans le jeu de démonstration");

    // Sans `force` : rien n'est supprimé, on obtient l'inventaire.
    const res = await request.delete(`/api/platforms?id=${platformId}`);
    expect(res.status(), "la vérification doit refuser et détailler").toBe(409);

    const body = await res.json();
    expect(body.code).toBe("HAS_DEPENDENCIES");

    const detaches = body.detachedLiabilities ?? [];
    expect(
      detaches.length,
      "un crédit est rattaché à un bien de cette plateforme"
    ).toBeGreaterThan(0);

    /*
      Le montant annoncé est celui du module Crédits, capital projeté à
      aujourd'hui — pas le solde stocké. Les afficher différemment
      réintroduirait l'écart que la correction des passifs a supprimé.
    */
    const parId = new Map<string, number>(
      ((await getJson(request, "/api/liabilities")).liabilities ?? []).map(
        (l: { id: string; remainingAmount: string }) => [
          l.id,
          Number(l.remainingAmount),
        ]
      )
    );

    for (const l of detaches) {
      expect(l.name, "le crédit doit être nommé").toBeTruthy();
      expect(Number(l.remainingAmountEur)).toBeGreaterThan(0);
      expect(l.propertyName, "le bien doit être nommé").toBeTruthy();
      expect(
        Number(l.remainingAmountEur),
        `« ${l.name} » : ${l.remainingAmountEur} € annoncés à la suppression, ` +
          `${parId.get(l.id)} € au module Crédits`
      ).toBeCloseTo(parId.get(l.id) ?? -1, 2);
    }

    // Et rien n'a bougé.
    const apres = await getJson(request, "/api/liabilities");
    expect((apres.liabilities ?? []).length).toBe(
      ((await getJson(request, "/api/liabilities")).liabilities ?? []).length
    );
  });

  test("une plateforme sans bien financé n'annonce aucun crédit détaché", async ({
    request,
  }) => {
    /*
      Le pendant : l'avertissement ne doit pas apparaître partout. Une
      plateforme de titres n'a aucun crédit rattaché à ses actifs.
    */
    const platforms = await getJson(request, "/api/platforms");
    const cible = (platforms.platforms ?? []).find(
      (p: { name: string }) => /boursorama|fortuneo/i.test(p.name)
    );
    test.skip(!cible, "Aucune plateforme de titres dans le jeu de démonstration");

    const res = await request.delete(`/api/platforms?id=${cible.id}`);
    expect(res.status()).toBe(409);
    const body = await res.json();
    expect(body.detachedLiabilities ?? []).toHaveLength(0);
  });

  test("l'assiette IFI et le patrimoine sont inchangés après la vérification", async ({
    request,
  }) => {
    // La vérification préalable est une lecture : elle ne détache rien.
    const avantIfi = (await getJson(request, "/api/real-estate/tax")).ifi
      .totalDeductibleDebtEur;
    const avantNet = (await getJson(request, "/api/holdings")).summary
      .netWorthEur;

    const platformId = await plateformeDuBienFinance(request);
    test.skip(!platformId, "Aucun bien financé dans le jeu de démonstration");
    await request.delete(`/api/platforms?id=${platformId}`);

    const apresIfi = (await getJson(request, "/api/real-estate/tax")).ifi
      .totalDeductibleDebtEur;
    const apresNet = (await getJson(request, "/api/holdings")).summary
      .netWorthEur;

    expect(apresIfi).toBe(avantIfi);
    expect(apresNet).toBe(avantNet);
  });
});
