/**
 * Ajustement du prix au m² de marché aux caractéristiques du bien.
 *
 * La médiane DVF décrit **le bien moyen du secteur** : elle ne sait rien du
 * DPE, de l'étage ni de la vue du logement qu'on estime, parce que les fichiers
 * Etalab ne portent aucune de ces colonnes (cf. `dvf-scorer.ts`). Appliquée
 * telle quelle, elle valorise donc identiquement un rez-de-chaussée sur cour
 * classé G et un dernier étage avec vue mer classé B.
 *
 * Ce module corrige cet écart dans l'autre sens : il part du prix au m² du
 * marché et lui applique les écarts propres au bien. Chaque écart est rendu
 * dans un `breakdown` — un ajustement de −13 % qu'on ne peut pas justifier ligne
 * à ligne serait un chiffre d'autorité, exactement ce que le reste du module
 * immobilier refuse de produire.
 *
 * ## Composition multiplicative
 *
 * Les écarts se composent en produit, pas en somme. Trois raisons :
 * un empilement additif de décotes peut franchir −100 % et produire un prix
 * négatif ; chaque écart s'entend « toutes choses égales par ailleurs », donc
 * relativement au prix déjà corrigé ; et le résultat ne dépend pas de l'ordre
 * dans lequel les critères sont évalués.
 *
 * ## Plafonnement
 *
 * Le cumul est borné à ±25 %. Au-delà, la méthode par comparaison a cessé de
 * fonctionner : un bien qui s'écarte à ce point du marché local n'est plus
 * décrit par sa médiane, et prétendre le contraire afficherait une précision
 * qui n'existe pas. Le plafonnement est signalé plutôt que silencieux.
 *
 * ## Ce qui manque volontairement
 *
 * Les risques (inondation, retrait-gonflement des argiles, sites industriels)
 * pèsent réellement sur un prix, mais aucun champ ne les porte aujourd'hui :
 * les inventer par défaut reviendrait à décoter tous les biens d'un montant
 * arbitraire. Ils entreront quand une source (Géorisques) alimentera le
 * modèle, pas avant.
 *
 * Module volontairement pur : ni Prisma, ni réseau. Testable sans base.
 */

import { d, toFixed, type Decimal } from "../money/decimal";

/** Cumul maximal d'ajustement, en pourcentage, à la hausse comme à la baisse. */
export const MAX_TOTAL_ADJUSTMENT_PCT = 25;

/**
 * Écart de prix par étiquette DPE, en % du prix de marché.
 *
 * La référence est **D** : c'est l'étiquette la plus représentée dans le parc
 * français, donc celle que la médiane DVF décrit implicitement. Les écarts
 * suivent l'ordre de grandeur de la « valeur verte » observée par les notaires,
 * et se creusent sur F et G depuis que la location des passoires thermiques est
 * interdite (G au 1ᵉʳ janvier 2025, F au 1ᵉʳ janvier 2028) : la décote n'est
 * plus seulement une préférence d'acheteur, c'est un coût de travaux devenu
 * obligatoire pour louer.
 */
export const DPE_ADJUSTMENT_PCT: Record<string, number> = {
  A: 6,
  B: 4,
  C: 2,
  D: 0,
  E: -3,
  F: -8,
  G: -13,
};

/**
 * Écart résiduel par étiquette GES.
 *
 * Volontairement faible : le GES est très corrélé au DPE (même diagnostic,
 * même système de chauffage). Lui donner un poids comparable reviendrait à
 * compter deux fois la même passoire thermique.
 */
export const GES_ADJUSTMENT_PCT: Record<string, number> = {
  A: 1,
  B: 1,
  C: 0,
  D: 0,
  E: -1,
  F: -2,
  G: -3,
};

/** Écart par orientation principale, en %. */
export const ORIENTATION_ADJUSTMENT_PCT: Record<string, number> = {
  S: 3,
  SE: 2,
  SO: 2,
  E: 0,
  O: 0,
  NE: -2,
  NO: -2,
  N: -3,
};

/** Écart par type de vue, en %. */
export const VIEW_ADJUSTMENT_PCT: Record<string, number> = {
  MER: 12,
  MONTAGNE: 6,
  DEGAGEE: 4,
  PARC_JARDIN: 3,
  RUE: 0,
  AUCUNE: 0,
  VIS_A_VIS: -4,
};

/** Écart par qualité de vitrage, en %. */
export const WINDOW_ADJUSTMENT_PCT: Record<string, number> = {
  SIMPLE_VITRAGE: -2,
  DOUBLE_VITRAGE: 0,
  TRIPLE_VITRAGE: 1,
};

/** Charges de copropriété au m² au-delà desquelles le prix décroche. */
export const HEAVY_CHARGES_EUR_M2 = 50;
export const MODERATE_CHARGES_EUR_M2 = 35;

export type Adjustment = {
  code: string;
  /** Libellé français, affichable tel quel. */
  label: string;
  /** Écart appliqué, en % du prix au m². */
  pct: number;
};

