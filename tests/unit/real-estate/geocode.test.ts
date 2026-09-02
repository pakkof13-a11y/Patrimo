import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGeocodeQuery,
  departmentFromCode,
  geocodeAddress,
  MIN_GEOCODE_SCORE,
} from "@/app/lib/real-estate/geocode";

afterEach(() => vi.unstubAllGlobals());

function stubBan(features: unknown[], ok = true, status = 200) {
  const spy = vi.fn(async () => ({
    ok,
    status,
    json: async () => ({ features }),
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** Réponse BAN minimale — coordonnées en [longitude, latitude], comme GeoJSON. */
function feature(over: Record<string, unknown> = {}) {
  return {
    geometry: { coordinates: [5.3698, 43.2965] },
    properties: {
      label: "12 Rue de la République 13002 Marseille",
      score: 0.92,
      postcode: "13002",
      city: "Marseille",
      citycode: "13202",
      ...over,
    },
  };
}

describe("buildGeocodeQuery", () => {
  it("assemble rue, code postal et ville", () => {
    expect(
      buildGeocodeQuery({
        addressLine: "12 rue de la République",
        postalCode: "13002",
        city: "Marseille",
      })
    ).toBe("12 rue de la République 13002 Marseille");
  });

  it("ignore les champs vides sans laisser d'espaces doubles", () => {
    expect(
      buildGeocodeQuery({ addressLine: "  12 rue A  ", postalCode: null, city: "Nice" })
    ).toBe("12 rue A Nice");
  });

  it("rend une chaîne vide quand rien n'est saisi", () => {
    expect(buildGeocodeQuery({})).toBe("");
  });
});

describe("geocodeAddress", () => {
  it("rend les coordonnées dans le bon ordre", async () => {
    // La BAN ordonne [longitude, latitude]. Les intervertir placerait les biens
    // français au large de la Somalie sans qu'aucune validation ne bronche.
    stubBan([feature()]);
    const out = await geocodeAddress({ addressLine: "12 rue de la République", city: "Marseille" });
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.result.latitude).toBeCloseTo(43.2965, 4);
    expect(out.result.longitude).toBeCloseTo(5.3698, 4);
  });

  it("remonte le code INSEE, exploitable directement côté DVF", async () => {
    stubBan([feature()]);
    const out = await geocodeAddress({ addressLine: "12 rue de la République", city: "Marseille" });
    if (out.kind !== "ok") throw new Error("attendu ok");
    expect(out.result.inseeCode).toBe("13202");
    expect(out.result.postalCode).toBe("13002");
  });

  it("signale un score faible au lieu de l'accepter en silence", async () => {
    stubBan([feature({ score: 0.2 })]);
    const out = await geocodeAddress({ addressLine: "rue introuvable", city: "Nulle part" });
    expect(out.kind).toBe("low-confidence");
    if (out.kind !== "low-confidence") return;
    expect(out.best.score).toBeLessThan(MIN_GEOCODE_SCORE);
  });

  it("distingue une adresse introuvable d'une API en panne", async () => {
    // Les deux appellent des réactions opposées : corriger la saisie, ou
    // réessayer plus tard.
    stubBan([]);
    expect((await geocodeAddress({ addressLine: "xyz", city: "abc" })).kind).toBe(
      "not-found"
    );

    stubBan([], false, 503);
    const down = await geocodeAddress({ addressLine: "12 rue A", city: "Nice" });
    expect(down.kind).toBe("unavailable");
  });

  it("transforme une panne réseau en résultat, pas en exception", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ENOTFOUND"); }));
    const out = await geocodeAddress({ addressLine: "12 rue A", city: "Nice" });
    expect(out.kind).toBe("unavailable");
    if (out.kind !== "unavailable") return;
    expect(out.error).toContain("ENOTFOUND");
  });

  it("n'appelle pas le réseau pour une saisie vide", async () => {
    const spy = stubBan([feature()]);
    expect((await geocodeAddress({})).kind).toBe("not-found");
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejette une réponse sans coordonnées exploitables", async () => {
    stubBan([{ properties: { label: "x", score: 0.9 } }]);
    expect((await geocodeAddress({ addressLine: "12 rue A", city: "Nice" })).kind).toBe(
      "not-found"
    );
  });
});

describe("departmentFromCode", () => {
  it("lit un département métropolitain", () => {
    expect(departmentFromCode("13202")).toBe("13");
    expect(departmentFromCode("75056")).toBe("75");
  });

  it("gère la Corse", () => {
    expect(departmentFromCode("2A004")).toBe("2A");
    expect(departmentFromCode("2b033")).toBe("2B");
  });

  it("gère l'outre-mer à trois chiffres", () => {
    expect(departmentFromCode("97411")).toBe("974");
    expect(departmentFromCode("97101")).toBe("971");
  });

  it("refuse ce qui n'est pas un code exploitable", () => {
    expect(departmentFromCode("")).toBeNull();
    expect(departmentFromCode(null)).toBeNull();
    expect(departmentFromCode("13")).toBeNull();
    expect(departmentFromCode("abcde")).toBeNull();
  });
});
