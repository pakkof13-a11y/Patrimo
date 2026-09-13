/**
 * Correction des données d'exploitation d'un bien : loyer, charges, adresse.
 *
 * Ces trois champs se saisissent à la création puis n'étaient plus modifiables
 * nulle part : un loyer révisé, une provision de charges ajustée ou une adresse
 * mal recopiée restaient figés à vie, alors qu'ils alimentent le rendement, le
 * cash-flow et la déclaration des revenus fonciers.
 *
 * ## Une adresse n'est pas une chaîne de caractères
 *
 * Trois données en sont **dérivées** et ne valent que pour l'adresse qui les a
 * produites : les coordonnées (`latitude`/`longitude`/`inseeCode`), qui servent
 * à chercher les ventes DVF comparables, et les risques Géorisques, qui sont
 * ceux d'un point sur une carte.
 *
 * `ensureGeocoded` ne regéocode **que** si les coordonnées sont nulles
 * (`valuation.ts`). Réécrire l'adresse sans les effacer ferait donc estimer
 * indéfiniment le bien sur son ancien quartier : la valeur affichée serait
 * celle d'un autre logement, sans que rien ne le signale. Corriger une adresse
 * efface donc ce qui en descend — « inconnu » se recalcule, « faux » non.
 *
 * Module **pur** : ni Prisma, ni réseau. Il décide de ce qui doit être écrit ;
 * la route écrit.
 */

import { d } from "../money/decimal";

/**
 * Saisie refusée.
 *
 * Classe locale plutôt que le `RealEstateInputError` de `property-service` :
 * celui-ci vit dans un module qui importe Prisma, et ce planificateur doit
 * rester testable sans base. La route traduit les deux en 400.
 */
export class PropertyUpdateError extends Error {}

/** Champs acceptés — strictement loyer, charges et adresse. */
export type PropertyUpdateInput = {
  addressLine?: string | null;
  postalCode?: string | null;
  city?: string | null;
  /**
   * Coordonnées issues d'une sélection d'adresse (BAN), jamais saisies à la
   * main : elles accompagnent la nouvelle adresse et évitent le géocodage
   * différé. Fournir l'une sans l'autre est une erreur.
   */
  inseeCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  monthlyRentEur?: string | null;
  monthlyChargesEur?: string | null;
};

/** L'adresse actuellement enregistrée, pour détecter un vrai changement. */
export type PropertyAddressState = {
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
};

/** Ce que la route doit écrire, et ce qu'elle doit déclencher ensuite. */
export type PropertyUpdatePlan = {
  /** Patch Prisma — ne contient que les champs réellement touchés. */
  data: Record<string, unknown>;
  /**
   * Point à interroger auprès de Géorisques **après** la réponse, quand une
   * nouvelle adresse arrive avec ses coordonnées. `null` sinon.
   */
  georisquesPoint: { latitude: number; longitude: number } | null;
  /** Vrai si l'adresse enregistrée diffère de celle transmise. */
  addressChanged: boolean;
};

/** Chaîne saisie → valeur stockable : une chaîne vide vaut « non renseigné ». */
function normalizeText(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Montant mensuel → chaîne décimale à 2 décimales (l'échelle de la colonne).
 *
 * Un montant négatif est refusé plutôt que stocké : un loyer négatif remonterait
 * tel quel dans le rendement, le cash-flow et les revenus fonciers déclarés.
 */
function normalizeAmount(
  raw: string | null | undefined,
  label: string
): string | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim().replace(",", ".");
  if (trimmed === "") return null;

  let value: ReturnType<typeof d>;
  try {
    value = d(trimmed);
  } catch {
    throw new PropertyUpdateError(`${label} : montant invalide`);
  }
  if (!value.isFinite()) {
    throw new PropertyUpdateError(`${label} : montant invalide`);
  }
  if (value.lt(0)) {
    throw new PropertyUpdateError(`${label} ne peut pas être négatif`);
  }
  return value.toFixed(2);
}

/**
 * Traduit une demande de modification en écriture.
 *
 * Seules les clés **présentes** dans `input` sont touchées : un PATCH qui
 * n'envoie que le loyer ne doit pas effacer l'adresse. `undefined` = « ne pas
 * toucher », `null` = « effacer » — la distinction est portée par la présence
 * de la clé, pas par sa valeur.
 */
export function planPropertyUpdate(
  current: PropertyAddressState,
  input: PropertyUpdateInput,
  now: Date = new Date()
): PropertyUpdatePlan {
  const data: Record<string, unknown> = {};

  if ("monthlyRentEur" in input) {
    data.monthlyRentEur = normalizeAmount(input.monthlyRentEur, "Le loyer mensuel");
  }
  if ("monthlyChargesEur" in input) {
    data.monthlyChargesEur = normalizeAmount(
      input.monthlyChargesEur,
      "Les charges mensuelles"
    );
  }

  // ── Adresse ──
  const addressKeys = ["addressLine", "postalCode", "city"] as const;
  let addressChanged = false;

  for (const key of addressKeys) {
    if (!(key in input)) continue;
    const next = normalizeText(input[key]);
    data[key] = next;
    if (next !== current[key]) addressChanged = true;
  }

  const hasLat = "latitude" in input && input.latitude != null;
  const hasLon = "longitude" in input && input.longitude != null;
  if (hasLat !== hasLon) {
    throw new PropertyUpdateError(
      "Coordonnées incomplètes : latitude et longitude vont ensemble"
    );
  }

  let georisquesPoint: { latitude: number; longitude: number } | null = null;

  if (hasLat && hasLon) {
    // Adresse re-sélectionnée dans la BAN : les coordonnées fournies font foi.
    const latitude = input.latitude as number;
    const longitude = input.longitude as number;
    data.latitude = latitude;
    data.longitude = longitude;
    data.geocodedAt = now;
    if ("inseeCode" in input) data.inseeCode = normalizeText(input.inseeCode);
    if (addressChanged) {
      // Les risques d'un point ne sont pas ceux d'un autre : on les remet à
      // « inconnu » et on relance la consultation en tâche de fond.
      Object.assign(data, unknownRisks());
      georisquesPoint = { latitude, longitude };
    }
  } else if (addressChanged) {
    // Adresse changée sans coordonnées : tout ce qui en dérive devient inconnu.
    // `ensureGeocoded` regéocodera à la prochaine estimation, précisément parce
    // que ces champs sont nuls.
    data.latitude = null;
    data.longitude = null;
    data.inseeCode = null;
    data.geocodedAt = null;
    Object.assign(data, unknownRisks());
  }

  return { data, georisquesPoint, addressChanged };
}

/**
 * Risques ramenés à « non consultés ».
 *
 * Les valeurs passent à `null` et non à un niveau faible : un risque inconnu
 * n'est pas un risque absent, et `georisquesFetched: false` est ce qui permet
 * à une consultation ultérieure de les renseigner à nouveau.
 */
function unknownRisks(): Record<string, unknown> {
  return {
    riskFlood: null,
    riskSeismic: null,
    riskRadon: null,
    riskClaySoil: null,
    georisquesFetched: false,
  };
}