/**
 * Caractéristiques du bien à estimer.
 *
 * Tous les champs sont optionnels : ils le sont aussi en base, et un bien
 * décrit à moitié doit produire un ajustement partiel plutôt qu'une erreur.
 * Un champ absent ne vaut jamais « valeur par défaut défavorable » — il ne
 * produit simplement aucune ligne de breakdown.
 */
export type AdjustmentSubject = {
  propertyType?: string | null;
  livingAreaM2?: number | null;
  energyRating?: string | null;
  gesRating?: string | null;
  orientation?: string | null;
  viewType?: string | null;
  windowQuality?: string | null;
  floor?: number | null;
  totalFloors?: number | null;
  hasElevator?: boolean | null;
  hasBalcony?: boolean | null;
  balconyAreaM2?: number | null;
  hasGarden?: boolean | null;
  gardenAreaM2?: number | null;
  hasCellar?: boolean | null;
  parkingSpots?: number | null;
  isCopropriete?: boolean | null;
  annualCoproChargesEur?: string | number | null;
};

export type AdjustmentResult = {
  /** Prix au m² de marché, avant ajustement. */
  basePricePerM2: string;
  adjustedPricePerM2: string;
  /** Écart total effectivement appliqué, en % (après plafonnement). */
  totalPct: number;
  /** Écart cumulé avant plafonnement — égal à `totalPct` si non plafonné. */
  rawTotalPct: number;
  breakdown: Adjustment[];
  /** true si le cumul a dû être ramené dans les bornes. */
  clamped: boolean;
};

