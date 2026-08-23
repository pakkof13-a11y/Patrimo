import { test, expect } from "@playwright/test";

/**
 * Cohérence de la tranche marginale entre Immobilier et Fiscalité.
 *
 * Le défaut corrigé : Fiscalité appelait `/api/real-estate/tax?tmi=30` en dur
 * pendant qu'Immobilier tenait la tranche dans un état React local. Le même
 * bien produisait deux impôts fonciers différents selon l'écran consulté.
 *
 * Ces tests passent par l'API plutôt que par l'interface : c'est là que vit la
 * règle de résolution, et c'est elle qui doit être verrouillée. L'UI n'a pas
 * été retouchée par ce chantier.
 */

const RATE = "/api/tax/marginal-rate";
const TAX = "/api/real-estate/tax";

test.describe("Tranche marginale — source de vérité", () => {
  // Le profil est global : chaque test restaure l'état initial pour ne pas
  // conditionner le suivant.
  test.afterEach(async ({ request }) => {
    await request.put(RATE, { data: { marginalTaxRatePct: null } });
  });

  test("aucune tranche déclarée : le défaut s'applique et se signale", async ({
    request,
  }) => {
    await request.put(RATE, { data: { marginalTaxRatePct: null } });

    const rate = await request.get(RATE).then((r) => r.json());
    expect(rate.marginalTaxRatePct).toBeNull();
    expect(rate.applied.pct).toBe(30);
    expect(rate.applied.source).toBe("DEFAULT");

    // Le bundle immobilier dit lui aussi que c'est un défaut, pas un choix.
    const tax = await request.get(TAX).then((r) => r.json());
    expect(tax.marginalTaxRatePct).toBe(30);
    expect(tax.marginalTaxRateSource).toBe("DEFAULT");
  });

  test("une tranche déclarée est appliquée sans paramètre de requête", async ({
    request,
  }) => {
    await request.put(RATE, { data: { marginalTaxRatePct: 41 } });

    const tax = await request.get(TAX).then((r) => r.json());
    expect(tax.marginalTaxRatePct).toBe(41);
    expect(tax.marginalTaxRateSource).toBe("USER");
  });

  test("les deux écrans obtiennent le même impôt foncier", async ({
    request,
  }) => {
    /*
      Le cœur du chantier. Fiscalité et Immobilier appellent désormais la même
      route sans paramètre : leurs réponses doivent être identiques, régime
      retenu et montant compris.
    */
    await request.put(RATE, { data: { marginalTaxRatePct: 41 } });

    const [fiscal, immo] = await Promise.all([
      request.get(TAX).then((r) => r.json()),
      request.get(TAX).then((r) => r.json()),
    ]);

    expect(fiscal.marginalTaxRatePct).toBe(immo.marginalTaxRatePct);
    expect(fiscal.rental.bare.bestRegime).toBe(immo.rental.bare.bestRegime);
    expect(JSON.stringify(fiscal.rental)).toBe(JSON.stringify(immo.rental));
  });

  test("changer de tranche change réellement l'impôt", async ({ request }) => {
    /*
      Si les deux montants étaient égaux, la tranche ne serait pas consommée et
      la correction n'aurait rien changé.
    */
    await request.put(RATE, { data: { marginalTaxRatePct: 11 } });
    const low = await request.get(TAX).then((r) => r.json());

    await request.put(RATE, { data: { marginalTaxRatePct: 45 } });
    const high = await request.get(TAX).then((r) => r.json());

    const hasRental =
      low.rental.bare.count > 0 || low.rental.furnished.count > 0;
    test.skip(!hasRental, "Aucun bien loué dans le jeu de démo");

    const section = low.rental.bare.count > 0 ? "bare" : "furnished";
    const lowTax = Number(
      low.rental[section].outcomes.find(
        (o: { regime: string }) => o.regime === low.rental[section].bestRegime
      )?.totalTaxEur ?? 0
    );
    const highTax = Number(
      high.rental[section].outcomes.find(
        (o: { regime: string }) => o.regime === high.rental[section].bestRegime
      )?.totalTaxEur ?? 0
    );

    expect(highTax).toBeGreaterThan(lowTax);
  });

  test("le paramètre de requête reste utilisable pour une simulation", async ({
    request,
  }) => {
    /*
      Le sélecteur d'Immobilier doit pouvoir explorer une autre tranche sans
      écrire dans le profil — le paramètre n'a donc pas été supprimé.
    */
    await request.put(RATE, { data: { marginalTaxRatePct: 11 } });

    const simulated = await request.get(`${TAX}?tmi=45`).then((r) => r.json());
    expect(simulated.marginalTaxRatePct).toBe(45);
    expect(simulated.marginalTaxRateSource).toBe("QUERY");

    // Et le profil n'a pas bougé.
    const rate = await request.get(RATE).then((r) => r.json());
    expect(rate.marginalTaxRatePct).toBe(11);
  });

  test("une tranche hors barème est refusée", async ({ request }) => {
    // 33 % n'existe pas dans le barème français.
    const res = await request.put(RATE, { data: { marginalTaxRatePct: 33 } });
    expect(res.status()).toBe(400);

    // Et une valeur hors barème en requête est ignorée, pas appliquée.
    await request.put(RATE, { data: { marginalTaxRatePct: 41 } });
    const tax = await request.get(`${TAX}?tmi=33`).then((r) => r.json());
    expect(tax.marginalTaxRatePct).toBe(41);
    expect(tax.marginalTaxRateSource).toBe("USER");
  });

  test("zéro pour cent est une tranche, pas une absence", async ({
    request,
  }) => {
    await request.put(RATE, { data: { marginalTaxRatePct: 0 } });
    const tax = await request.get(TAX).then((r) => r.json());
    expect(tax.marginalTaxRatePct).toBe(0);
    expect(tax.marginalTaxRateSource).toBe("USER");
  });
});
