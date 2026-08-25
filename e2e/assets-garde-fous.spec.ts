import { test, expect, type APIRequestContext } from "@playwright/test";
import { ensurePlatform } from "./helpers";

/**
 * Les portes d'écriture ne doivent plus pouvoir recréer l'état des SCPI.
 *
 * Deux SCPI ont compté 25 240 € au patrimoine et dans l'assiette IFI sans
 * figurer dans aucun onglet du module Immobilier. Le seed a été corrigé, mais
 * l'état restait atteignable en une requête : créer un actif directement en
 * IMMOBILIER, ou y reclasser n'importe quelle ligne existante.
 *
 * Ces tests décrivent ce que les deux portes acceptent et refusent. Ils
 * vérifient aussi le sens inverse — retirer un bien de son enveloppe
 * abandonnerait sa fiche, que son onglet afficherait alors à 0 €.
 */

const suffix = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function createAsset(
  request: APIRequestContext,
  platformId: string,
  data: Record<string, unknown>
) {
  return request.post("/api/assets", {
    data: {
      platformId,
      assetClass: "ACTIONS",
      currency: "EUR",
      priceProvider: "MANUAL",
      ...data,
    },
  });
}

test.describe("Garde-fous des enveloppes à fiche obligatoire", () => {
  test("créer un actif directement en IMMOBILIER est refusé, et le dit", async ({
    request,
  }) => {
    const platformId = await ensurePlatform(request);
    const s = suffix();

    const res = await createAsset(request, platformId, {
      name: `E2E Immo Sans Fiche ${s}`,
      ticker: `EIMMO${s}`,
      assetClass: "IMMOBILIER",
      accountType: "IMMOBILIER",
      manualPrice: "250000",
    });

    expect(res.status()).toBe(409);
    const body = await res.json();
    // Le message doit nommer les deux chemins, sinon il déplace le problème.
    expect(body.error).toContain("Biens");
    expect(body.error).toContain("SCPI");
  });

  test("reclasser un actif ordinaire vers IMMOBILIER est refusé", async ({
    request,
  }) => {
    const platformId = await ensurePlatform(request);
    const s = suffix();

    const created = await createAsset(request, platformId, {
      name: `E2E Titre Ordinaire ${s}`,
      ticker: `EORD${s}`,
      accountType: "CTO",
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { asset } = await created.json();

    const patch = await request.patch(`/api/assets/${asset.id}/account-type`, {
      data: { accountType: "IMMOBILIER" },
    });
    expect(patch.status()).toBe(409);
    expect((await patch.json()).error).toContain("IMMOBILIER");

    // Et l'actif n'a pas bougé.
    const after = await request.get("/api/holdings");
    const holdings = (await after.json()).holdings ?? [];
    const ligne = holdings.find((h: { assetId: string }) => h.assetId === asset.id);
    if (ligne) expect(ligne.accountType).toBe("CTO");
  });

  test("une SCPI créée par son flux dédié porte sa fiche et reste visible", async ({
    request,
  }) => {
    /*
      Le pendant du refus : le chemin nominal doit continuer de fonctionner, et
      une part de société n'a pas à porter une fiche de bien direct.
    */
    const platformId = await ensurePlatform(request);
    const s = suffix();

    const res = await request.post("/api/real-estate/indirect", {
      data: {
        platformId,
        name: `E2E SCPI Test ${s}`,
        vehicle: "SCPI",
        manager: "Gérant E2E",
        shares: "10",
        sharePriceEur: "200",
        purchaseDate: new Date().toISOString(),
        currentSharePriceEur: "210",
        realEstateSharePct: "100",
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const { assetId } = await res.json();

    // Elle figure bien dans l'onglet SCPI, sans fiche de bien direct.
    const vehicules = (await (await request.get("/api/real-estate/indirect")).json())
      .vehicles as Array<{ assetId: string }>;
    expect(vehicules.some((v) => v.assetId === assetId)).toBe(true);

    // Et rester en IMMOBILIER lui est permis, puisqu'elle porte sa fiche.
    const patch = await request.patch(`/api/assets/${assetId}/account-type`, {
      data: { accountType: "IMMOBILIER" },
    });
    expect(patch.ok(), await patch.text()).toBeTruthy();

    // Nettoyage : le flux dédié sait retirer ce qu'il a créé.
    await request.delete(
      `/api/real-estate/indirect?assetId=${encodeURIComponent(assetId)}`
    );
  });

  test("sortir un bien de l'enveloppe immobilière est refusé", async ({
    request,
  }) => {
    // Le compte de démonstration porte des actifs immobilier avec fiche.
    const bundle = await (await request.get("/api/holdings")).json();
    const immo = (bundle.holdings ?? []).find(
      (h: { accountType: string }) => h.accountType === "IMMOBILIER"
    );
    expect(
      immo,
      "Aucun actif immobilier : ce scénario n'est plus couvert par les données."
    ).toBeTruthy();

    const patch = await request.patch(`/api/assets/${immo.assetId}/account-type`, {
      data: { accountType: "CTO" },
    });
    expect(patch.status()).toBe(409);
    expect((await patch.json()).error).toContain("0 €");
  });

  test("les enveloppes sans fiche obligatoire restent libres", async ({
    request,
  }) => {
    const platformId = await ensurePlatform(request);
    const s = suffix();

    const created = await createAsset(request, platformId, {
      name: `E2E Reclassable ${s}`,
      ticker: `ERCL${s}`,
      accountType: "CTO",
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { asset } = await created.json();

    for (const env of ["PEA", "CFD", "AV", "CTO"]) {
      const patch = await request.patch(`/api/assets/${asset.id}/account-type`, {
        data: { accountType: env },
      });
      expect(patch.ok(), `${env} : ${await patch.text()}`).toBeTruthy();
    }
  });

  test("un support d'assurance-vie sans contrat reste créable et visible", async ({
    request,
  }) => {
    /*
      L'assurance-vie a la même forme que l'immobilier et pas le même défaut :
      `listSupports()` part des actifs AV et rattache le contrat en jointure
      facultative. Un support orphelin apparaît sous « Supports sans contrat
      rattaché », avec de quoi le relier. Interdire cet état bloquerait un flux
      qui fonctionne — ce test verrouille qu'on ne l'a pas fait.
    */
    const platformId = await ensurePlatform(request);
    const s = suffix();

    const created = await createAsset(request, platformId, {
      name: `E2E Support AV ${s}`,
      ticker: `EAV${s}`,
      accountType: "AV",
      manualPrice: "1000",
    });
    expect(created.status(), await created.text()).toBe(201);
    const { asset } = await created.json();

    const supports = (await (await request.get("/api/life-insurance/supports")).json())
      .supports as Array<{ assetId: string; lifeInsuranceId: string | null }>;
    const ligne = supports.find((x) => x.assetId === asset.id);
    expect(ligne, "Le support créé doit apparaître dans le module AV").toBeTruthy();
    expect(ligne?.lifeInsuranceId).toBeNull();
  });
});