/** Facteur multiplicatif → écart en %, arrondi au dixième pour l'affichage. */
function factorToPct(factor: Decimal): number {
  return Number(toFixed(factor.minus(1).times(100), 1));
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/**
 * Ajustements liés à l'étage — appartements uniquement.
 *
 * L'étage ne veut rien dire pour une maison, et le « rez-de-chaussée » d'un
 * pavillon n'a aucune des contraintes (bruit, vis-à-vis, effraction) qui
 * décotent un rez-de-chaussée en immeuble.
 */
function floorAdjustments(subject: AdjustmentSubject): Adjustment[] {
  if (subject.propertyType !== "APPARTEMENT") return [];
  const out: Adjustment[] = [];
  const floor = subject.floor;
  if (floor == null) return out;

  if (floor <= 0) {
    out.push({
      code: "FLOOR_GROUND",
      label: floor < 0 ? "Sous-sol" : "Rez-de-chaussée",
      pct: floor < 0 ? -8 : -5,
    });
    return out;
  }

  // Sans ascenseur, chaque étage au-dessus du deuxième rétrécit le marché des
  // acheteurs — et l'exclut entièrement pour une partie d'entre eux.
  if (subject.hasElevator !== true && floor >= 3) {
    out.push({
      code: "FLOOR_NO_ELEVATOR",
      label: `${floor}ᵉ étage sans ascenseur`,
      pct: Math.max(-8, -2 * (floor - 2)),
    });
    return out;
  }

  // Dernier étage desservi : lumière et absence de voisin au-dessus.
  if (
    subject.hasElevator === true &&
    subject.totalFloors != null &&
    subject.totalFloors > 0 &&
    floor >= subject.totalFloors
  ) {
    out.push({ code: "FLOOR_TOP", label: "Dernier étage avec ascenseur", pct: 3 });
  }
  return out;
}

/** Ajustements liés aux annexes et équipements. */
function amenityAdjustments(subject: AdjustmentSubject): Adjustment[] {
  const out: Adjustment[] = [];
  const isFlat = subject.propertyType === "APPARTEMENT";

  if (subject.hasBalcony === true) {
    const area = subject.balconyAreaM2 ?? 0;
    out.push({
      code: "BALCONY",
      label: area > 10 ? `Balcon / terrasse de ${area} m²` : "Balcon",
      pct: area > 10 ? 3 : 2,
    });
  }

  // Un jardin privatif est rare et cher en appartement ; pour une maison il est
  // attendu, et sa surface est déjà comparée entre ventes par le scorer.
  if (subject.hasGarden === true && isFlat) {
    out.push({ code: "GARDEN_FLAT", label: "Jardin privatif", pct: 4 });
  }

  if (subject.hasCellar === true) {
    out.push({ code: "CELLAR", label: "Cave", pct: 1 });
  }

  const spots = subject.parkingSpots ?? 0;
  if (spots > 0) {
    out.push({
      code: "PARKING",
      label: spots > 1 ? `${spots} places de stationnement` : "Place de stationnement",
      pct: Math.min(5, 3 * spots),
    });
  }

  return out;
}

/**
 * Décote liée aux charges de copropriété.
 *
 * Rapportées au m² : 2 400 €/an ne se lisent pas pareil sur 40 m² et sur
 * 120 m². Des charges lourdes se paient à l'achat, parce que l'acquéreur les
 * intègre à sa mensualité.
 */
function chargesAdjustment(subject: AdjustmentSubject): Adjustment[] {
  if (subject.isCopropriete !== true) return [];
  const charges = num(subject.annualCoproChargesEur);
  const area = subject.livingAreaM2;
  if (charges == null || charges <= 0 || area == null || area <= 0) return [];

  const perM2 = charges / area;
  if (perM2 > HEAVY_CHARGES_EUR_M2) {
    return [
      {
        code: "CHARGES_HEAVY",
        label: `Charges élevées (${Math.round(perM2)} €/m²/an)`,
        pct: -3,
      },
    ];
  }
  if (perM2 > MODERATE_CHARGES_EUR_M2) {
    return [
      {
        code: "CHARGES_MODERATE",
        label: `Charges au-dessus de la moyenne (${Math.round(perM2)} €/m²/an)`,
        pct: -1.5,
      },
    ];
  }
  return [];
}

/** Liste ordonnée des écarts applicables au bien, sans les composer. */
export function buildAdjustments(subject: AdjustmentSubject): Adjustment[] {
  const out: Adjustment[] = [];

  const dpe = subject.energyRating?.trim().toUpperCase();
  if (dpe && dpe in DPE_ADJUSTMENT_PCT && DPE_ADJUSTMENT_PCT[dpe] !== 0) {
    out.push({ code: "DPE", label: `DPE ${dpe}`, pct: DPE_ADJUSTMENT_PCT[dpe]! });
  }

  const ges = subject.gesRating?.trim().toUpperCase();
  if (ges && ges in GES_ADJUSTMENT_PCT && GES_ADJUSTMENT_PCT[ges] !== 0) {
    out.push({ code: "GES", label: `GES ${ges}`, pct: GES_ADJUSTMENT_PCT[ges]! });
  }

  const orientation = subject.orientation?.trim().toUpperCase();
  if (
    orientation &&
    orientation in ORIENTATION_ADJUSTMENT_PCT &&
    ORIENTATION_ADJUSTMENT_PCT[orientation] !== 0
  ) {
    out.push({
      code: "ORIENTATION",
      label: `Orientation ${orientation}`,
      pct: ORIENTATION_ADJUSTMENT_PCT[orientation]!,
    });
  }

  const view = subject.viewType?.trim().toUpperCase();
  if (view && view in VIEW_ADJUSTMENT_PCT && VIEW_ADJUSTMENT_PCT[view] !== 0) {
    out.push({
      code: "VIEW",
      label: view === "VIS_A_VIS" ? "Vis-à-vis" : `Vue ${view.toLowerCase()}`,
      pct: VIEW_ADJUSTMENT_PCT[view]!,
    });
  }

  const windows = subject.windowQuality?.trim().toUpperCase();
  if (
    windows &&
    windows in WINDOW_ADJUSTMENT_PCT &&
    WINDOW_ADJUSTMENT_PCT[windows] !== 0
  ) {
    out.push({
      code: "WINDOWS",
      label: windows === "SIMPLE_VITRAGE" ? "Simple vitrage" : "Triple vitrage",
      pct: WINDOW_ADJUSTMENT_PCT[windows]!,
    });
  }

  out.push(...floorAdjustments(subject));
  out.push(...amenityAdjustments(subject));
  out.push(...chargesAdjustment(subject));

  return out;
}

/**
 * Applique les écarts propres au bien au prix au m² du marché.
 *
 * Renvoie systématiquement un résultat exploitable, y compris quand aucun
 * critère n'est renseigné : le prix ajusté vaut alors le prix de base et le
 * breakdown est vide. Un bien non décrit ne doit pas être pénalisé — il doit
 * simplement rester au niveau du marché.
 */
export function applyAdjustments(
  basePricePerM2: string | number,
  subject: AdjustmentSubject
): AdjustmentResult {
  const base = d(basePricePerM2);
  const breakdown = buildAdjustments(subject);

  // Composition en décimal, pas en `number` : ce facteur multiplie un prix, il
  // relève donc de la même règle que le reste du module monétaire. En binaire,
  // 0,87 × 0,95 vaut 0,8264999999999999… et une décote de −17,35 % s'afficherait
  // à −17,3 — un écart d'affichage produit par la représentation, pas par le
  // modèle.
  let factor = d(1);
  for (const a of breakdown) {
    factor = factor.times(d(1).plus(d(a.pct).div(100)));
  }

  const lo = d(1).minus(d(MAX_TOTAL_ADJUSTMENT_PCT).div(100));
  const hi = d(1).plus(d(MAX_TOTAL_ADJUSTMENT_PCT).div(100));
  const clampedFactor = factor.lt(lo) ? lo : factor.gt(hi) ? hi : factor;

  return {
    basePricePerM2: toFixed(base, 2),
    adjustedPricePerM2: toFixed(base.times(clampedFactor), 2),
    totalPct: factorToPct(clampedFactor),
    rawTotalPct: factorToPct(factor),
    breakdown,
    clamped: !clampedFactor.equals(factor),
  };
}
