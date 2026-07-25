/**
 * Recherche géographique sans PostGIS.
 *
 * Deux étapes complémentaires :
 *
 * 1. **Boîte englobante** — un simple encadrement en latitude et longitude,
 *    servi par un index B-tree ordinaire. C'est ce qui rend la requête rapide :
 *    Postgres élimine l'immense majorité des ventes sans calculer la moindre
 *    distance.
 * 2. **Haversine** — la distance réelle, appliquée au petit résidu. Sans elle,
 *    un « rayon de 1 km » serait en fait un carré de 2 km de côté : 27 % de
 *    surface en trop, concentrée dans les coins, donc un biais silencieux vers
 *    les biens en diagonale du point demandé.
 *
 * La Terre est traitée comme une sphère. À l'échelle d'un rayon de quelques
 * kilomètres, l'écart avec l'ellipsoïde reste très inférieur à l'imprécision
 * du géocodage DVF lui-même — raffiner ici n'achèterait aucune justesse.
 */

/** Rayon moyen de la Terre, en mètres (sphère WGS84). */
export const EARTH_RADIUS_M = 6_371_008.8;

/** Longueur d'un degré de latitude, en mètres — constante en tout point. */
export const METERS_PER_DEGREE_LAT = 111_320;

export type LatLon = { latitude: number; longitude: number };

export type BoundingBox = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Distance orthodromique entre deux points, en mètres.
 */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  // `min(1, …)` protège d'un h marginalement > 1 par arrondi flottant, qui
  // ferait renvoyer NaN à `asin` pour deux points quasi antipodaux.
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Boîte englobant le disque de rayon `radiusM` autour du centre.
 *
 * La largeur en longitude dépend de la latitude : un degré de longitude vaut
 * ~111 km à l'équateur mais ~82 km à Marseille et ~56 km à Oslo. Utiliser une
 * constante rétrécirait la boîte vers le nord et perdrait des comparables
 * pourtant dans le rayon.
 *
 * Aux pôles, le cosinus tend vers zéro et l'écart en longitude divergerait :
 * la boîte est alors élargie à tout le tour de la Terre, le filtre Haversine
 * se chargeant de trancher. Le cas ne se présente pas en France, mais une
 * fonction géométrique n'a pas à produire des bornes absurdes hors de son
 * domaine d'usage.
 */
export function boundingBox(center: LatLon, radiusM: number): BoundingBox {
  const dLat = radiusM / METERS_PER_DEGREE_LAT;
  const minLat = Math.max(-90, center.latitude - dLat);
  const maxLat = Math.min(90, center.latitude + dLat);

  const cos = Math.cos(toRad(center.latitude));
  if (cos < 1e-9) {
    return { minLat, maxLat, minLon: -180, maxLon: 180 };
  }

  const dLon = radiusM / (METERS_PER_DEGREE_LAT * cos);
  if (dLon >= 180) {
    return { minLat, maxLat, minLon: -180, maxLon: 180 };
  }

  return {
    minLat,
    maxLat,
    minLon: center.longitude - dLon,
    maxLon: center.longitude + dLon,
  };
}

/** true si le point tombe dans la boîte (test rectangulaire, pas circulaire). */
export function isInBoundingBox(point: LatLon, box: BoundingBox): boolean {
  return (
    point.latitude >= box.minLat &&
    point.latitude <= box.maxLat &&
    point.longitude >= box.minLon &&
    point.longitude <= box.maxLon
  );
}

/** true si le point est réellement dans le disque. */
export function isWithinRadius(
  point: LatLon,
  center: LatLon,
  radiusM: number
): boolean {
  return haversineMeters(center, point) <= radiusM;
}

/** Coordonnées plausibles — garde-fou d'entrée avant toute requête. */
export function isValidLatLon(point: LatLon): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}
