/**
 * Géocodage d'adresses françaises via la Base Adresse Nationale.
 *
 * `api-adresse.data.gouv.fr` est gratuite, sans clé, et de la même famille que
 * DVF — les codes INSEE renvoyés se rapprochent donc directement du référentiel
 * de ventes, sans table de correspondance.
 *
 * Le géocodage est fait **une fois**, à la saisie du bien, et le résultat
 * conservé dans `RealEstateDetail`. Une adresse ne bouge pas : refaire l'appel
 * à chaque estimation ajouterait de la latence et une dépendance réseau à un
 * calcul qui n'en a pas besoin.
 */

const BAN_URL = "https://api-adresse.data.gouv.fr/search/";

/** Score BAN en deçà duquel le rapprochement n'est pas assez sûr. */
export const MIN_GEOCODE_SCORE = 0.5;

export type GeocodeResult = {
  latitude: number;
  longitude: number;
  /** Adresse normalisée telle que la BAN la reconnaît. */
  label: string;
  postalCode: string | null;
  city: string | null;
  inseeCode: string | null;
  /** Confiance BAN, entre 0 et 1. */
  score: number;
};

export type GeocodeOutcome =
  | { kind: "ok"; result: GeocodeResult }
  | { kind: "not-found" }
  | { kind: "low-confidence"; best: GeocodeResult }
  | { kind: "unavailable"; error: string };

/** Réponse BAN — seuls les champs exploités sont typés. */
type BanFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    label?: string;
    score?: number;
    postcode?: string;
    city?: string;
    citycode?: string;
  };
};

/**
 * Assemble une requête à partir des champs saisis.
 * La BAN accepte une chaîne libre ; y joindre le code postal et la ville lève
 * la plupart des ambiguïtés de nom de rue entre communes.
 */
export function buildGeocodeQuery(input: {
  addressLine?: string | null;
  postalCode?: string | null;
  city?: string | null;
}): string {
  return [input.addressLine, input.postalCode, input.city]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function toResult(feature: BanFeature): GeocodeResult | null {
  const coords = feature.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  // La BAN, comme GeoJSON, ordonne [longitude, latitude] — l'inverse de la
  // convention usuelle. Les intervertir placerait les biens français au large
  // de la Somalie sans qu'aucune validation ne s'en aperçoive.
  const [longitude, latitude] = coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const p = feature.properties ?? {};
  return {
    latitude,
    longitude,
    label: p.label ?? "",
    postalCode: p.postcode ?? null,
    city: p.city ?? null,
    inseeCode: p.citycode ?? null,
    score: typeof p.score === "number" ? p.score : 0,
  };
}

/**
 * Géocode une adresse.
 *
 * Les issues sont distinguées parce qu'elles appellent des réactions
 * différentes : une adresse introuvable demande une correction de saisie, un
 * score faible mérite une confirmation, et une API injoignable ne doit surtout
 * pas être présentée comme une adresse invalide.
 */
export async function geocodeAddress(
  input: {
    addressLine?: string | null;
    postalCode?: string | null;
    city?: string | null;
  },
  opts?: { signal?: AbortSignal }
): Promise<GeocodeOutcome> {
  const query = buildGeocodeQuery(input);
  if (query.length < 3) {
    return { kind: "not-found" };
  }

  const url = new URL(BAN_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  // `autocomplete=0` : on cherche une adresse complète, pas une suggestion de
  // saisie — la BAN renvoie alors des scores plus honnêtes.
  url.searchParams.set("autocomplete", "0");
  if (input.postalCode?.trim()) {
    url.searchParams.set("postcode", input.postalCode.trim());
  }

  let payload: { features?: BanFeature[] };
  try {
    const res = await fetch(url.toString(), {
      cache: "no-store",
      signal: opts?.signal ?? AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return { kind: "unavailable", error: `BAN HTTP ${res.status}` };
    }
    payload = (await res.json()) as { features?: BanFeature[] };
  } catch (e) {
    return {
      kind: "unavailable",
      error: e instanceof Error ? e.message : "Géocodage indisponible",
    };
  }

  const feature = payload.features?.[0];
  if (!feature) return { kind: "not-found" };

  const result = toResult(feature);
  if (!result) return { kind: "not-found" };

  if (result.score < MIN_GEOCODE_SCORE) {
    return { kind: "low-confidence", best: result };
  }
  return { kind: "ok", result };
}

/** Département déduit d'un code INSEE ou postal (Corse et outre-mer inclus). */
export function departmentFromCode(
  code: string | null | undefined
): string | null {
  const c = (code ?? "").trim();
  // Cinq caractères : un chiffre, puis un chiffre ou A/B (Corse), puis trois
  // chiffres. Couvre « 13202 », « 2A004 » et « 97411 » d'une seule règle.
  if (!/^\d[0-9AB]\d{3}$/i.test(c)) return null;
  // Corse : 2A / 2B, codés « 2A0xx » / « 2B0xx » en INSEE et « 20xxx » en postal.
  const head = c.slice(0, 2).toUpperCase();
  if (head === "2A" || head === "2B") return head;
  // Outre-mer : départements à trois chiffres (971 → 976).
  if (head === "97" || head === "98") return c.slice(0, 3);
  return head;
}
