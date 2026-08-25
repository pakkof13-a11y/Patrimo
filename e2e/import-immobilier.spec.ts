import { test, expect, type APIRequestContext } from "@playwright/test";
import { ensurePlatform } from "./helpers";

/**
 * L'import CSV est la troisième porte vers l'enveloppe immobilière.
 *
 * `POST /api/assets` et `PATCH .../account-type` consultent désormais la règle
 * des fiches obligatoires. L'import, lui, construisait `accountType` lui-même
 * et créait l'actif par Prisma : il pouvait donc encore produire l'état des
 * SCPI — une position qui pèse au patrimoine et dans l'assiette IFI sans
 * figurer dans aucun onglet du module.
 *
 * Le refus porte sur la **création** seule. Importer des opérations sur un bien
 * ou une SCPI qui existent déjà, avec leur fiche, reste le cas normal et doit
 * continuer de fonctionner.
 */

const suffix = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

/** Frais uniques par run : le commit déduplique par empreinte économique. */
const uniqueFees = () => (1 + (Date.now() % 1_000_000) / 10_000_000).toFixed(7);

async function previewAndCommit(
  request: APIRequestContext,
  csvText: string,
  platformId: string
) {
  const preview = await request.post("/api/import/preview", {
    data: { csvText, formatId: "patrimo" },
  });
  expect(preview.ok(), await preview.text()).toBeTruthy();
  const { rows } = await preview.json();

  const fees = uniqueFees();
  const commit = await request.post("/api/import/commit", {
    data: {
      platformId,
      rows: rows.map((r: Record<string, unknown>) => ({ ...r, selected: true, fees })),
    },
  });
  expect(commit.ok(), await commit.text()).toBeTruthy();
  return commit.json();
}

const csv = (rows: string[]) =>
  [
    "date;type;ticker;name;quantity;unit_price;fees;currency;cash_amount;notes;asset_class",
    ...rows,
  ].join("\n") + "\n";

test.describe("Import CSV — enveloppe immobilière", () => {
  test("un actif immobilier inconnu est refusé, ligne par ligne", async ({
    request,
  }) => {
    const platformId = await ensurePlatform(request);
    const s = suffix();

    const res = await previewAndCommit(
      request,
      csv([
        `10/03/2025;ACHAT;IMMOX${s};Immeuble Inconnu ${s};1;150000;0;EUR;;;IMMOBILIER`,
      ]),
      platformId
    );

    expect(res.created).toBe(0);
    expect(res.errors.length).toBeGreaterThan(0);
    // Le message doit dire où aller, pas seulement que c'est refusé.
    expect(res.errors[0].message).toContain("IMMOBILIER");
    expect(res.errors[0].message).toContain("SCPI");

    // Et rien n'a été écrit : aucun actif orphelin ne reste derrière.
    const bundle = await (await request.get("/api/holdings")).json();
    const orphelin = (bundle.holdings ?? []).find((h: { name: string }) =>
      h.name.includes(`Immeuble Inconnu ${s}`)
    );
    expect(orphelin, "Un actif immobilier a été créé malgré le refus").toBeUndefined();
  });

  test("le rejet d'une ligne immobilière n'emporte pas les autres", async ({
    request,
  }) => {
    /*
      Le commit traite les lignes une à une et collecte ses erreurs : une ligne
      refusée ne doit ni annuler ni bloquer le reste du fichier.
    */
    const platformId = await ensurePlatform(request);
    const s = suffix();

    const res = await previewAndCommit(
      request,
      csv([
        `11/03/2025;ACHAT;IMMOY${s};Immeuble Refusé ${s};1;90000;0;EUR;;;IMMOBILIER`,
        `12/03/2025;ACHAT;ORD${s};Titre Ordinaire ${s};5;100;0;EUR;;;ACTIONS`,
      ]),
      platformId
    );

    expect(res.created).toBe(1);
    expect(res.errors.length).toBe(1);
    expect(res.errors[0].message).toContain("IMMOBILIER");
  });

  test("importer sur une SCPI existante reste le cas normal", async ({
    request,
  }) => {
    /*
      Le garde-fou ne porte que sur la création. Le compte de démonstration
      porte deux SCPI avec leur fiche : un versement doit s'y importer sans
      obstacle, sur l'actif existant.
    */
    const vehicules = (await (await request.get("/api/real-estate/indirect")).json())
      .vehicles as Array<{ assetId: string; label: string }>;
    expect(
      vehicules.length,
      "Aucune SCPI : ce scénario n'est plus couvert par les données."
    ).toBeGreaterThan(0);

    const bundle = await (await request.get("/api/holdings")).json();
    const scpi = (bundle.holdings ?? []).find(
      (h: { assetId: string }) => h.assetId === vehicules[0].assetId
    );
    expect(scpi).toBeTruthy();

    const platformId = await ensurePlatform(request);
    const res = await previewAndCommit(
      request,
      csv([
        `15/06/2025;ACHAT;${scpi.ticker};${scpi.name};1;210;0;EUR;;;IMMOBILIER`,
      ]),
      platformId
    );

    expect(res.errors, JSON.stringify(res.errors)).toHaveLength(0);
    expect(res.created).toBe(1);
    // Réutilisation, pas création : la SCPI garde sa fiche.
    expect(res.assetsCreated).toBe(0);
  });

  test("les classes non immobilières s'importent comme avant", async ({
    request,
  }) => {
    const platformId = await ensurePlatform(request);
    const s = suffix();

    const res = await previewAndCommit(
      request,
      csv([
        `01/04/2025;ACHAT;ACT${s};Action Test ${s};3;50;0;EUR;;;ACTIONS`,
        `02/04/2025;ACHAT;BTC${s};Crypto Test ${s};0.01;40000;0;EUR;;;CRYPTO`,
      ]),
      platformId
    );

    expect(res.errors, JSON.stringify(res.errors)).toHaveLength(0);
    expect(res.created).toBe(2);
    expect(res.assetsCreated).toBe(2);
  });
});
