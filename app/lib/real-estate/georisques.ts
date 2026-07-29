/**
 * Risques naturels via l'API Géorisques (géorisques.gouv.fr / MTECT), croisés
 * avec les coordonnées géocodées du bien.
 *
 * Même esprit que `geocode.ts` : une API publique, gratuite, sans clé,
 * appelée une fois à la saisie et dont le résultat est conservé — les
 * zonages de risque ne bougent pas d'un jour à l'autre, réinterroger à
 * chaque affichage ajouterait de la latence sans rien apprendre.
 *
 * ## Échelle unifiée
 *
 * Le rapport Géorisques mélange plusieurs nomenclatures officielles :
 * zonage sismique en 5 zones numérotées, potentiel radon en 3 catégories,
 * aléa argiles en qualificatifs texte. `mapRiskReport` les ramène toutes à
 * `RiskLevel` (`AUCUN` | `FAIBLE` | `MOYEN` | `FORT`, voir `constants.ts`)
 * pour qu'un badge unique s'affiche pareil quel que soit le risque — le
 * détail exact reste dans les libellés Géorisques d'origine, pas reproduit
 * ici.
 *
 * ## Schéma de réponse
 *
 * Le mapping ci-dessous sonde plusieurs chemins plausibles pour chaque champ
 * (`camelCase` et `snake_case`, variantes de nommage documentées côté
 * Géorisques). Un champ qui ne correspond à aucun chemin connu reste à
 * `null` plutôt que de lever une erreur : mieux vaut un badge manquant qu'un
 * badge faux. **À vérifier contre `georisques.gouv.fr/doc-api` avant mise en
 * production** — cette correspondance a été écrite sans accès réseau sortant
 * vers l'API pour la valider en direct.
 *
 * Module d'accès réseau, mais mapping pur et testable séparément
 * (`mapRiskReport`) — même découpage que `toResult` dans `geocode.ts`.
 */

import { prisma } from "../prisma";
import type { RiskLevel } from "./constants";

const GEORISQUES_URL =
  "https://georisques.gouv.fr/api/v1/resultats_rapport_risque";

/** Rayon de recherche du rapport, en mètres — resserré : le zonage est local. */
const REPORT_RADIUS_M = 500;

export type GeorisquesRisks = {
  flood: RiskLevel | null;
  seismic: RiskLevel | null;
  radon: RiskLevel | null;
  claySoil: RiskLevel | null;
};

export type GeorisquesOutcome =
  | { kind: "ok"; risks: GeorisquesRisks }
  | { kind: "unavailable"; error: string };

