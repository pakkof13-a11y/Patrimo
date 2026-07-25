/**
 * Agrégation des lignes DVF en ventes exploitables.
 *
 * Les fichiers DVF géolocalisés d'Etalab décrivent **un lot par ligne**, pas
 * une vente par ligne. Une maison vendue avec son garage et son terrain occupe
 * trois lignes qui partagent le même `id_mutation` et **répètent** la même
 * `valeur_fonciere`. Deux erreurs guettent :
 *
 * - traiter chaque ligne comme une vente → la même transaction pèse trois fois
 *   dans les comparables, et un immeuble de 30 lots en pèserait trente ;
 * - sommer les `valeur_fonciere` d'une mutation → un bien à 300 k€ en vaut 900.
 *
 * `valeur_fonciere` étant le prix de la mutation entière, le prix au m² ne se
 * calcule qu'à ce niveau : valeur ÷ surface bâtie cumulée des locaux
 * d'habitation. Ce module fait ce regroupement une fois pour toutes, à
 * l'import, pour que la requête d'estimation n'ait plus à s'en soucier.
 *
 * Module volontairement pur : ni Prisma, ni réseau, ni fichier. Il transforme
 * des lignes déjà lues en candidats à l'insertion.
 */

import { d, toFixed, type Decimal } from "../money/decimal";

/** Ligne DVF brute, colonnes utiles uniquement, encore sous forme de texte. */
export type DvfRawRow = {
  id_mutation: string;
  date_mutation: string;
  nature_mutation: string;
  valeur_fonciere: string;
  code_postal: string;
  code_commune: string;
  nom_commune: string;
  code_departement: string;
  code_type_local: string;
  type_local: string;
  surface_reelle_bati: string;
  nombre_pieces_principales: string;
  surface_terrain: string;
  longitude: string;
  latitude: string;
};

/** Colonnes exigées dans l'en-tête du CSV source. */
export const DVF_REQUIRED_COLUMNS: readonly (keyof DvfRawRow)[] = [
  "id_mutation",
  "date_mutation",
  "nature_mutation",
  "valeur_fonciere",
  "code_postal",
  "code_commune",
  "nom_commune",
  "code_departement",
  "code_type_local",
  "type_local",
  "surface_reelle_bati",
  "nombre_pieces_principales",
  "surface_terrain",
  "longitude",
  "latitude",
];

export type PropertyType = "MAISON" | "APPARTEMENT";

export type AggregatedSale = {
  mutationId: string;
  soldOn: Date;
  propertyType: PropertyType;
  valueEur: string;
  builtAreaM2: number;
  rooms: number;
  landAreaM2: number | null;
  pricePerM2: string;
  latitude: number;
  longitude: number;
  postalCode: string | null;
  inseeCode: string;
  communeName: string;
  department: string;
  hasDependency: boolean;
  sourceRows: number;
};

/**
 * Motifs de rejet — comptés et rendus à l'appelant. Un import qui écarte 40 %
 * de ses lignes doit pouvoir dire pourquoi, sinon on ne sait pas distinguer un
 * filtrage sain d'un mapping de colonnes cassé.
 */
export type RejectReason =
  | "nature_non_vente"
  | "aucun_local_habitation"
  | "types_melanges"
  | "surface_absente"
  | "valeur_absente"
  | "coordonnees_absentes"
  | "prix_m2_aberrant"
  | "date_invalide";

export type AggregateResult = {
  sales: AggregatedSale[];
  rejected: Record<RejectReason, number>;
};

/**
 * `code_type_local` DVF : 1 maison, 2 appartement, 3 dépendance,
 * 4 local industriel/commercial.
 */
const TYPE_MAISON = "1";
const TYPE_APPARTEMENT = "2";
const TYPE_DEPENDANCE = "3";

/**
 * Bornes de vraisemblance du prix au m².
 *
 * DVF contient des ventes à 1 € (transmissions familiales, cessions
 * symboliques entre collectivités) et des erreurs de saisie. Les laisser
 * entrer ne déplacerait pas la médiane — elle y est insensible — mais
 * élargirait artificiellement la fourchette interquartile, donc afficherait une
 * incertitude qui n'existe pas.
 */
export const MIN_PRICE_PER_M2 = 100;
export const MAX_PRICE_PER_M2 = 50_000;

function emptyRejects(): Record<RejectReason, number> {
  return {
    nature_non_vente: 0,
    aucun_local_habitation: 0,
    types_melanges: 0,
    surface_absente: 0,
    valeur_absente: 0,
    coordonnees_absentes: 0,
    prix_m2_aberrant: 0,
    date_invalide: 0,
  };
}

