import { describe, expect, it } from "vitest";
import {
  boundingBox,
  haversineMeters,
  isInBoundingBox,
  isValidLatLon,
  isWithinRadius,
  METERS_PER_DEGREE_LAT,
} from "@/app/lib/real-estate/geo";

const MARSEILLE = { latitude: 43.2965, longitude: 5.3698 };
const AIX = { latitude: 43.5297, longitude: 5.4474 };
const PARIS = { latitude: 48.8566, longitude: 2.3522 };

describe("haversineMeters", () => {
  it("rend zéro pour un point sur lui-même", () => {
    expect(haversineMeters(MARSEILLE, MARSEILLE)).toBe(0);
  });

  it("retrouve une distance connue — Marseille / Aix ≈ 26 km", () => {
    const km = haversineMeters(MARSEILLE, AIX) / 1000;
    expect(km).toBeGreaterThan(25);
    expect(km).toBeLessThan(28);
  });

  it("retrouve une longue distance — Marseille / Paris ≈ 660 km", () => {
    const km = haversineMeters(MARSEILLE, PARIS) / 1000;
    expect(km).toBeGreaterThan(650);
    expect(km).toBeLessThan(670);
  });

  it("mesure un degré de latitude à ~111 km", () => {
    const m = haversineMeters(
      { latitude: 43, longitude: 5 },
      { latitude: 44, longitude: 5 }
    );
    expect(m).toBeGreaterThan(110_000);
    expect(m).toBeLessThan(112_000);
  });

  it("est symétrique", () => {
    expect(haversineMeters(MARSEILLE, PARIS)).toBeCloseTo(
      haversineMeters(PARIS, MARSEILLE),
      6
    );
  });

  it("ne rend jamais NaN pour deux points antipodaux", () => {
    const out = haversineMeters(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 180 }
    );
    expect(Number.isFinite(out)).toBe(true);
    expect(out / 1000).toBeGreaterThan(19_000);
  });
});

describe("boundingBox", () => {
  it("encadre symétriquement en latitude", () => {
    const box = boundingBox(MARSEILLE, 1000);
    const expected = 1000 / METERS_PER_DEGREE_LAT;
    expect(box.maxLat - MARSEILLE.latitude).toBeCloseTo(expected, 9);
    expect(MARSEILLE.latitude - box.minLat).toBeCloseTo(expected, 9);
  });

  it("élargit la boîte en longitude à mesure qu'on monte vers le nord", () => {
    // Un degré de longitude rétrécit avec la latitude : pour couvrir le même
    // rayon en mètres, il faut donc un écart angulaire plus large.
    const equator = boundingBox({ latitude: 0, longitude: 0 }, 1000);
    const marseille = boundingBox(MARSEILLE, 1000);
    const oslo = boundingBox({ latitude: 59.91, longitude: 10.75 }, 1000);

    const width = (b: { minLon: number; maxLon: number }) => b.maxLon - b.minLon;
    expect(width(marseille)).toBeGreaterThan(width(equator));
    expect(width(oslo)).toBeGreaterThan(width(marseille));
  });

  it("contient bien tout le disque demandé", () => {
    // Huit points sur le cercle : tous doivent tomber dans la boîte.
    const box = boundingBox(MARSEILLE, 2000);
    for (let i = 0; i < 8; i++) {
      const angle = (i * Math.PI) / 4;
      const dLat = (2000 * Math.cos(angle)) / METERS_PER_DEGREE_LAT;
      const dLon =
        (2000 * Math.sin(angle)) /
        (METERS_PER_DEGREE_LAT * Math.cos((MARSEILLE.latitude * Math.PI) / 180));
      const point = {
        latitude: MARSEILLE.latitude + dLat,
        longitude: MARSEILLE.longitude + dLon,
      };
      expect(isInBoundingBox(point, box)).toBe(true);
    }
  });

  it("ne diverge pas près des pôles", () => {
    const box = boundingBox({ latitude: 89.9999, longitude: 0 }, 5000);
    expect(box.minLon).toBe(-180);
    expect(box.maxLon).toBe(180);
    expect(box.maxLat).toBeLessThanOrEqual(90);
  });

  it("borne la latitude à l'hémisphère physique", () => {
    const box = boundingBox({ latitude: -89.99, longitude: 0 }, 500_000);
    expect(box.minLat).toBeGreaterThanOrEqual(-90);
  });
});

describe("boîte contre disque — la raison d'être du Haversine", () => {
  it("laisse passer un coin de boîte pourtant hors du rayon", () => {
    const radius = 1000;
    const box = boundingBox(MARSEILLE, radius);
    // Le coin nord-est de la boîte : dans le rectangle, mais à √2 × le rayon
    const corner = { latitude: box.maxLat, longitude: box.maxLon };
    expect(isInBoundingBox(corner, box)).toBe(true);
    expect(isWithinRadius(corner, MARSEILLE, radius)).toBe(false);
    // ≈ 1414 m, soit bien la diagonale
    expect(haversineMeters(MARSEILLE, corner)).toBeGreaterThan(1350);
  });

  it("garde un point réellement dans le rayon", () => {
    const near = {
      latitude: MARSEILLE.latitude + 500 / METERS_PER_DEGREE_LAT,
      longitude: MARSEILLE.longitude,
    };
    expect(isWithinRadius(near, MARSEILLE, 1000)).toBe(true);
  });

  it("inclut la frontière exacte du disque", () => {
    const onEdge = {
      latitude: MARSEILLE.latitude + 1000 / METERS_PER_DEGREE_LAT,
      longitude: MARSEILLE.longitude,
    };
    // Tolérance : la conversion degrés→mètres et le Haversine ne coïncident
    // pas au mètre près, on vérifie donc à 1 % du rayon.
    expect(isWithinRadius(onEdge, MARSEILLE, 1010)).toBe(true);
  });
});

describe("isValidLatLon", () => {
  it("accepte des coordonnées françaises", () => {
    expect(isValidLatLon(MARSEILLE)).toBe(true);
  });

  it("refuse hors domaine et non fini", () => {
    expect(isValidLatLon({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidLatLon({ latitude: 0, longitude: 181 })).toBe(false);
    expect(isValidLatLon({ latitude: NaN, longitude: 0 })).toBe(false);
    expect(isValidLatLon({ latitude: 0, longitude: Infinity })).toBe(false);
  });

  it("accepte le point nul — c'est une coordonnée valide, pas une absence", () => {
    expect(isValidLatLon({ latitude: 0, longitude: 0 })).toBe(true);
  });
});