/** Accès défensif à un objet de forme inconnue — jamais de `any`. */
function asRecord(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

/** Première valeur définie parmi plusieurs chemins plausibles dans un JSON inconnu. */
function firstDefined(...values: unknown[]): unknown {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function asText(value: unknown): string {
  return String(value ?? "").trim();
}

/**
 * Zonage sismique officiel (5 zones, décret n° 2010-1255) → échelle unifiée.
 *
 * Zone 5 n'existe qu'aux Antilles ; la France métropolitaine plafonne à la
 * zone 4. Le report sur 4 niveaux perd la distinction 1/2 (très faible /
 * faible) — acceptable pour un badge de synthèse, pas pour un dossier
 * réglementaire.
 */
function mapSeismicZone(raw: unknown): RiskLevel | null {
  const zone = asText(raw).match(/[1-5]/)?.[0];
  switch (zone) {
    case "1":
      return "AUCUN";
    case "2":
      return "FAIBLE";
    case "3":
    case "4":
      return "MOYEN";
    case "5":
      return "FORT";
    default:
      return null;
  }
}

/** Potentiel radon officiel (3 catégories) → échelle unifiée. */
function mapRadonPotential(raw: unknown): RiskLevel | null {
  const category = asText(raw).match(/[1-3]/)?.[0];
  switch (category) {
    case "1":
      return "FAIBLE";
    case "2":
      return "MOYEN";
    case "3":
      return "FORT";
    default:
      return null;
  }
}

/**
 * Aléa qualitatif texte (inondation, argiles) → échelle unifiée.
 *
 * Les libellés officiels varient d'une source à l'autre (« Fort », « Fort à
 * très fort », « A priori nul », « Non exposé »…) : une correspondance par
 * mot-clé absorbe ces variantes sans avoir à en lister chaque forme exacte.
 */
function mapQualitativeLevel(raw: unknown): RiskLevel | null {
  const text = asText(raw).toLowerCase();
  if (!text) return null;
  if (/nul|non\s*expos|aucun/.test(text)) return "AUCUN";
  if (/fort/.test(text)) return "FORT";
  if (/moyen/.test(text)) return "MOYEN";
  if (/faible/.test(text)) return "FAIBLE";
  return null;
}

/**
 * Extrait les quatre risques d'une réponse Géorisques de forme inconnue.
 *
 * Exportée séparément du réseau pour être testée sur des fixtures, sans appel
 * HTTP — même raison que `toResult` dans `geocode.ts`.
 */
export function mapRiskReport(raw: unknown): GeorisquesRisks {
  const r = asRecord(raw);

  const sismicite = asRecord(r.sismicite);
  const seismicRaw = firstDefined(
    sismicite.zonageSismique,
    sismicite.zonage_sismique,
    sismicite.zone,
    r.zonageSismique
  );

  const radon = asRecord(r.radon);
  const radonRaw = firstDefined(
    radon.classePotentiel,
    radon.classe_potentiel,
    radon.potentielRadon,
    radon.categorie,
    r.potentielRadon
  );

  const inondation = asRecord(r.inondation);
  const zonageInondation = asRecord(r.zonageInondation);
  const floodRaw = firstDefined(
    inondation.alea,
    inondation.expositionAlea,
    inondation.niveauAlea,
    zonageInondation.alea,
    r.risqueInondation
  );

  const argiles = asRecord(r.argiles);
  const retraitGonflementArgiles = asRecord(r.retraitGonflementArgiles);
  const claySoilRaw = firstDefined(
    argiles.expositionAlea,
    argiles.alea,
    argiles.niveauAlea,
    retraitGonflementArgiles.alea
  );

  return {
    seismic: mapSeismicZone(seismicRaw),
    radon: mapRadonPotential(radonRaw),
    flood: mapQualitativeLevel(floodRaw),
    claySoil: mapQualitativeLevel(claySoilRaw),
  };
}

/**
 * Interroge Géorisques pour un point donné.
 *
 * Ne lève jamais : toute erreur réseau, HTTP ou de parsing devient
 * `{ kind: "unavailable" }`. L'appelant (fetch en tâche de fond après la
 * création d'un bien) doit pouvoir échouer sans que la sauvegarde du bien
 * en dépende.
 */
export async function fetchGeorisquesRisks(
  point: { latitude: number; longitude: number },
  opts?: { signal?: AbortSignal }
): Promise<GeorisquesOutcome> {
  const url = new URL(GEORISQUES_URL);
  url.searchParams.set("latlon", `${point.longitude},${point.latitude}`);
  url.searchParams.set("rayon", String(REPORT_RADIUS_M));

  try {
    const res = await fetch(url.toString(), {
      cache: "no-store",
      signal: opts?.signal ?? AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { kind: "unavailable", error: `Géorisques HTTP ${res.status}` };
    }
    const payload: unknown = await res.json();
    return { kind: "ok", risks: mapRiskReport(payload) };
  } catch (e) {
    return {
      kind: "unavailable",
      error: e instanceof Error ? e.message : "Géorisques indisponible",
    };
  }
}

/**
 * Interroge Géorisques puis persiste le résultat sur le bien — appelée en
 * tâche de fond (`after()`) depuis la route de création, jamais dans le
 * chemin de la réponse HTTP.
 *
 * Conçue pour ne jamais rejeter : un échec réseau ou une mise à jour
 * impossible (bien supprimé entre-temps, par exemple) est seulement journalisé.
 * Sauvegarder un bien ne doit jamais dépendre de la disponibilité de cette
 * API tierce — c'est un enrichissement, pas une donnée constitutive du bien.
 */
export async function refreshGeorisquesRisks(
  assetId: string,
  point: { latitude: number; longitude: number }
): Promise<void> {
  try {
    const outcome = await fetchGeorisquesRisks(point);
    if (outcome.kind !== "ok") {
      console.warn(
        `[georisques] échec pour ${assetId} : ${outcome.error} — bien conservé sans risques`
      );
      return;
    }
    await prisma.realEstateDetail.update({
      where: { assetId },
      data: {
        riskFlood: outcome.risks.flood,
        riskSeismic: outcome.risks.seismic,
        riskRadon: outcome.risks.radon,
        riskClaySoil: outcome.risks.claySoil,
        georisquesFetched: true,
      },
    });
  } catch (e) {
    console.error(`[georisques] mise à jour impossible pour ${assetId} :`, e);
  }
}
