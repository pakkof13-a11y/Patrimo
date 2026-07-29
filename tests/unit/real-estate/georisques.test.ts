import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchGeorisquesRisks,
  mapRiskReport,
} from "@/app/lib/real-estate/georisques";

afterEach(() => vi.unstubAllGlobals());

function stubGeorisques(payload: unknown, ok = true, status = 200) {
  const spy = vi.fn(async (_url: string) => ({
    ok,
    status,
    json: async () => payload,
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("mapRiskReport — sismique", () => {
  it("mappe la zone 1 (très faible) à AUCUN", () => {
    const out = mapRiskReport({ sismicite: { zonageSismique: "1" } });
    expect(out.seismic).toBe("AUCUN");
  });

  it("mappe la zone 2 à FAIBLE", () => {
    expect(mapRiskReport({ sismicite: { zonageSismique: "2" } }).seismic).toBe(
      "FAIBLE"
    );
  });

  it("mappe les zones 3 et 4 à MOYEN", () => {
    expect(mapRiskReport({ sismicite: { zonageSismique: "3" } }).seismic).toBe(
      "MOYEN"
    );
    expect(mapRiskReport({ sismicite: { zonageSismique: "4" } }).seismic).toBe(
      "MOYEN"
    );
  });

  it("mappe la zone 5 (Antilles) à FORT", () => {
    expect(mapRiskReport({ sismicite: { zonageSismique: "5" } }).seismic).toBe(
      "FORT"
    );
  });

  it("extrait le chiffre d'un libellé textuel", () => {
    // Forme réaliste : « Zone 3 (modérée) ».
    expect(
      mapRiskReport({ sismicite: { zonageSismique: "Zone 3 (modérée)" } })
        .seismic
    ).toBe("MOYEN");
  });

  it("accepte la variante snake_case", () => {
    expect(
      mapRiskReport({ sismicite: { zonage_sismique: "2" } }).seismic
    ).toBe("FAIBLE");
  });

  it("rend null pour un zonage hors plage", () => {
    expect(mapRiskReport({ sismicite: { zonageSismique: "9" } }).seismic).toBeNull();
  });
});

describe("mapRiskReport — radon", () => {
  it("mappe les trois catégories officielles", () => {
    expect(mapRiskReport({ radon: { classePotentiel: "1" } }).radon).toBe(
      "FAIBLE"
    );
    expect(mapRiskReport({ radon: { classePotentiel: "2" } }).radon).toBe(
      "MOYEN"
    );
    expect(mapRiskReport({ radon: { classePotentiel: "3" } }).radon).toBe(
      "FORT"
    );
  });

  it("accepte les variantes de nommage plausibles", () => {
    expect(mapRiskReport({ radon: { categorie: "3" } }).radon).toBe("FORT");
    expect(mapRiskReport({ potentielRadon: "1" }).radon).toBe("FAIBLE");
  });

  it("rend null pour une catégorie hors 1-3", () => {
    expect(mapRiskReport({ radon: { classePotentiel: "0" } }).radon).toBeNull();
  });
});

describe("mapRiskReport — inondation et argiles (aléa qualitatif)", () => {
  it("reconnaît les niveaux littéraux malgré la casse", () => {
    expect(mapRiskReport({ inondation: { alea: "Fort" } }).flood).toBe("FORT");
    expect(mapRiskReport({ argiles: { alea: "moyen" } }).claySoil).toBe(
      "MOYEN"
    );
  });

  it("absorbe les variantes de libellé (« Fort à très fort »)", () => {
    expect(
      mapRiskReport({ argiles: { expositionAlea: "Fort à très fort" } })
        .claySoil
    ).toBe("FORT");
  });

  it("reconnaît l'absence de risque sous plusieurs formulations", () => {
    expect(mapRiskReport({ argiles: { alea: "A priori nul" } }).claySoil).toBe(
      "AUCUN"
    );
    expect(
      mapRiskReport({ inondation: { alea: "Non exposé" } }).flood
    ).toBe("AUCUN");
  });

  it("essaie plusieurs chemins avant de renoncer", () => {
    expect(
      mapRiskReport({ zonageInondation: { alea: "Faible" } }).flood
    ).toBe("FAIBLE");
    expect(
      mapRiskReport({ retraitGonflementArgiles: { alea: "Faible" } }).claySoil
    ).toBe("FAIBLE");
  });
});

describe("mapRiskReport — robustesse", () => {
  it("ne plante jamais sur une réponse vide", () => {
    expect(mapRiskReport({})).toEqual({
      flood: null,
      seismic: null,
      radon: null,
      claySoil: null,
    });
  });

  it("ne plante jamais sur des types inattendus (null, tableau, nombre)", () => {
    expect(mapRiskReport(null)).toEqual({
      flood: null,
      seismic: null,
      radon: null,
      claySoil: null,
    });
    expect(mapRiskReport([1, 2, 3])).toEqual({
      flood: null,
      seismic: null,
      radon: null,
      claySoil: null,
    });
    expect(mapRiskReport(42)).toEqual({
      flood: null,
      seismic: null,
      radon: null,
      claySoil: null,
    });
  });

  it("ignore un libellé qui ne correspond à aucun mot-clé connu", () => {
    expect(mapRiskReport({ inondation: { alea: "???" } }).flood).toBeNull();
  });
});

describe("fetchGeorisquesRisks", () => {
  it("rend les quatre risques sur une réponse complète", async () => {
    stubGeorisques({
      sismicite: { zonageSismique: "3" },
      radon: { classePotentiel: "2" },
      inondation: { alea: "Faible" },
      argiles: { alea: "Fort" },
    });
    const out = await fetchGeorisquesRisks({ latitude: 43.3, longitude: 5.37 });
    expect(out).toEqual({
      kind: "ok",
      risks: { seismic: "MOYEN", radon: "MOYEN", flood: "FAIBLE", claySoil: "FORT" },
    });
  });

  it("interroge latlon dans l'ordre longitude,latitude", async () => {
    const spy = stubGeorisques({});
    await fetchGeorisquesRisks({ latitude: 43.3, longitude: 5.37 });
    const calledUrl = new URL(spy.mock.calls[0]![0]);
    expect(calledUrl.searchParams.get("latlon")).toBe("5.37,43.3");
  });

  it("rend unavailable sur une réponse HTTP en erreur", async () => {
    stubGeorisques({}, false, 503);
    const out = await fetchGeorisquesRisks({ latitude: 43.3, longitude: 5.37 });
    expect(out.kind).toBe("unavailable");
  });

  it("rend unavailable sur une exception réseau, sans jamais lever", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    const out = await fetchGeorisquesRisks({ latitude: 43.3, longitude: 5.37 });
    expect(out).toEqual({ kind: "unavailable", error: "network down" });
  });

  it("rend un résultat ok avec des risques null quand rien n'est reconnu", async () => {
    // Schéma de réponse inattendu : dégradation silencieuse, pas d'échec.
    stubGeorisques({ champInconnu: "valeur" });
    const out = await fetchGeorisquesRisks({ latitude: 43.3, longitude: 5.37 });
    expect(out).toEqual({
      kind: "ok",
      risks: { flood: null, seismic: null, radon: null, claySoil: null },
    });
  });
});