/** Nombre décimal DVF (point décimal, champ éventuellement vide). */
export function parseDvfNumber(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * `nature_mutation` retenue : les ventes ordinaires seulement.
 *
 * Adjudications, expropriations et échanges se forment sur des prix qui ne
 * reflètent pas le marché ; les inclure biaiserait l'estimation vers le bas
 * sans qu'on puisse le voir dans le résultat.
 */
export function isRetainedNature(nature: string): boolean {
  const n = nature.trim().toLowerCase();
  return n === "vente" || n === "vente en l'état futur d'achèvement";
}

function propertyTypeOf(codeTypeLocal: string): PropertyType | null {
  const code = codeTypeLocal.trim();
  if (code === TYPE_MAISON) return "MAISON";
  if (code === TYPE_APPARTEMENT) return "APPARTEMENT";
  return null;
}

/** Date DVF `YYYY-MM-DD` → Date UTC à midi (ancrage stable, sans dérive de fuseau). */
export function parseDvfDate(raw: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const date = new Date(
    Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Regroupe les lignes d'une même mutation et produit au plus une vente par
 * type de bien.
 *
 * Une mutation mêlant maison et appartement (vente d'un immeuble mixte) est
 * rejetée : la valeur foncière est globale et rien ne permet de l'attribuer
 * entre les deux types, donc tout prix au m² qu'on en tirerait serait inventé.
 */
export function aggregateMutation(
  rows: DvfRawRow[],
  rejected: Record<RejectReason, number>
): AggregatedSale | null {
  if (rows.length === 0) return null;
  const first = rows[0]!;

  if (!isRetainedNature(first.nature_mutation)) {
    rejected.nature_non_vente++;
    return null;
  }

  const soldOn = parseDvfDate(first.date_mutation);
  if (!soldOn) {
    rejected.date_invalide++;
    return null;
  }

  const value = parseDvfNumber(first.valeur_fonciere);
  if (value == null || value <= 0) {
    rejected.valeur_absente++;
    return null;
  }

  const habitables = rows.filter((r) => propertyTypeOf(r.code_type_local) != null);
  if (habitables.length === 0) {
    rejected.aucun_local_habitation++;
    return null;
  }

  const types = new Set(habitables.map((r) => propertyTypeOf(r.code_type_local)!));
  if (types.size > 1) {
    rejected.types_melanges++;
    return null;
  }
  const propertyType = [...types][0]!;

  // Surface et pièces sur les seuls locaux d'habitation : compter le garage
  // gonflerait la surface et écraserait mécaniquement le prix au m².
  let builtAreaM2 = 0;
  let rooms = 0;
  for (const r of habitables) {
    builtAreaM2 += parseDvfNumber(r.surface_reelle_bati) ?? 0;
    rooms += parseDvfNumber(r.nombre_pieces_principales) ?? 0;
  }
  if (builtAreaM2 <= 0) {
    rejected.surface_absente++;
    return null;
  }

  // Coordonnées : la première ligne géolocalisée de la mutation fait foi.
  const located = rows.find(
    (r) =>
      parseDvfNumber(r.latitude) != null && parseDvfNumber(r.longitude) != null
  );
  const latitude = located ? parseDvfNumber(located.latitude) : null;
  const longitude = located ? parseDvfNumber(located.longitude) : null;
  if (latitude == null || longitude == null) {
    rejected.coordonnees_absentes++;
    return null;
  }

  const pricePerM2: Decimal = d(value).div(builtAreaM2);
  const ppm2 = pricePerM2.toNumber();
  if (ppm2 < MIN_PRICE_PER_M2 || ppm2 > MAX_PRICE_PER_M2) {
    rejected.prix_m2_aberrant++;
    return null;
  }

  // Terrain : somme sur toutes les lignes de la mutation (les parcelles nues
  // portent la surface de terrain, pas les locaux).
  let landAreaM2 = 0;
  for (const r of rows) landAreaM2 += parseDvfNumber(r.surface_terrain) ?? 0;

  const hasDependency = rows.some(
    (r) => r.code_type_local.trim() === TYPE_DEPENDANCE
  );

  return {
    mutationId: first.id_mutation.trim(),
    soldOn,
    propertyType,
    valueEur: toFixed(d(value), 2),
    builtAreaM2: Math.round(builtAreaM2),
    rooms: Math.round(rooms),
    landAreaM2: landAreaM2 > 0 ? Math.round(landAreaM2) : null,
    pricePerM2: toFixed(pricePerM2, 2),
    latitude,
    longitude,
    postalCode: first.code_postal.trim() || null,
    inseeCode: first.code_commune.trim(),
    communeName: first.nom_commune.trim(),
    department: first.code_departement.trim(),
    hasDependency,
    sourceRows: rows.length,
  };
}

/**
 * Agrège un lot de lignes DVF, quelles que soient leur ordre et leur mutation.
 *
 * Prévu pour un import en flux : l'appelant accumule les lignes d'un même
 * `id_mutation` (elles sont contiguës dans les fichiers Etalab) et vide le
 * tampon à chaque changement, plutôt que de charger le département entier.
 */
export function aggregateRows(rows: DvfRawRow[]): AggregateResult {
  const rejected = emptyRejects();
  const byMutation = new Map<string, DvfRawRow[]>();
  for (const row of rows) {
    const key = row.id_mutation.trim();
    if (!key) continue;
    const bucket = byMutation.get(key);
    if (bucket) bucket.push(row);
    else byMutation.set(key, [row]);
  }

  const sales: AggregatedSale[] = [];
  for (const group of byMutation.values()) {
    const sale = aggregateMutation(group, rejected);
    if (sale) sales.push(sale);
  }
  return { sales, rejected };
}

/** Colonnes requises absentes d'un en-tête — vide si l'en-tête convient. */
export function missingDvfColumns(headers: string[]): string[] {
  const present = new Set(headers.map((h) => h.trim().toLowerCase()));
  return DVF_REQUIRED_COLUMNS.filter((c) => !present.has(c)).map(String);
}
