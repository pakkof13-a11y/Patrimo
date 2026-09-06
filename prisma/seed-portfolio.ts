/**
 * Portfolio fictif multi-onglets pour un utilisateur (admin ou demo).
 * ~30 positions, ~100–120 transactions sur ~3 ans, cash, dettes, AV,
 * épargne salariale, alternatives (métaux, PE, crowdlending, tangibles).
 */
import { Prisma, PrismaClient } from "@/app/lib/prisma-client/client";

const D = (v: string | number) => new Prisma.Decimal(v);

/**
 * Instant de référence du réamorçage, figé une fois pour toutes.
 *
 * Les patrons historiques parcourent des années civiles entières, dont l'année
 * en cours qui n'est pas terminée : sans borne, ils dateraient des écritures
 * après aujourd'hui. La borne est lue ici, hors du bloc des patrons, et pour
 * deux raisons. La première est de laisser ce bloc entièrement déterministe —
 * aucune horloge, aucun tirage, c'est ce que ses tests vérifient. La seconde
 * est qu'un `Date.now()` appelé à chaque écriture avancerait pendant la
 * génération : deux patrons voisins n'auraient pas tout à fait le même
 * « aujourd'hui », et la frontière dépendrait de l'ordre d'exécution.
 */
const SEED_INSTANT = Date.now();

export function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10 + (n % 7), n % 50, 0, 0);
  return d;
}

const moneyN = (n: number) => Math.round(n * 100) / 100;
const roundQty = (n: number, dec = 4) => {
  const f = 10 ** dec;
  return Math.max(1 / f, Math.round(n * f) / f);
};

const THREE_YEARS = 1825;

/** Jour civil parisien `YYYY-MM-DD` — clé des clôtures journalières. */
function dayKeyOf(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Graine stable dérivée d'une chaîne : la démo doit être reproductible. */
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// Socle temporel absolu (2001-2020) — préparation de l'extension historique.
//
// Le fichier vit aujourd'hui sur un seul régime temporel : `daysAgo(n)`,
// entièrement relatif à `new Date()`. C'est voulu pour la fenêtre récente
// (les trois écritures K2 de `daysAgo(70)`, `daysAgo(53)`, `daysAgo(27)`
// doivent rester dans la fenêtre glissante de trois mois quelle que soit la
// date d'exécution — les figer en dates absolues les ferait sortir de la
// fenêtre au bout de quelques mois et fausserait la tuile Réalisé).
//
// L'historique long (2001-2020) a besoin du régime inverse : des dates
// d'année civile *ancrées*, identiques d'une exécution à l'autre, pour que
// `npm run db:seed` produise le même jeu de données à chaque lancement. Les
// deux régimes coexistent donc délibérément dans ce fichier : `daysAgo` pour
// le présent glissant, le calendrier ancré ci-dessous pour le passé fixe.
// Ce socle n'est pas encore branché sur les écritures du seed — c'est
// l'objet de la passe suivante (les patrons métier de l'historique).
// ---------------------------------------------------------------------------

/** Générateur de nombres pseudo-aléatoires, déterministe pour une graine donnée. */
export type Rng = () => number;

/**
 * mulberry32 — PRNG déterministe et rapide, suffisant pour une démo (pas un
 * usage cryptographique). Deux instanciations avec la même graine rendent
 * exactement la même suite de tirages, dans le même ordre.
 *
 * Convention de consommation pour un patron métier : quand un patron a
 * besoin à la fois d'une dérive de date et d'une dérive de montant, il tire
 * la dérive de date en premier puis la dérive de montant — dans cet ordre,
 * systématiquement — afin qu'ajouter ou retirer un patron n'inverse jamais
 * l'usage des tirages des patrons voisins (chaque patron doit recevoir sa
 * propre instance de `Rng`, dérivée de la graine globale via `deriveRng`,
 * plutôt que de partager un flux global).
 */
export function mulberry32(seed = 25): Rng {
  let a = seed >>> 0;
  return function rng(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Dérive un PRNG indépendant pour un patron donné à partir d'une graine
 * globale et d'un nom de patron stable. Évite qu'un patron consomme les
 * tirages destinés à un autre : chaque patron a son propre flux, mais tous
 * restent reproductibles à partir de la même graine globale.
 */
export function deriveRng(globalSeed: number, patternName: string): Rng {
  return mulberry32((globalSeed ^ hashSeed(patternName)) >>> 0);
}

/** Entier tiré uniformément dans [min, max] (bornes incluses). */
function nextInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** Recule jusqu'au jour ouvré précédent (inclus si `d` est déjà ouvré). */
function previousBusinessDay(d: Date): Date {
  const r = new Date(d.getTime());
  while (isWeekend(r)) {
    r.setUTCDate(r.getUTCDate() - 1);
  }
  return r;
}

function dateFromDayOfYear(year: number, dayOfYear: number): Date {
  const d = new Date(Date.UTC(year, 0, 1, 10, 0, 0));
  d.setUTCDate(d.getUTCDate() + (dayOfYear - 1));
  return d;
}

/**
 * Rend une date ancrée sur une année et un jour-de-l'année, avec un décalage
 * de ±11 jours tiré du PRNG, recalée sur le jour ouvré précédent si elle
 * tombe un week-end. `usedDayKeys`, quand fourni, garantit que deux appels
 * pour un même patron (donc partageant le même Set) ne rendent jamais le
 * même jour : en cas de collision, on retire un nouveau décalage.
 */
export function anchoredDate(
  rng: Rng,
  year: number,
  anchorDayOfYear: number,
  usedDayKeys?: Set<string>,
): Date {
  const maxAttempts = 40;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const offset = nextInt(rng, -11, 11);
    const candidate = previousBusinessDay(dateFromDayOfYear(year, anchorDayOfYear + offset));
    const key = dayKeyOf(candidate);
    if (!usedDayKeys || !usedDayKeys.has(key)) {
      usedDayKeys?.add(key);
      return candidate;
    }
  }
  throw new Error(
    `anchoredDate: aucun jour disponible pour l'année ${year} (ancre ${anchorDayOfYear}) après ${maxAttempts} tirages`,
  );
}

// ---------------------------------------------------------------------------
// Échelle de vie du patrimoine : s(y) = 1.07^(y - 2001).
// ---------------------------------------------------------------------------

const LIFE_SCALE_BASE_YEAR = 2001;
const LIFE_SCALE_GROWTH = D(1.07);

/** Facteur d'échelle appliqué aux montants de l'historique pour l'année `year`. */
export function lifeScale(year: number): Prisma.Decimal {
  return LIFE_SCALE_GROWTH.pow(year - LIFE_SCALE_BASE_YEAR);
}

/**
 * Applique l'échelle de vie à un montant de base et arrondit selon la règle
 * imposée par la spec : au multiple de 10 € le plus proche au-dessus de
 * 1 000 €, au multiple de 1 € en dessous. Toujours en `Decimal` — jamais de
 * `Math.round` sur un `number` dans ce chemin.
 */
export function scaledAmount(baseAmount: number, year: number): Prisma.Decimal {
  const raw = D(baseAmount).mul(lifeScale(year));
  const step = raw.abs().greaterThanOrEqualTo(1000) ? 10 : 1;
  return raw.dividedBy(step).toDecimalPlaces(0).mul(step).toDecimalPlaces(2);
}

// ---------------------------------------------------------------------------
// Table de cours historiques (2001-2026) — environ dix tickers cotés.
//
// Une année sans prix pour un ticker est une absence assumée, pas une
// interpolation à venir : `historicalPriceOf` rend `undefined` ("inconnu"),
// jamais 0 et jamais une valeur lissée entre deux années connues. Les
// tickers respectent leurs dates d'existence réelles : cryptos pas avant
// 2017, CW8.PA à partir de 2009, C50.PA à partir de 2008, AIR.PA (Airbus)
// pas avant 2014 — avant, SU.PA (Schneider Electric) tient lieu de valeur
// industrielle française sur 2001-2013. TTE.PA est volontairement exclu de
// cet historique (décision du propriétaire du produit).
// ---------------------------------------------------------------------------

export const HISTORICAL_PRICES: Readonly<Record<string, Readonly<Record<number, number>>>> = {
  // ETF monde, réplique MSCI World — dispo depuis 2009 ; creux net 2020 (COVID).
  "CW8.PA": {
    2009: 120, 2010: 140, 2011: 135, 2012: 150, 2013: 175, 2014: 195,
    2015: 210, 2016: 215, 2017: 245, 2018: 235, 2019: 275,
    2020: 240, // COVID
    2021: 320, 2022: 300, 2023: 350, 2024: 400, 2025: 430, 2026: 450,
  },
  // ETF CAC 40 — dispo depuis 2008 ; creux marqué en 2008 et en 2020.
  "C50.PA": {
    2008: 60, // crise financière
    2009: 75, 2010: 78, 2011: 70, 2012: 76, 2013: 88, 2014: 92,
    2015: 100, 2016: 98, 2017: 112, 2018: 100,
    2019: 118,
    2020: 95, // COVID
    2021: 135, 2022: 128, 2023: 148, 2024: 160, 2025: 170, 2026: 180,
  },
  // Schneider Electric — sert de proxy industriel français 2001-2013
  // (avant l'existence d'AIR.PA sous ce nom : c'était EADS jusqu'en 2013).
  "SU.PA": {
    2001: 35, 2002: 28, 2003: 32, 2004: 45, 2005: 55, 2006: 70,
    2007: 95,
    2008: 40, // crise financière : chute nette
    2009: 55, 2010: 90, 2011: 40, 2012: 50, 2013: 60,
  },
  // Airbus — utilisable à partir de 2014 seulement (avant : EADS, hors périmètre).
  "AIR.PA": {
    2014: 45, 2015: 60, 2016: 55, 2017: 75, 2018: 95, 2019: 130,
    2020: 55, // COVID : aviation à l'arrêt
    2021: 100, 2022: 95, 2023: 130, 2024: 145, 2025: 160, 2026: 170,
  },
  // Sanofi — pharma défensive, historique complet 2001-2026.
  "SAN.PA": {
    2001: 65, 2002: 55, 2003: 60, 2004: 62, 2005: 70, 2006: 68,
    2007: 65,
    2008: 45, // crise financière
    2009: 50, 2010: 48, 2011: 52, 2012: 65, 2013: 75, 2014: 80,
    2015: 78, 2016: 70, 2017: 75, 2018: 70, 2019: 85,
    2020: 82, // COVID : recul modéré, secteur défensif
    2021: 90, 2022: 88, 2023: 95, 2024: 100, 2025: 105, 2026: 110,
  },
  // LVMH — luxe, historique complet 2001-2026.
  "MC.PA": {
    2001: 40, 2002: 30, 2003: 38, 2004: 50, 2005: 60, 2006: 75,
    2007: 90,
    2008: 45, // crise financière
    2009: 65, 2010: 105, 2011: 110, 2012: 130, 2013: 135, 2014: 130,
    2015: 155, 2016: 165, 2017: 235, 2018: 260,
    2019: 375,
    2020: 350, // COVID
    2021: 640, 2022: 700, 2023: 780, 2024: 620, 2025: 650, 2026: 680,
  },
  // Société Générale — banque, très exposée 2008 et re-touchée 2020.
  "GLE.PA": {
    2001: 65, 2002: 55, 2003: 65, 2004: 75, 2005: 95, 2006: 120,
    2007: 100,
    2008: 35, // crise financière : effondrement bancaire
    2009: 45, 2010: 40, 2011: 20, 2012: 22, 2013: 30, 2014: 35,
    2015: 38, 2016: 32, 2017: 42, 2018: 30,
    2019: 27,
    2020: 13, // COVID : plus bas historique
    2021: 25, 2022: 24, 2023: 26, 2024: 22, 2025: 24, 2026: 25,
  },
  // L'Oréal — historique complet 2001-2026.
  "OR.PA": {
    2001: 75, 2002: 65, 2003: 60, 2004: 62, 2005: 65, 2006: 75,
    2007: 85,
    2008: 55, // crise financière
    2009: 65, 2010: 80, 2011: 85, 2012: 100, 2013: 120, 2014: 135,
    2015: 165, 2016: 155, 2017: 185, 2018: 175,
    2019: 250,
    2020: 260, // COVID : impact limité, cosmétique résiliente
    2021: 385, 2022: 335, 2023: 400, 2024: 420, 2025: 440, 2026: 460,
  },
  // Bitcoin (EUR) — pas d'historique avant 2017.
  BTC: {
    2017: 12000, 2018: 3500, 2019: 6500,
    2020: 25000, // portée par la fin d'année 2020, malgré le creux de mars
    2021: 42000, 2022: 15000, 2023: 40000, 2024: 60000, 2025: 90000, 2026: 95000,
  },
  // Ethereum (EUR) — pas d'historique avant 2017.
  ETH: {
    2017: 700, 2018: 130, 2019: 130,
    2020: 600,
    2021: 3200, 2022: 1100, 2023: 2100, 2024: 3300, 2025: 3800, 2026: 4000,
  },

  // ── Passe 2 : les tickers que les patrons P01, P02 et P05 exigent ─────────
  //
  // Chaque série se termine sur le `marketPrice` que la position porte déjà
  // dans ce fichier, pour que l'historique rejoigne le portefeuille courant
  // sans marche à la soudure. Les cours sont exprimés dans la devise native
  // de la ligne — la conversion est l'affaire du patron, qui écrit son
  // `currency` et son `fxRateToEur` explicitement.
  //
  // 2008 recule partout où le ticker existe : la crise financière n'a épargné
  // aucune de ces lignes. 2020 se lit autrement, et suit ici l'histoire réelle
  // plutôt qu'une règle uniforme — les cycliques et défensives européennes
  // reculent, tandis qu'Apple, Microsoft, ASML et Nvidia montent, portées par
  // le confinement et par la demande de semi-conducteurs. Une baisse imposée à
  // ces quatre-là aurait été un creux inventé.

  // Lyxor CAC 40 (EUR) — support de P02, et la ligne que la vente K2 allège.
  "CAC.PA": {
    2001: 42, 2002: 32, 2003: 36, 2004: 40, 2005: 46, 2006: 53, 2007: 55,
    2008: 34, // crise financière
    2009: 40, 2010: 40, 2011: 34, 2012: 38, 2013: 44, 2014: 45,
    2015: 48, 2016: 47, 2017: 53, 2018: 48, 2019: 58,
    2020: 47, // COVID
    2021: 60, 2022: 56, 2023: 64, 2024: 68, 2025: 71, 2026: 74,
  },
  // Hermès (EUR) — luxe, historique complet.
  "RMS.PA": {
    2001: 130, 2002: 120, 2003: 135, 2004: 150, 2005: 180, 2006: 200, 2007: 210,
    2008: 120, // crise financière
    2009: 160, 2010: 230, 2011: 250, 2012: 280, 2013: 300, 2014: 290,
    2015: 350, 2016: 370, 2017: 450, 2018: 480, 2019: 660,
    2020: 590, // COVID
    2021: 1400, 2022: 1300, 2023: 1900, 2024: 2000, 2025: 2100, 2026: 2200,
  },
  // Air Liquide (EUR) — industrielle défensive, historique complet.
  "AI.PA": {
    2001: 65, 2002: 58, 2003: 62, 2004: 68, 2005: 75, 2006: 85, 2007: 92,
    2008: 62, // crise financière
    2009: 72, 2010: 88, 2011: 85, 2012: 92, 2013: 98, 2014: 100,
    2015: 112, 2016: 105, 2017: 110, 2018: 108, 2019: 125,
    2020: 118, // COVID
    2021: 150, 2022: 132, 2023: 155, 2024: 160, 2025: 164, 2026: 168,
  },
  // Apple (USD) — cours ajustés des divisions du nominal ; P05 l'achète à
  // partir de 2005, la table ne remonte donc pas plus haut.
  AAPL: {
    2005: 1.2, 2006: 2.3, 2007: 5.4,
    2008: 2.6, // crise financière
    2009: 6.4, 2010: 9.6, 2011: 11.6, 2012: 16.5, 2013: 14.5, 2014: 19.7,
    2015: 24, 2016: 26, 2017: 39, 2018: 38, 2019: 71,
    2020: 95, // COVID : la valeur monta, le numérique porté par le confinement
    2021: 168, 2022: 130, 2023: 190, 2024: 245, 2025: 215, 2026: 198,
  },
  // Microsoft (USD) — cours ajustés des divisions du nominal.
  MSFT: {
    2005: 20, 2006: 22, 2007: 26,
    2008: 16, // crise financière
    2009: 23, 2010: 22, 2011: 21, 2012: 22, 2013: 30, 2014: 41,
    2015: 48, 2016: 55, 2017: 74, 2018: 90, 2019: 145,
    2020: 180, // COVID : la valeur monta, le numérique porté par le confinement
    2021: 300, 2022: 240, 2023: 330, 2024: 400, 2025: 410, 2026: 415,
  },
  // Nestlé (CHF) — défensive suisse. La devise n'est pas l'euro : le patron
  // doit écrire son `fxRateToEur`, la table ne convertit rien.
  "NESN.SW": {
    2005: 30, 2006: 34, 2007: 38,
    2008: 25, // crise financière
    2009: 33, 2010: 40, 2011: 42, 2012: 50, 2013: 55, 2014: 60,
    2015: 63, 2016: 62, 2017: 68, 2018: 65, 2019: 90,
    2020: 84, // COVID
    2021: 105, 2022: 95, 2023: 92, 2024: 85, 2025: 86, 2026: 88,
  },
  // ASML (EUR) — semi-conducteurs.
  "ASML.AS": {
    2005: 15, 2006: 18, 2007: 20,
    2008: 12, // crise financière
    2009: 18, 2010: 26, 2011: 30, 2012: 40, 2013: 60, 2014: 75,
    2015: 82, 2016: 95, 2017: 145, 2018: 140, 2019: 240,
    2020: 330, // COVID : la valeur monta, demande de semi-conducteurs
    2021: 620, 2022: 480, 2023: 620, 2024: 680, 2025: 700, 2026: 710,
  },
  // Nvidia (USD) — cours ajustés des divisions du nominal. La table démarre
  // en 2010 : avant, le cours ajusté descend sous le centime et une quantité
  // dérivée d'un montant n'aurait plus aucun sens de lecture.
  NVDA: {
    2010: 9, 2011: 10, 2012: 11, 2013: 14, 2014: 18,
    2015: 24, 2016: 90, 2017: 190, 2018: 150, 2019: 230,
    2020: 420, // COVID : la valeur monta, demande de semi-conducteurs
    2021: 590, 2022: 420, 2023: 620, 2024: 780, 2025: 840, 2026: 880,
  },

  // ── Passe 3 : les trois supports non cotés que les patrons P07 et P12 exigent
  //
  // Ces trois séries ne sont pas des cours de bourse et ne prétendent pas
  // l'être. Ce sont des **prix de souscription**, seuls prix auxquels ces
  // supports s'achètent réellement, et la règle « quantité dérivée du montant »
  // en a besoin autant que d'un cours coté : sans eux, P07 et P12 ne peuvent
  // écrire aucune ligne (prix inconnu → pas de ligne), et l'assurance-vie comme
  // les SCPI disparaîtraient de l'historique.
  //
  // Le fonds euro vaut 1,00 € la part par construction : ce n'est pas une
  // valeur observée mais une convention de l'enveloppe — un euro versé est une
  // part. L'inscrire ici plutôt que de coder « 1 » en dur dans le patron garde
  // une seule porte d'entrée aux prix, et rend l'hypothèse lisible.

  // Fonds euro — part conventionnelle à 1,00 €, sur toute la plage.
  "FE-LINXEA": {
    2001: 1, 2002: 1, 2003: 1, 2004: 1, 2005: 1, 2006: 1, 2007: 1, 2008: 1,
    2009: 1, 2010: 1, 2011: 1, 2012: 1, 2013: 1, 2014: 1, 2015: 1, 2016: 1,
    2017: 1, 2018: 1, 2019: 1, 2020: 1, 2021: 1, 2022: 1, 2023: 1, 2024: 1,
    2025: 1, 2026: 1,
  },
  // SCPI Primovie — prix de part, révisé par la société de gestion. Une SCPI ne
  // décroche pas en 2008 ni en 2020 comme une action : le prix de part suit la
  // valeur d'expertise du parc, avec beaucoup d'inertie et une seule baisse
  // récente (2023, remontée des taux).
  PRIMOVIE: {
    2012: 183, 2013: 187, 2014: 190, 2015: 193, 2016: 196, 2017: 199,
    2018: 203, 2019: 203, 2020: 203, 2021: 208, 2022: 208,
    2023: 194, // révision à la baisse du prix de part
    2024: 190, 2025: 190, 2026: 190,
  },
  // SCPI Épargne Pierre — commercialisée à partir de 2013.
  "EPARGNE-PIERRE": {
    2013: 183, 2014: 185, 2015: 189, 2016: 194, 2017: 200, 2018: 205,
    2019: 205, 2020: 205, 2021: 208, 2022: 208, 2023: 208, 2024: 215,
    2025: 215, 2026: 215,
  },
};

/**
 * Lit le cours d'un ticker pour une année donnée. Rend `undefined` — pas
 * `0`, pas une valeur interpolée — quand l'année est absente de la table.
 * UNKNOWN ≠ ZERO : c'est à l'appelant (les patrons de la passe suivante) de
 * décider comment traiter l'absence (position au coût de revient, point
 * marqué estimé), jamais à cette fonction de la masquer.
 */
export function historicalPriceOf(ticker: string, year: number): Prisma.Decimal | undefined {
  const series = HISTORICAL_PRICES[ticker];
  if (!series) return undefined;
  const price = series[year];
  if (price === undefined) return undefined;
  return D(price);
}

type AssetSeed = {
  name: string;
  ticker: string;
  /** Épinglé dans la watchlist du tableau de bord (démo). */
  watched?: boolean;
  isin?: string;
  assetClass: string;
  category?:
    | "EQUITY"
    | "ETF"
    | "BOND"
    | "FUND"
    | "CRYPTO"
    | "SCPI"
    | "REAL_ESTATE_DIRECT"
    | "DERIVATIVE"
    | "COMMODITY"
    | "OTHER"
    | "UNCLASSIFIED";
  accountType: string;
  platformId: string;
  currency: string;
  priceProvider: string;
  providerSymbol?: string;
  qty: number;
  buyPrice: number;
  marketPrice: number;
  openDaysAgo: number;
  fees?: number;
  countryCode?: string;
  stopLoss?: number;
  tp1?: number;
};

/**
 * Seed complet du patrimoine d’un userId déjà existant (données wipe en amont).
 */
export async function seedUserPortfolio(
  prisma: PrismaClient,
  userId: string,
  tag: string
): Promise<{ platforms: number; assets: number; transactions: number }> {
  const note = (s: string) => `[${tag} seed] ${s}`;

  // ── Platforms ──────────────────────────────────────────────────────────────
  const boursorama = await prisma.platform.create({
    data: {
      userId,
      name: "Boursorama",
      type: "COURTIER",
      logoKey: "boursorama",
    },
  });
  const fortuneo = await prisma.platform.create({
    data: {
      userId,
      name: "Fortuneo",
      type: "COURTIER",
      logoKey: "fortuneo",
    },
  });
  const binance = await prisma.platform.create({
    data: {
      userId,
      name: "Binance",
      type: "EXCHANGE_CRYPTO",
      logoKey: "binance",
    },
  });
  const ibkr = await prisma.platform.create({
    data: {
      userId,
      name: "Interactive Brokers",
      type: "BROKER_CFD",
      logoKey: "interactive_brokers",
    },
  });
  const notaire = await prisma.platform.create({
    data: {
      userId,
      name: "Notaire Immobilier",
      type: "NOTAIRE_IMMOBILIER",
    },
  });
  const avPlatform = await prisma.platform.create({
    data: {
      userId,
      name: "Linxea Spirit 2",
      type: "ASSURANCE_VIE",
      logoKey: "linxea",
    },
  });

  const assetSeeds: AssetSeed[] = [
    {
      name: "LVMH",
      ticker: "MC.PA",
      watched: true,
      isin: "FR0000121014",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "MC.PA",
      qty: 12,
      buyPrice: 720,
      marketPrice: 785,
      openDaysAgo: 980,
      fees: 9.9,
      countryCode: "FR",
      stopLoss: 650,
      tp1: 850,
    },
    {
      name: "TotalEnergies",
      ticker: "TTE.PA",
      isin: "FR0000120271",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "TTE.PA",
      qty: 80,
      buyPrice: 58.5,
      marketPrice: 61.2,
      openDaysAgo: 870,
      fees: 4.9,
      countryCode: "FR",
    },
    {
      name: "Apple",
      ticker: "AAPL",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "USD",
      priceProvider: "YAHOO",
      providerSymbol: "AAPL",
      qty: 25,
      buyPrice: 175,
      marketPrice: 198,
      openDaysAgo: 1050,
      fees: 1.5,
      countryCode: "US",
    },
    {
      name: "Microsoft",
      ticker: "MSFT",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "USD",
      priceProvider: "YAHOO",
      providerSymbol: "MSFT",
      qty: 18,
      buyPrice: 340,
      marketPrice: 415,
      openDaysAgo: 760,
      fees: 1.2,
      countryCode: "US",
    },
    {
      name: "ASML",
      ticker: "ASML.AS",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "ASML.AS",
      qty: 6,
      buyPrice: 620,
      marketPrice: 710,
      openDaysAgo: 640,
      countryCode: "NL",
    },
    {
      name: "Nestlé",
      ticker: "NESN.SW",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "CHF",
      priceProvider: "YAHOO",
      providerSymbol: "NESN.SW",
      qty: 30,
      buyPrice: 92,
      marketPrice: 88,
      openDaysAgo: 720,
      countryCode: "CH",
    },
    {
      name: "iShares Core MSCI World",
      ticker: "IWDA.AS",
      assetClass: "ACTIONS",
      category: "ETF",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "IWDA.AS",
      qty: 90,
      buyPrice: 78,
      marketPrice: 92,
      openDaysAgo: 1000,
    },
    {
      name: "OAT 2030",
      ticker: "FR0013313582",
      assetClass: "OBLIGATIONS",
      category: "BOND",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "EUR",
      priceProvider: "MANUAL",
      qty: 10,
      buyPrice: 98.5,
      marketPrice: 99.2,
      openDaysAgo: 550,
    },
    {
      name: "Airbus",
      ticker: "AIR.PA",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "PEA",
      platformId: fortuneo.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "AIR.PA",
      qty: 40,
      buyPrice: 128,
      marketPrice: 152,
      openDaysAgo: 920,
      countryCode: "FR",
      tp1: 165,
    },
    {
      name: "L'Oréal",
      ticker: "OR.PA",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "PEA",
      platformId: fortuneo.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "OR.PA",
      qty: 15,
      buyPrice: 390,
      marketPrice: 412,
      openDaysAgo: 680,
      countryCode: "FR",
    },
    {
      name: "Schneider Electric",
      ticker: "SU.PA",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "PEA",
      platformId: fortuneo.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "SU.PA",
      qty: 20,
      buyPrice: 210,
      marketPrice: 245,
      openDaysAgo: 800,
      countryCode: "FR",
    },
    {
      name: "Sanofi",
      ticker: "SAN.PA",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "PEA",
      platformId: fortuneo.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "SAN.PA",
      qty: 50,
      buyPrice: 88,
      marketPrice: 95,
      openDaysAgo: 850,
      countryCode: "FR",
    },
    {
      name: "Hermès",
      ticker: "RMS.PA",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "PEA",
      platformId: fortuneo.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "RMS.PA",
      qty: 3,
      buyPrice: 1850,
      marketPrice: 2200,
      openDaysAgo: 900,
      countryCode: "FR",
    },
    {
      name: "Lyxor CAC 40",
      ticker: "CAC.PA",
      assetClass: "ACTIONS",
      category: "ETF",
      accountType: "PEA",
      platformId: fortuneo.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "CAC.PA",
      qty: 120,
      buyPrice: 68,
      marketPrice: 74,
      openDaysAgo: 610,
    },
    {
      name: "Bitcoin",
      ticker: "BTC",
      watched: true,
      assetClass: "CRYPTO",
      category: "CRYPTO",
      accountType: "CRYPTO",
      platformId: binance.id,
      currency: "EUR",
      priceProvider: "COINGECKO",
      providerSymbol: "bitcoin",
      qty: 0.35,
      buyPrice: 42000,
      marketPrice: 62000,
      openDaysAgo: 1040,
      fees: 12,
      stopLoss: 48000,
      tp1: 75000,
    },
    {
      name: "Ethereum",
      ticker: "ETH",
      assetClass: "CRYPTO",
      category: "CRYPTO",
      accountType: "CRYPTO",
      platformId: binance.id,
      currency: "EUR",
      priceProvider: "COINGECKO",
      providerSymbol: "ethereum",
      qty: 4.2,
      buyPrice: 2100,
      marketPrice: 3200,
      openDaysAgo: 990,
      fees: 8,
    },
    {
      name: "Solana",
      ticker: "SOL",
      assetClass: "CRYPTO",
      category: "CRYPTO",
      accountType: "CRYPTO",
      platformId: binance.id,
      currency: "EUR",
      priceProvider: "COINGECKO",
      providerSymbol: "solana",
      qty: 45,
      buyPrice: 95,
      marketPrice: 148,
      openDaysAgo: 520,
    },
    {
      name: "Chainlink",
      ticker: "LINK",
      assetClass: "CRYPTO",
      category: "CRYPTO",
      accountType: "CRYPTO",
      platformId: binance.id,
      currency: "USD",
      priceProvider: "COINGECKO",
      providerSymbol: "chainlink",
      qty: 200,
      buyPrice: 12.5,
      marketPrice: 14.8,
      openDaysAgo: 400,
    },
    {
      name: "NASDAQ 100 CFD",
      ticker: "US100",
      assetClass: "ACTIONS",
      category: "DERIVATIVE",
      accountType: "CFD",
      platformId: ibkr.id,
      currency: "USD",
      priceProvider: "MANUAL",
      qty: 2,
      buyPrice: 18500,
      marketPrice: 19800,
      openDaysAgo: 280,
      fees: 5,
      stopLoss: 17500,
      tp1: 21000,
    },
    {
      name: "Gold CFD",
      ticker: "XAUUSD",
      assetClass: "AUTRE",
      category: "COMMODITY",
      accountType: "CFD",
      platformId: ibkr.id,
      currency: "USD",
      priceProvider: "MANUAL",
      qty: 5,
      buyPrice: 2320,
      marketPrice: 2410,
      openDaysAgo: 210,
    },
    {
      name: "EUR/USD CFD",
      ticker: "EURUSD",
      assetClass: "AUTRE",
      category: "DERIVATIVE",
      accountType: "CFD",
      platformId: ibkr.id,
      currency: "USD",
      priceProvider: "MANUAL",
      qty: 10000,
      buyPrice: 1.08,
      marketPrice: 1.09,
      openDaysAgo: 150,
    },
    {
      name: "SCPI Primovie",
      ticker: "PRIMOVIE",
      assetClass: "IMMOBILIER",
      category: "SCPI",
      accountType: "IMMOBILIER",
      platformId: notaire.id,
      currency: "EUR",
      priceProvider: "MANUAL",
      qty: 80,
      buyPrice: 203,
      marketPrice: 208,
      openDaysAgo: THREE_YEARS - 50,
      fees: 160,
    },
    {
      name: "Appartement Locatif Lyon",
      ticker: "IMMO-LYON",
      assetClass: "IMMOBILIER",
      category: "REAL_ESTATE_DIRECT",
      accountType: "IMMOBILIER",
      platformId: notaire.id,
      currency: "EUR",
      priceProvider: "MANUAL",
      qty: 1,
      buyPrice: 285000,
      marketPrice: 312000,
      openDaysAgo: THREE_YEARS - 10,
      fees: 12000,
    },
    {
      name: "SCPI Épargne Pierre",
      ticker: "EPARGNE-PIERRE",
      assetClass: "IMMOBILIER",
      category: "SCPI",
      accountType: "IMMOBILIER",
      platformId: notaire.id,
      currency: "EUR",
      priceProvider: "MANUAL",
      qty: 40,
      buyPrice: 208,
      marketPrice: 215,
      openDaysAgo: 700,
      fees: 80,
    },
    {
      name: "Amundi MSCI World",
      ticker: "CW8.PA",
      assetClass: "ACTIONS",
      category: "ETF",
      accountType: "AV",
      platformId: avPlatform.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "CW8.PA",
      qty: 150,
      buyPrice: 420,
      marketPrice: 485,
      openDaysAgo: 880,
    },
    {
      name: "Fonds euro Linxea",
      ticker: "FE-LINXEA",
      assetClass: "OBLIGATIONS",
      category: "FUND",
      accountType: "AV",
      platformId: avPlatform.id,
      currency: "EUR",
      priceProvider: "MANUAL",
      qty: 25000,
      buyPrice: 1,
      marketPrice: 1.02,
      openDaysAgo: 950,
    },
    {
      name: "Amundi Euro Stoxx 50",
      ticker: "C50.PA",
      assetClass: "ACTIONS",
      category: "ETF",
      accountType: "AV",
      platformId: avPlatform.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "C50.PA",
      qty: 80,
      buyPrice: 52,
      marketPrice: 58,
      openDaysAgo: 480,
    },
    {
      name: "Nvidia",
      ticker: "NVDA",
      watched: true,
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "CTO",
      platformId: boursorama.id,
      currency: "USD",
      priceProvider: "YAHOO",
      providerSymbol: "NVDA",
      qty: 10,
      buyPrice: 420,
      marketPrice: 880,
      openDaysAgo: 600,
      countryCode: "US",
    },
    {
      name: "Air Liquide",
      ticker: "AI.PA",
      assetClass: "ACTIONS",
      category: "EQUITY",
      accountType: "PEA",
      platformId: fortuneo.id,
      currency: "EUR",
      priceProvider: "YAHOO",
      providerSymbol: "AI.PA",
      qty: 25,
      buyPrice: 155,
      marketPrice: 168,
      openDaysAgo: 740,
      countryCode: "FR",
    },
    {
      name: "Avalanche",
      ticker: "AVAX",
      assetClass: "CRYPTO",
      category: "CRYPTO",
      accountType: "CRYPTO",
      platformId: binance.id,
      currency: "EUR",
      priceProvider: "COINGECKO",
      providerSymbol: "avalanche-2",
      qty: 80,
      buyPrice: 28,
      marketPrice: 35,
      openDaysAgo: 320,
    },
  ];

  type Pos = AssetSeed & { id: string };
  const positions: Pos[] = [];

  for (const s of assetSeeds) {
    /*
      Création et constat d'enveloppe dans la même transaction.

      Les lignes du seed doivent porter le même niveau de vérité historique
      que celles créées par l'application : sans événement, `resolveEnvelopeAt`
      rend `UNKNOWN` sur tout leur passé, y compris sur des périodes où le seed
      connaît parfaitement l'enveloppe qu'il vient d'établir.

      La transaction évite le seul état incohérent possible : un actif créé
      dont l'événement manquerait à cause d'une écriture partielle.
    */
    const asset = await prisma.$transaction(async (tx) => {
      const cree = await tx.asset.create({
      data: {
        userId,
        platformId: s.platformId,
        name: s.name,
        ticker: s.ticker,
        isin: s.isin ?? null,
        assetClass: s.assetClass,
        category: s.category ?? "UNCLASSIFIED",
        accountType: s.accountType,
        currency: s.currency,
        countryCode: s.countryCode ?? null,
        priceProvider: s.priceProvider,
        providerSymbol: s.providerSymbol ?? s.ticker,
        manualPrice: s.priceProvider === "MANUAL" ? D(s.marketPrice) : null,
        stopLoss: s.stopLoss != null ? D(s.stopLoss) : null,
        tp1: s.tp1 != null ? D(s.tp1) : null,
        acquisitionDate: daysAgo(s.openDaysAgo),
        // Quelques lignes suivies d'emblée : une carte « Watchlist » vide au
        // premier lancement se lit comme une fonctionnalité en panne plutôt
        // que comme une liste à composer.
        watchlistedAt: s.watched ? daysAgo(Math.min(s.openDaysAgo, 30)) : null,
      },
      });

      /*
        Seules les enveloppes titres sont journalisées — le périmètre du
        journal, inchangé, est celui de l'amorçage de sa migration. Inventer un
        événement pour une ligne AV, CRYPTO ou IMMOBILIER élargirait ce
        périmètre sans que rien ne le demande.

        La date retenue est celle de l'**acquisition de la ligne**, et c'est un
        revirement assumé par rapport à la version précédente de ce bloc.

        Elle datait l'événement de la création de l'enregistrement, au motif
        qu'affirmer l'enveloppe à la date d'achat serait une rétro-projection.
        L'argument est juste — pour une ligne **importée**. Le journal existe
        précisément pour ne pas inventer le passé d'une donnée dont on hérite,
        et cette règle ne bouge pas d'un pouce hors de ce fichier.

        Mais le seed n'hérite de rien : il est l'auteur du fait. C'est lui qui
        décide que cette ligne fut achetée en PEA il y a six ans ; le dire à la
        date d'achat n'est pas une conjecture, c'est l'énoncé de ce qu'il vient
        d'établir. Dater l'événement d'aujourd'hui revenait à faire dire au jeu
        de démonstration « l'enveloppe n'est connue que depuis ce matin »,
        c'est-à-dire à rendre `UNKNOWN` toute la profondeur de l'historique.

        Le coût n'était pas théorique : `resolveEnvelopeAt` rendait `null` sur
        tout le passé, et la courbe d'un compte-titres — PEA, CTO, ou leur
        somme — se réduisait à un point unique, celui du jour du réamorçage.

        Ce chemin ne s'exécute que pour les portefeuilles semés. Aucun import
        réel n'y passe, et aucun n'antidate son enveloppe.

        Aucun compte titres n'est rattaché : le seed n'en crée aucun, et les
        supprime tous au nettoyage. `securitiesAccountId` à `null` enregistre
        donc une absence de rattachement **constatée**, pas une ignorance.
      */
      if (cree.accountType === "CTO" || cree.accountType === "PEA") {
        await tx.assetEnvelopeEvent.create({
          data: {
            assetId: cree.id,
            userId,
            occurredAt: daysAgo(s.openDaysAgo),
            kind: "OBSERVED",
            accountType: cree.accountType,
            securitiesAccountId: null,
            envelopeType: null,
          },
        });
      }

      return cree;
    });
    positions.push({ ...s, id: asset.id });
  }

  // ── Transactions (~100–120 sur 3 ans) ─────────────────────────────────────
  type TxRow = {
    userId: string;
    type: string;
    platformId: string;
    toPlatformId: string | null;
    assetId: string | null;
    quantity: Prisma.Decimal | null;
    unitPrice: Prisma.Decimal | null;
    fees: Prisma.Decimal;
    currency: string;
    fxRateToEur: Prisma.Decimal;
    grossAmountEur: Prisma.Decimal;
    feesEur: Prisma.Decimal;
    netCashImpactEur: Prisma.Decimal;
    withholdingTaxEur: Prisma.Decimal;
    withholdingTaxRate: Prisma.Decimal | null;
    occurredAt: Date;
    notes: string | null;
  };

  const txs: TxRow[] = [];
  const allPlatforms = [
    boursorama,
    fortuneo,
    binance,
    ibkr,
    notaire,
    avPlatform,
  ];
  const fxNum = (cur: string) =>
    cur === "USD" ? 0.92 : cur === "CHF" ? 1.05 : 1;

  function pushTx(partial: {
    type: string;
    platformId: string;
    assetId?: string | null;
    quantity?: number | null;
    unitPrice?: number | null;
    fees?: number;
    currency?: string;
    cashAmount?: number | null;
    occurredAt: Date;
    notes: string;
    whtRate?: number;
    /** Plateforme de destination — transferts uniquement. */
    toPlatformId?: string | null;
  }) {
    const currency = (partial.currency || "EUR").toUpperCase();
    const fx = fxNum(currency);
    const fees = partial.fees ?? 0;
    const feesEur = moneyN(fees * fx);
    let grossEur = 0;
    let net = 0;
    const type = partial.type;
    if (type === "ACHAT" || type === "VENTE") {
      const q = partial.quantity ?? 0;
      const u = partial.unitPrice ?? 0;
      grossEur = moneyN(q * u * fx);
      net = 0;
    } else if (type === "APPORT") {
      grossEur = moneyN((partial.cashAmount ?? 0) * fx);
      net = grossEur;
    } else if (type === "TRANSFERT_CASH") {
      /*
        Un transfert déplace de l'argent sans en créer ni en détruire : son
        impact net sur le patrimoine est nul, mais son montant brut doit être
        renseigné — le rejeu du journal le refuse à zéro, et le compte de
        départ resterait crédité de ce qu'il a envoyé.
      */
      grossEur = moneyN((partial.cashAmount ?? 0) * fx);
      net = 0;
    } else if (type === "RETRAIT" || type === "FRAIS") {
      grossEur = moneyN((partial.cashAmount ?? 0) * fx);
      net = -moneyN(grossEur + feesEur);
    } else if (
      type === "DIVIDENDE" ||
      type === "COUPON" ||
      type === "LOYER" ||
      type === "INTERET"
    ) {
      grossEur = moneyN((partial.cashAmount ?? 0) * fx);
      const wht = partial.whtRate ? moneyN(grossEur * partial.whtRate) : 0;
      net = moneyN(grossEur - feesEur - wht);
    }
    const whtRate = partial.whtRate ?? null;
    const whtEur =
      whtRate &&
      ["DIVIDENDE", "COUPON", "LOYER", "INTERET"].includes(type)
        ? moneyN(grossEur * whtRate)
        : 0;

    txs.push({
      userId,
      type,
      platformId: partial.platformId,
      toPlatformId: partial.toPlatformId ?? null,
      assetId: partial.assetId ?? null,
      quantity:
        partial.quantity != null ? D(String(partial.quantity)) : null,
      unitPrice:
        partial.unitPrice != null ? D(String(partial.unitPrice)) : null,
      fees: D(String(fees)),
      currency,
      fxRateToEur: D(String(fx)),
      grossAmountEur: D(String(grossEur)),
      feesEur: D(String(feesEur)),
      netCashImpactEur: D(String(net)),
      withholdingTaxEur: D(String(whtEur)),
      withholdingTaxRate: whtRate != null ? D(String(whtRate)) : null,
      occurredAt: partial.occurredAt,
      notes: partial.notes,
    });
  }

  // Apports initiaux (~3 ans)
  for (const p of allPlatforms) {
    pushTx({
      type: "APPORT",
      platformId: p.id,
      cashAmount:
        p.id === ibkr.id ? 45000 : p.id === notaire.id ? 120000 : 35000,
      currency: p.id === ibkr.id ? "USD" : "EUR",
      occurredAt: daysAgo(THREE_YEARS - 5),
      notes: note(`Apport initial ${p.name}`),
    });
  }
  // Apports annuels
  for (const year of [1, 2, 3, 4]) {
    pushTx({
      type: "APPORT",
      platformId: boursorama.id,
      cashAmount: 8000 + year * 1500,
      currency: "EUR",
      occurredAt: daysAgo(THREE_YEARS - year * 365),
      notes: note(`Apport annuel CTO Y${year}`),
    });
    pushTx({
      type: "APPORT",
      platformId: fortuneo.id,
      cashAmount: 4000 + year * 500,
      currency: "EUR",
      occurredAt: daysAgo(THREE_YEARS - year * 365 - 30),
      notes: note(`Apport PEA Y${year}`),
    });
  }

  const TARGET_TX = 115;
  const qtyLive = new Map<string, number>();

  for (let i = 0; i < positions.length; i++) {
    const p = positions[i]!;
    qtyLive.set(p.id, p.qty);
    pushTx({
      type: "ACHAT",
      platformId: p.platformId,
      assetId: p.id,
      quantity: p.qty,
      unitPrice: p.buyPrice,
      fees: p.fees ?? moneyN(1 + (i % 5) * 0.5),
      currency: p.currency,
      occurredAt: daysAgo(p.openDaysAgo),
      notes: note(`Ouverture ${p.name}`),
    });
  }

  /*
    Transfert interne entre deux plateformes du patrimoine.

    Ni gain ni perte : l'argent change de place sans changer de propriétaire.
    Sans une opération de ce type dans le jeu de démonstration, le module
    Transactions n'a rien à montrer sous son filtre « Transferts », et la fiche
    à deux plateformes reste invisible.
  */
  pushTx({
      type: "TRANSFERT_CASH",
      platformId: boursorama.id,
      toPlatformId: fortuneo.id,
      cashAmount: 3000,
      currency: "EUR",
      occurredAt: daysAgo(120),
      notes: note("Transfert CTO → PEA"),
  });
  pushTx({
      type: "TRANSFERT_CASH",
      platformId: binance.id,
      toPlatformId: boursorama.id,
      cashAmount: 1500,
      currency: "EUR",
      occurredAt: daysAgo(210),
      notes: note("Transfert crypto → CTO"),
  });

  /*
    Trois écritures datées dans les trois derniers mois.

    Le KPI « réalisé et revenus » se lit sur une fenêtre glissante, et le
    journal généré plus bas ne garantit rien à l'intérieur : ses ventes
    partielles et ses coupons tombent où les calendriers relatifs les placent,
    et la fenêtre 3M s'était retrouvée sans une seule vente. Une tuile qui
    affiche zéro parce que le jeu de démonstration est muet n'apprend rien de
    la tuile.

    Elles sont donc écrites ici, avant le plafond `TARGET_TX` : leur présence
    ne dépend pas de la place qu'il reste. Les montants sont adossés au seed,
    pas choisis pour faire un joli chiffre — le cours de vente est le cours de
    marché de la ligne, le coupon suit la convention du générateur
    (`qty × 2 % × nominal`).
  */
  const cac = positions.find((p) => p.ticker === "CAC.PA")!;
  const san = positions.find((p) => p.ticker === "SAN.PA")!;
  const oat = positions.find((p) => p.ticker === "FR0013313582")!;

  pushTx({
    type: "VENTE",
    platformId: cac.platformId,
    assetId: cac.id,
    quantity: 20,
    unitPrice: cac.marketPrice,
    fees: 2.5,
    currency: cac.currency,
    occurredAt: daysAgo(70),
    notes: note("Allègement Lyxor CAC 40 (PEA)"),
  });
  qtyLive.set(cac.id, (qtyLive.get(cac.id) ?? cac.qty) - 20);
  pushTx({
    type: "DIVIDENDE",
    platformId: san.platformId,
    assetId: san.id,
    cashAmount: 180,
    currency: san.currency,
    occurredAt: daysAgo(53),
    notes: note("Dividende annuel Sanofi (PEA)"),
  });
  pushTx({
    type: "COUPON",
    platformId: oat.platformId,
    assetId: oat.id,
    cashAmount: moneyN(oat.qty * 0.02 * oat.buyPrice),
    currency: oat.currency,
    occurredAt: daysAgo(27),
    notes: note("Coupon OAT 2030"),
  });

  const lastDay = new Map(positions.map((p) => [p.id, p.openDaysAgo]));
  const activityPlan: Array<() => void> = [];

  for (const p of positions.filter((_, i) => i % 2 === 0).slice(0, 15)) {
    activityPlan.push(() => {
      const prev = lastDay.get(p.id) ?? 100;
      const day = Math.max(30, Math.floor(prev * 0.55));
      lastDay.set(p.id, day);
      const q =
        p.assetClass === "CRYPTO"
          ? roundQty(p.qty * 0.15, 6)
          : p.assetClass === "IMMOBILIER" && p.qty === 1
            ? 0
            : roundQty(Math.max(1, p.qty * 0.2), 2);
      if (q <= 0) return;
      pushTx({
        type: "ACHAT",
        platformId: p.platformId,
        assetId: p.id,
        quantity: q,
        unitPrice: moneyN(p.buyPrice * (0.95 + (day % 10) * 0.01)),
        fees: moneyN(2 + (day % 7)),
        currency: p.currency,
        occurredAt: daysAgo(day),
        notes: note(`Renfort ${p.name}`),
      });
      qtyLive.set(p.id, (qtyLive.get(p.id) ?? 0) + q);
    });
  }

  for (const p of positions
    .filter((x) => x.qty > 2 && x.accountType !== "IMMOBILIER")
    .slice(0, 12)) {
    activityPlan.push(() => {
      const prev = lastDay.get(p.id) ?? 80;
      const day = Math.max(20, Math.floor(prev * 0.35));
      lastDay.set(p.id, day);
      const live = qtyLive.get(p.id) ?? p.qty;
      const sellQ = roundQty(Math.min(live * 0.25, live - 0.5), 4);
      if (sellQ <= 0 || sellQ >= live) return;
      pushTx({
        type: "VENTE",
        platformId: p.platformId,
        assetId: p.id,
        quantity: sellQ,
        unitPrice: moneyN(p.marketPrice * 0.98),
        fees: moneyN(1.5 + (day % 5)),
        currency: p.currency,
        occurredAt: daysAgo(day),
        notes: note(`Vente partielle ${p.name}`),
      });
      qtyLive.set(p.id, live - sellQ);
    });
  }

  // Dividendes trimestriels ~3 ans
  const divCandidates = positions.filter(
    (p) => p.assetClass === "ACTIONS" && p.accountType !== "CFD"
  );
  for (let q = 0; q < 12; q++) {
    const p = divCandidates[q % divCandidates.length]!;
    const day = 40 + q * 90;
    if (day > THREE_YEARS - 10) continue;
    activityPlan.push(() => {
      pushTx({
        type: "DIVIDENDE",
        platformId: p.platformId,
        assetId: p.id,
        cashAmount: moneyN(25 + (q % 8) * 12.5 + p.qty * 0.3),
        currency: p.currency,
        occurredAt: daysAgo(day),
        notes: note(`Dividende T${(q % 4) + 1} ${p.name}`),
        whtRate:
          p.countryCode === "US" ? 0.15 : p.countryCode === "CH" ? 0.35 : 0,
      });
    });
  }

  for (const p of positions.filter((x) => x.assetClass === "OBLIGATIONS")) {
    for (const day of [90, 270, 450, 630, 810]) {
      activityPlan.push(() => {
        pushTx({
          type: "COUPON",
          platformId: p.platformId,
          assetId: p.id,
          cashAmount: moneyN(p.qty * 0.02 * p.buyPrice),
          currency: p.currency,
          occurredAt: daysAgo(day),
          notes: note(`Coupon ${p.name}`),
        });
      });
    }
  }

  for (const p of positions.filter((x) => x.assetClass === "IMMOBILIER")) {
    for (let m = 0; m < 24; m++) {
      const day = 30 + m * 45;
      if (day > THREE_YEARS) break;
      activityPlan.push(() => {
        pushTx({
          type: "LOYER",
          platformId: p.platformId,
          assetId: p.id,
          cashAmount:
            p.ticker === "IMMO-LYON" ? 980 : moneyN(p.qty * 0.35),
          currency: "EUR",
          occurredAt: daysAgo(day),
          notes: note(`Loyer ${p.name}`),
        });
      });
    }
  }

  for (let i = 0; i < 8; i++) {
    const p = allPlatforms[i % allPlatforms.length]!;
    activityPlan.push(() => {
      pushTx({
        type: "INTERET",
        platformId: p.id,
        cashAmount: moneyN(8 + i * 3.5),
        currency: "EUR",
        occurredAt: daysAgo(20 + i * 120),
        notes: note(`Intérêts cash ${p.name}`),
      });
    });
    activityPlan.push(() => {
      pushTx({
        type: "FRAIS",
        platformId: p.id,
        cashAmount: moneyN(4 + i * 2),
        currency: "EUR",
        occurredAt: daysAgo(15 + i * 110),
        notes: note(`Frais de garde ${p.name}`),
      });
    });
  }

  for (const day of [900, 600, 300, 90]) {
    activityPlan.push(() => {
      pushTx({
        type: "RETRAIT",
        platformId: boursorama.id,
        cashAmount: 1200 + (day % 500),
        currency: "EUR",
        occurredAt: daysAgo(day),
        notes: note("Retrait CTO → banque"),
      });
    });
  }
  activityPlan.push(() => {
    pushTx({
      type: "RETRAIT",
      platformId: binance.id,
      cashAmount: 800,
      currency: "EUR",
      occurredAt: daysAgo(45),
      notes: note("Retrait crypto → banque"),
    });
  });

  for (const run of activityPlan) {
    if (txs.length >= TARGET_TX) break;
    run();
  }

  let fill = 0;
  while (txs.length < TARGET_TX && fill < 50) {
    fill++;
    const p = positions[fill % positions.length]!;
    pushTx({
      type: fill % 3 === 0 ? "FRAIS" : "DIVIDENDE",
      platformId: p.platformId,
      assetId: fill % 3 === 0 ? null : p.id,
      cashAmount: moneyN(5 + fill * 1.7),
      currency: p.currency === "USD" ? "USD" : "EUR",
      occurredAt: daysAgo(Math.min(THREE_YEARS - 20, 5 + fill * 18)),
      notes: note(`Activité #${fill} ${p.name}`),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Historique long 2001-2026 — les seize patrons
  // ═══════════════════════════════════════════════════════════════════════════
  //
  // Ce bloc s'exécute **après** le plafond `TARGET_TX` : l'historique ne dépend
  // pas de la place qu'il reste dans la fenêtre récente, et la fenêtre récente
  // ne change pas d'un iota parce que l'historique existe. Les trois écritures
  // K2 (`daysAgo(70)`, `daysAgo(53)`, `daysAgo(27)`) restent intactes, et
  // aucun patron n'achète CAC.PA : le CUMP de cette ligne est un coût moyen
  // pondéré *depuis l'origine*, un seul achat historique de plus le déplacerait
  // et la plus-value figée de la vente K2 (+117,08 €) avec lui. P02 achète donc
  // un ETF indiciel distinct — voir plus bas.
  //
  // Deux régimes temporels cohabitent volontairement : `daysAgo` pour le
  // présent glissant, le calendrier ancré (`anchoredDate`) pour le passé fixe.
  //
  // Écarts assumés par rapport à la table des patrons, tous mesurés :
  //
  //  1. **Plateformes.** La table place P01-P04 sur Boursorama et P05-P06 sur
  //     Fortuneo. Le seed fait l'inverse : ses lignes PEA vivent sur Fortuneo et
  //     ses lignes CTO sur Boursorama. Or `applyTransaction` indexe les
  //     positions par `(assetId, platformId)` — acheter une ligne sur une
  //     plateforme et la vendre sur une autre scinderait le lot en deux et
  //     casserait le CUMP. Chaque écriture est donc portée par la plateforme qui
  //     détient réellement l'actif. C'est explicite, jamais inconnu.
  //  2. **P07.** La table dit « APPORT ». Un APPORT ne crée aucune position :
  //     il crédite la trésorerie bancaire (`applyTransaction`, cas `APPORT`), et
  //     l'encours du fonds euro n'existerait pas — P08, qui arbitre 15 % de cet
  //     encours, n'aurait rien à vendre. Écrire les deux (APPORT + ACHAT le même
  //     jour) compterait l'argent deux fois, l'apport gonflant le cash pendant
  //     que l'achat crée la position. Le versement est donc un ACHAT de parts de
  //     fonds euro à 1,00 € — un euro versé, une part.
  //  3. **P13.** « 600 → 2 000 € » ne se déduit d'aucune échelle base 2001 :
  //     `scaledAmount(600, 2026)` vaut 3 260 €, pas 2 000 €. La règle générale
  //     (« montants en base 2001, à passer par `scaledAmount` ») l'emporte sur
  //     la borne affichée ; les achats crypto valent donc 1 770 € en 2017 et
  //     3 260 € en 2026.
  //  4. **Assureur historique.** Non créé : une plateforme d'assurance
  //     supplémentaire exigerait de dupliquer le fonds euro et l'UC en actifs
  //     neufs, que le rattachement `LifeInsuranceSupport` plus bas raccrocherait
  //     au mauvais contrat. P07 et P08 travaillent sur les supports existants.

  const HIST_SEED = 25;
  /** Trésorerie par plateforme, telle que le grand livre la voit. */
  const histCash = new Map<string, Prisma.Decimal>();
  /** Quantités **acquises par l'historique**, pour la cohérence de stock. */
  const histQty = new Map<string, Prisma.Decimal>();
  /** Date du premier achat historique d'une ligne (P03 : la plus ancienne). */
  const histFirstBuy = new Map<string, Date>();

  /** Devises du seed → euro. Mêmes taux que `fxNum`, en `Decimal`. */
  const fxDec = (cur: string): Prisma.Decimal =>
    cur === "USD" ? D("0.92") : cur === "CHF" ? D("1.05") : D("1");

  const histRngs = new Map<string, Rng>();
  const histDays = new Map<string, Set<string>>();
  /**
   * Date ancrée pour un patron : un flux PRNG isolé et un jeu de jours déjà
   * pris par patron, conformément à la convention de `mulberry32` (dérive de
   * date d'abord, dérive de montant ensuite).
   */
  function histDate(pattern: string, year: number, anchor: number): Date {
    let rng = histRngs.get(pattern);
    if (!rng) {
      rng = deriveRng(HIST_SEED, pattern);
      histRngs.set(pattern, rng);
    }
    let used = histDays.get(pattern);
    if (!used) {
      used = new Set<string>();
      histDays.set(pattern, used);
    }
    return anchoredDate(rng, year, anchor, used);
  }
  /** Tirage entier propre à un patron, consommé **avant** ses dates. */
  function histInt(pattern: string, min: number, max: number): number {
    let rng = histRngs.get(pattern);
    if (!rng) {
      rng = deriveRng(HIST_SEED, pattern);
      histRngs.set(pattern, rng);
    }
    return nextInt(rng, min, max);
  }

  /**
   * Écriture historique — tout en `Decimal`, aucun `number` en chemin métier.
   *
   * Reprend à l'identique les conventions de `pushTx` (brut, net, retenue à la
   * source) sans passer par son `moneyN` flottant, que la consigne interdit
   * d'étendre. `platformId`, `currency` et `fxRateToEur` sont toujours
   * explicites : aucune écriture ne sort d'ici en UNKNOWN.
   */
  function pushHistTx(p: {
    type: string;
    platformId: string;
    assetId?: string | null;
    quantity?: Prisma.Decimal | null;
    unitPrice?: Prisma.Decimal | null;
    fees?: Prisma.Decimal;
    currency?: string;
    /** Montant en **devise de l'écriture**, opérations de trésorerie. */
    cashAmount?: Prisma.Decimal | null;
    occurredAt: Date;
    notes: string;
    whtRate?: Prisma.Decimal;
  }): void {
    /*
      Aucune écriture datée après aujourd'hui.

      Les patrons parcourent des années civiles entières : celle en cours n'est
      pas terminée, et leurs ancres de fin d'année — le loyer agrégé de
      décembre, le retrait de trésorerie de novembre — tombaient donc dans le
      futur. Un journal de démonstration qui contient l'achat de la semaine
      prochaine n'est pas un historique dense, c'est une prévision, et rien à
      l'écran ne distinguerait les deux.

      Le rejeu comptable, lui, les acceptait sans broncher : c'est la fenêtre
      glissante qui les révélait, en rangeant une opération de novembre parmi
      les « trois derniers mois ».
    */
    if (p.occurredAt.getTime() > SEED_INSTANT) return;

    const currency = (p.currency ?? "EUR").toUpperCase();
    const fx = fxDec(currency);
    const fees = p.fees ?? D(0);
    const feesEur = fees.mul(fx).toDecimalPlaces(2);
    const cash = p.cashAmount ?? D(0);
    let grossEur = D(0);
    let net = D(0);
    let whtEur = D(0);
    if (p.type === "ACHAT" || p.type === "VENTE") {
      grossEur = (p.quantity ?? D(0))
        .mul(p.unitPrice ?? D(0))
        .mul(fx)
        .toDecimalPlaces(2);
    } else if (p.type === "APPORT") {
      grossEur = cash.mul(fx).toDecimalPlaces(2);
      net = grossEur;
    } else if (p.type === "RETRAIT" || p.type === "FRAIS") {
      grossEur = cash.mul(fx).toDecimalPlaces(2);
      net = grossEur.plus(feesEur).negated();
    } else if (
      p.type === "DIVIDENDE" ||
      p.type === "COUPON" ||
      p.type === "LOYER" ||
      p.type === "INTERET"
    ) {
      grossEur = cash.mul(fx).toDecimalPlaces(2);
      whtEur = p.whtRate ? grossEur.mul(p.whtRate).toDecimalPlaces(2) : D(0);
      net = grossEur.minus(feesEur).minus(whtEur);
    }

    // Trésorerie de plateforme, pour la règle « un RETRAIT seulement si le
    // solde reste ≥ 0 ». Les achats et ventes n'y touchent pas — c'est la règle
    // du grand livre, pas une simplification d'ici.
    histCash.set(
      p.platformId,
      (histCash.get(p.platformId) ?? D(0)).plus(net)
    );

    txs.push({
      userId,
      type: p.type,
      platformId: p.platformId,
      toPlatformId: null,
      assetId: p.assetId ?? null,
      quantity: p.quantity ?? null,
      unitPrice: p.unitPrice ?? null,
      fees,
      currency,
      fxRateToEur: fx,
      grossAmountEur: grossEur,
      feesEur,
      netCashImpactEur: net,
      withholdingTaxEur: whtEur,
      withholdingTaxRate: p.whtRate ?? null,
      occurredAt: p.occurredAt,
      notes: p.notes,
    });
  }

  const byTicker = new Map(positions.map((p) => [p.ticker, p]));
  const posOf = (ticker: string) => {
    const p = byTicker.get(ticker);
    if (!p) throw new Error(`seed historique : ticker inconnu ${ticker}`);
    return p;
  };

  /** Frais de courtage forfaitaires d'une écriture titres historique. */
  const HIST_TRADE_FEES = D("2.50");

  /**
   * Achat historique : la quantité se dérive du **montant**, jamais l'inverse.
   * Prix inconnu cette année-là → aucune ligne. Pas de repli sur un coût
   * inventé, pas d'interpolation entre deux années connues.
   */
  function histBuy(args: {
    ticker: string;
    year: number;
    when: Date;
    amountEur: Prisma.Decimal;
    notes: string;
    fees?: Prisma.Decimal;
  }): boolean {
    const pos = posOf(args.ticker);
    const price = historicalPriceOf(args.ticker, args.year);
    if (price === undefined || price.lessThanOrEqualTo(0)) return false;
    const fx = fxDec(pos.currency);
    const qty = args.amountEur.div(fx).div(price).toDecimalPlaces(6);
    if (qty.lessThanOrEqualTo(0)) return false;
    pushHistTx({
      type: "ACHAT",
      platformId: pos.platformId,
      assetId: pos.id,
      quantity: qty,
      unitPrice: price,
      fees: args.fees ?? HIST_TRADE_FEES,
      currency: pos.currency,
      occurredAt: args.when,
      notes: args.notes,
    });
    histQty.set(pos.id, (histQty.get(pos.id) ?? D(0)).plus(qty));
    if (!histFirstBuy.has(pos.id)) histFirstBuy.set(pos.id, args.when);
    return true;
  }

  /**
   * Vente historique d'une fraction du stock **historiquement détenu**.
   * Stock nul ou prix inconnu → l'écriture est sautée, jamais rabotée.
   */
  function histSell(args: {
    ticker: string;
    year: number;
    when: Date;
    fraction: Prisma.Decimal;
    notes: string;
  }): Prisma.Decimal | null {
    const pos = posOf(args.ticker);
    const held = histQty.get(pos.id) ?? D(0);
    if (held.lessThanOrEqualTo(0)) return null;
    const price = historicalPriceOf(args.ticker, args.year);
    if (price === undefined || price.lessThanOrEqualTo(0)) return null;
    const qty = held.mul(args.fraction).toDecimalPlaces(6);
    if (qty.lessThanOrEqualTo(0) || qty.greaterThan(held)) return null;
    const fx = fxDec(pos.currency);
    pushHistTx({
      type: "VENTE",
      platformId: pos.platformId,
      assetId: pos.id,
      quantity: qty,
      unitPrice: price,
      fees: HIST_TRADE_FEES,
      currency: pos.currency,
      occurredAt: args.when,
      notes: args.notes,
    });
    histQty.set(pos.id, held.minus(qty));
    return qty.mul(price).mul(fx).toDecimalPlaces(2);
  }

  /**
   * Premier ticker de la rotation dont le cours est connu cette année-là.
   *
   * « Un patron ne s'exécute jamais avant l'ouverture de sa famille : on
   * décale, on n'anticipe pas. » NVDA n'existe pas avant 2010, AAPL/MSFT pas
   * avant 2005 : la rotation avance jusqu'au support qui cote, plutôt que de
   * perdre l'écriture ou d'inventer un cours.
   */
  function rotateWithPrice(
    list: readonly string[],
    year: number,
    startIndex: number
  ): string | null {
    for (let k = 0; k < list.length; k++) {
      const t = list[(startIndex + k) % list.length]!;
      if (historicalPriceOf(t, year) !== undefined) return t;
    }
    return null;
  }

  // ── P02 — la ligne indicielle du PEA ───────────────────────────────────────
  //
  // Elle n'existe pas dans `assetSeeds` : le seul ETF indiciel du PEA y est
  // CAC.PA, et le propriétaire a figé la plus-value de sa vente K2 (+117,08 €)
  // sur son unique achat de 120 titres à 68 €. Un versement annuel sur cette
  // ligne porterait le CUMP de 68,0208 à 51,5502 et la plus-value à +446,50 € —
  // c'est la définition même du coût moyen pondéré, aucune règle de date n'y
  // change quoi que ce soit. P02 achète donc un ETF distinct, et CAC.PA garde
  // son achat unique.
  //
  // L'événement d'enveloppe est daté du **premier achat**, comme pour toute
  // ligne PEA ou CTO du seed : sans lui, `resolveEnvelopeAt` rendrait `UNKNOWN`
  // sur toute la profondeur de la ligne et la courbe Titres retomberait au point
  // unique que le commit précédent a justement fait disparaître.
  const P02_FIRST_YEAR = 2008;
  const p02Open = histDate("P02-ouverture", P02_FIRST_YEAR, 100);
  const p02Asset = await prisma.$transaction(async (tx) => {
    const cree = await tx.asset.create({
      data: {
        userId,
        platformId: fortuneo.id,
        name: "Amundi CAC 40 UCITS ETF (PEA)",
        ticker: "C50.PA",
        assetClass: "ACTIONS",
        category: "ETF",
        accountType: "PEA",
        currency: "EUR",
        priceProvider: "YAHOO",
        providerSymbol: "C50.PA",
        acquisitionDate: p02Open,
        notes: note("Versement indiciel annuel (P02)"),
      },
    });
    await tx.assetEnvelopeEvent.create({
      data: {
        assetId: cree.id,
        userId,
        occurredAt: p02Open,
        kind: "OBSERVED",
        accountType: "PEA",
        securitiesAccountId: null,
        envelopeType: null,
      },
    });
    return cree;
  });
  const p02Seed: Pos = {
    id: p02Asset.id,
    name: "Amundi CAC 40 UCITS ETF (PEA)",
    ticker: "C50.PA",
    assetClass: "ACTIONS",
    category: "ETF",
    accountType: "PEA",
    platformId: fortuneo.id,
    currency: "EUR",
    priceProvider: "YAHOO",
    providerSymbol: "C50.PA",
    qty: 0,
    buyPrice: 135,
    marketPrice: 180,
    openDaysAgo: THREE_YEARS,
  };
  positions.push(p02Seed);
  byTicker.set("C50.PA", p02Seed);

  // ── P01 — achat PEA blue chip, 3/an, 2001-2026 ─────────────────────────────
  //
  // SU.PA tient lieu de valeur industrielle française jusqu'en 2013 ; AIR.PA
  // prend le relais en 2014 (avant, c'était EADS, hors périmètre). La rotation
  // ne « saute » pas le cinquième support : elle change de titre à la date où
  // le titre change de nom.
  const P01_ROTATION = ["AI.PA", "OR.PA", "SAN.PA", "RMS.PA", "SU.PA"] as const;
  const P01_ANCHORS = [45, 160, 285];
  const p01Assets = new Set<string>();
  let p01Index = 0;
  for (let year = 2001; year <= 2026; year++) {
    for (const anchor of P01_ANCHORS) {
      const raw = P01_ROTATION[p01Index % P01_ROTATION.length]!;
      p01Index++;
      const ticker = raw === "SU.PA" && year >= 2014 ? "AIR.PA" : raw;
      const when = histDate("P01", year, anchor);
      const done = histBuy({
        ticker,
        year,
        when,
        amountEur: scaledAmount(700, year),
        notes: note(`P01 versement PEA ${ticker} ${year}`),
      });
      if (done) p01Assets.add(posOf(ticker).id);
    }
  }

  // ── P02 — achat PEA indiciel, 1/an, 2008-2026 ──────────────────────────────
  for (let year = P02_FIRST_YEAR; year <= 2026; year++) {
    const when = year === P02_FIRST_YEAR ? p02Open : histDate("P02", year, 100);
    histBuy({
      ticker: "C50.PA",
      year,
      when,
      amountEur: scaledAmount(900, year),
      notes: note(`P02 versement indiciel PEA ${year}`),
    });
  }

  // ── P03 — arbitrage PEA, 1-2/an, 2004-2026 ─────────────────────────────────
  //
  // Allège la ligne P01 **la plus anciennement détenue** encore en stock, de
  // 60 % de sa position. Stock nul ou cours inconnu : l'écriture est sautée.
  const P03_ANCHORS = [205, 330];
  for (let year = 2004; year <= 2026; year++) {
    const count = histInt("P03-cadence", 1, 2);
    for (let k = 0; k < count; k++) {
      /*
        Une ligne déjà allégée cesse d'être la candidate.

        Le critère « la plus anciennement détenue et encore en stock » ne
        suffit pas : vendre 60 % n'épuise jamais une position, il la divise par
        2,5. La même ligne restait donc la plus ancienne et se faisait alléger
        chaque année — 0,26 titre, puis 0,10, puis 0,04 — jusqu'à des ventes de
        vingt-trois centimes. Une décroissance géométrique, pas un arbitrage.

        Deux règles y répondent ensemble, et l'une sans l'autre ne suffit pas.
        Un seuil de candidature écarte les lignes qu'il n'y a plus lieu
        d'arbitrer. Et quand le reliquat passerait sous ce seuil, la ligne est
        **soldée** au lieu d'être grignotée : elle quitte alors le vivier pour
        de bon, au lieu d'y rester éternellement comme la plus ancienne.

        Le seuil seul ne réglait rien sur une valeur chère : Hermès à 2 200 €
        le titre franchissait encore 1 000 € de position avec un demi-titre, et
        se faisait alléger de 0,028 titre. Ce n'est pas une erreur d'arrondi,
        c'est la règle de gestion qui manquait.
      */
      const P03_SEUIL_EUR = D(1000);
      const candidates = [...p01Assets]
        .filter((id) => {
          const qty = histQty.get(id) ?? D(0);
          if (!qty.greaterThan(0)) return false;
          const p = positions.find((x) => x.id === id);
          const cours = p ? historicalPriceOf(p.ticker, year) : undefined;
          if (cours === undefined) return false;
          return qty.mul(cours).greaterThanOrEqualTo(P03_SEUIL_EUR);
        })
        .sort((a, b) => {
          const da = histFirstBuy.get(a)?.getTime() ?? 0;
          const db = histFirstBuy.get(b)?.getTime() ?? 0;
          return da - db;
        });
      const target = candidates
        .map((id) => positions.find((p) => p.id === id)!)
        .find((p) => historicalPriceOf(p.ticker, year) !== undefined);
      if (!target) continue;
      const coursCible = historicalPriceOf(target.ticker, year)!;
      const resteApres = (histQty.get(target.id) ?? D(0))
        .mul(D(1).minus(D("0.6")))
        .mul(coursCible);
      const solde = resteApres.lessThan(P03_SEUIL_EUR);
      histSell({
        ticker: target.ticker,
        year,
        when: histDate("P03", year, P03_ANCHORS[k]!),
        fraction: solde ? D(1) : D("0.6"),
        notes: note(
          solde
            ? `P03 solde de la ligne PEA ${target.ticker} ${year}`
            : `P03 arbitrage PEA ${target.ticker} ${year}`
        ),
      });
    }
  }

  // ── P04 — dividende PEA, 1/an, 2003-2026 ───────────────────────────────────
  //
  // Servi par la ligne PEA la mieux dotée à cette date, valorisée au cours de
  // l'année. Retenue à la source nulle : un dividende français encaissé dans un
  // PEA n'en supporte aucune.
  for (let year = 2003; year <= 2026; year++) {
    let best: { pos: Pos; value: Prisma.Decimal } | null = null;
    for (const p of positions) {
      if (p.accountType !== "PEA") continue;
      const held = histQty.get(p.id) ?? D(0);
      if (held.lessThanOrEqualTo(0)) continue;
      const price = historicalPriceOf(p.ticker, year);
      if (price === undefined) continue;
      const value = held.mul(price).mul(fxDec(p.currency));
      if (!best || value.greaterThan(best.value)) best = { pos: p, value };
    }
    if (!best) continue;
    pushHistTx({
      type: "DIVIDENDE",
      platformId: best.pos.platformId,
      assetId: best.pos.id,
      cashAmount: scaledAmount(45, year),
      currency: "EUR",
      whtRate: D(0),
      occurredAt: histDate("P04", year, 130),
      notes: note(`P04 dividende PEA ${best.pos.ticker} ${year}`),
    });
  }

  // ── P05 — achat CTO international, 2/an, 2005-2026 ─────────────────────────
  //
  // NESN.SW cote en franc suisse, AAPL / MSFT / NVDA en dollar : le montant
  // visé est en euro, la quantité se dérive donc du montant **converti**, et
  // chaque écriture porte son `fxRateToEur`. La table de cours ne convertit
  // rien, et c'est voulu.
  const P05_ROTATION = ["AAPL", "MSFT", "NESN.SW", "ASML.AS", "NVDA"] as const;
  const P05_ANCHORS = [75, 250];
  let p05Index = 0;
  for (let year = 2005; year <= 2026; year++) {
    for (const anchor of P05_ANCHORS) {
      const ticker = rotateWithPrice(P05_ROTATION, year, p05Index);
      p05Index++;
      if (!ticker) continue;
      histBuy({
        ticker,
        year,
        when: histDate("P05", year, anchor),
        amountEur: scaledAmount(800, year),
        notes: note(`P05 versement CTO ${ticker} ${year}`),
      });
    }
  }

  // ── P06 — dividende CTO US, 1/an, 2007-2026 ────────────────────────────────
  //
  // Retenue à la source américaine de 15 % : le net crédité est le brut moins
  // la retenue, et le montant est libellé en dollar — d'où la division par le
  // taux de change, pour que la cible en euro soit tenue.
  for (let year = 2007; year <= 2026; year++) {
    const ticker = year % 2 === 1 ? "AAPL" : "MSFT";
    const pos = posOf(ticker);
    if ((histQty.get(pos.id) ?? D(0)).lessThanOrEqualTo(0)) continue;
    const fx = fxDec(pos.currency);
    pushHistTx({
      type: "DIVIDENDE",
      platformId: pos.platformId,
      assetId: pos.id,
      cashAmount: scaledAmount(40, year).div(fx).toDecimalPlaces(2),
      currency: pos.currency,
      whtRate: D("0.15"),
      occurredAt: histDate("P06", year, 215),
      notes: note(`P06 dividende CTO ${ticker} ${year}`),
    });
  }

  // ── P07 — versement AV sur le fonds euro, 1/an, 2004-2026 ──────────────────
  for (let year = 2004; year <= 2026; year++) {
    histBuy({
      ticker: "FE-LINXEA",
      year,
      when: histDate("P07", year, 20),
      amountEur: scaledAmount(1200, year),
      fees: D(0), // Aucun frais d'entrée sur ce contrat (cf. `entryFeePct: 0`).
      notes: note(`P07 versement AV fonds euro ${year}`),
    });
  }

  // ── P08 — arbitrage AV, 1/an, 2009-2026 ────────────────────────────────────
  //
  // Vente de 15 % de l'encours fonds euro et achat d'UC le **même jour** : le
  // produit de la vente finance l'achat, à l'euro près. Si l'encours est nul ou
  // si CW8.PA ne cote pas encore, rien n'est écrit — ni la vente, ni l'achat.
  for (let year = 2009; year <= 2026; year++) {
    if (historicalPriceOf("CW8.PA", year) === undefined) continue;
    const when = histDate("P08", year, 300);
    const produit = histSell({
      ticker: "FE-LINXEA",
      year,
      when,
      fraction: D("0.15"),
      notes: note(`P08 arbitrage AV — sortie fonds euro ${year}`),
    });
    if (produit == null || produit.lessThanOrEqualTo(0)) continue;
    histBuy({
      ticker: "CW8.PA",
      year,
      when,
      amountEur: produit,
      fees: D(0),
      notes: note(`P08 arbitrage AV — entrée UC ${year}`),
    });
  }

  // ── P09 / P10 — acquisition immobilière et son crédit, 2006 ────────────────
  //
  // Les frais de notaire ne sont pas une charge : ils entrent dans le prix de
  // revient du bien, et `applyBuy` les y met. Une écriture `FRAIS` distincte
  // les aurait sortis du coût d'acquisition et retranchés de la trésorerie.
  const P09_YEAR = 2006;
  const p09When = histDate("P09", P09_YEAR, 175);
  const immo = posOf("IMMO-LYON");
  pushHistTx({
    type: "ACHAT",
    platformId: immo.platformId,
    assetId: immo.id,
    quantity: D(1),
    unitPrice: D(168000),
    fees: D(12600),
    currency: "EUR",
    occurredAt: p09When,
    notes: note(`P09 acquisition ${immo.name} (${P09_YEAR})`),
  });
  histQty.set(immo.id, (histQty.get(immo.id) ?? D(0)).plus(1));

  /*
    P10 — le prêt de 2006 s'ajoute, il ne remplace rien.

    Le prêt récent (« Crédit immo Lyon », 220 000 € sur 25 ans) reste intact,
    ses douze échéances aussi. Celui-ci suit la même règle d'amortissement, dans
    l'autre sens : ici la date d'origine est connue, on amortit donc en avant
    plutôt qu'à rebours, mais l'ordre des imputations est le même —

        intérêts  = capital_restant × r
        principal = mensualité − intérêts
        capital   = capital − principal

    La mensualité couvre d'abord les intérêts, et **seul le solde** réduit le
    capital. Une mensualité imputée en entier au capital ferait décroître la
    dette de 833 € par mois, soit 199 920 € remboursés sur 240 mois pour
    140 000 € empruntés — un prêt qui rapporterait de l'argent à l'emprunteur.

    Une écriture par an, en décembre, portant le capital restant dû **après**
    la douzième échéance de l'année : le journal des passifs n'a pas besoin de
    240 lignes pour dessiner un amortissement juste, et `applyMonthlyDebit`
    n'est pas touché.
  */
  const P10_PRINCIPAL = D(140000);
  const P10_PAYMENT = D(833);
  const P10_MONTHLY_RATE = D("0.038").div(12);
  const P10_MONTHS = 240;
  const pret2006 = await prisma.liability.create({
    data: {
      userId,
      name: "Crédit immo Lyon 2006",
      initialAmount: P10_PRINCIPAL,
      remainingAmount: D(0), // recalculé après amortissement
      currency: "EUR",
      interestRate: D("3.80"),
      monthlyPayment: P10_PAYMENT,
      startDate: p09When,
      endDate: new Date(
        Date.UTC(P09_YEAR + 20, p09When.getUTCMonth(), p09When.getUTCDate(), 10)
      ),
      // Prêt arrivé à terme : `lastPaymentAppliedAt` au jour de la dernière
      // échéance, pour qu'aucun débit automatique ne vienne le rejouer.
      lastPaymentAppliedAt: new Date(
        Date.UTC(P09_YEAR + 20, p09When.getUTCMonth(), p09When.getUTCDate(), 10)
      ),
      paymentDay: 5,
      bankName: "Crédit Agricole",
      category: "IMMOBILIER",
      assetId: immo.id,
      notes: note("Prêt 20 ans à 3,80 % — acquisition 2006"),
    },
  });
  await prisma.liabilityEvent.create({
    data: {
      liabilityId: pret2006.id,
      type: "OPENING",
      amount: P10_PRINCIPAL,
      remainingAfter: P10_PRINCIPAL,
      eventDate: p09When,
      notes: note("Déblocage des fonds"),
    },
  });
  const p10End = new Date(
    Date.UTC(P09_YEAR + 20, p09When.getUTCMonth(), p09When.getUTCDate(), 10)
  );
  let p10Crd = P10_PRINCIPAL;
  let p10Months = 0;
  for (let year = P09_YEAR; year <= 2026 && p10Months < P10_MONTHS; year++) {
    const firstMonth = year === P09_YEAR ? p09When.getUTCMonth() + 1 : 0;
    for (let m = firstMonth; m <= 11 && p10Months < P10_MONTHS; m++) {
      const interest = p10Crd.mul(P10_MONTHLY_RATE);
      const principal = P10_PAYMENT.minus(interest);
      p10Crd = p10Crd.minus(principal);
      p10Months++;
      if (p10Crd.lessThan(0)) p10Crd = D(0);
    }
    // Aucune échéance datée après la fin du prêt : la dernière écriture est
    // celle de son terme, portée juste en dessous.
    const decembre = new Date(Date.UTC(year, 11, 5, 10, 0, 0));
    if (decembre > p10End) continue;
    await prisma.liabilityEvent.create({
      data: {
        liabilityId: pret2006.id,
        type: "MONTHLY_DEBIT",
        amount: P10_PAYMENT,
        remainingAfter: p10Crd.toDecimalPlaces(2),
        eventDate: decembre,
        notes: note(`Échéances ${year} — capital restant dû au 31/12`),
      },
    });
  }
  await prisma.liabilityEvent.create({
    data: {
      liabilityId: pret2006.id,
      type: "MONTHLY_DEBIT",
      amount: P10_PAYMENT,
      remainingAfter: p10Crd.toDecimalPlaces(2),
      eventDate: p10End,
      notes: note("Dernière échéance — prêt soldé"),
    },
  });
  await prisma.liability.update({
    where: { id: pret2006.id },
    data: { remainingAmount: p10Crd.toDecimalPlaces(2) },
  });

  // ── P11 — loyers, 1/an agrégé, 2007-2026 ───────────────────────────────────
  //
  // 7 200 € en 2007, revalorisés de 1,5 % l'an (indice de référence des
  // loyers). Montant **absolu** : l'échelle de vie ne s'y applique pas, un
  // loyer suit son bail et non l'enrichissement du bailleur.
  for (let year = 2007; year <= 2026; year++) {
    const loyer = D(7200).mul(D("1.015").pow(year - 2007)).toDecimalPlaces(2);
    pushHistTx({
      type: "LOYER",
      platformId: immo.platformId,
      assetId: immo.id,
      cashAmount: loyer,
      currency: "EUR",
      occurredAt: histDate("P11", year, 350),
      notes: note(`P11 loyers ${year} (agrégé)`),
    });
  }

  // ── P12 — SCPI, 2012 / 2015 / 2018 / 2021 / 2024 ───────────────────────────
  //
  // Épargne Pierre n'est commercialisée qu'à partir de 2013 : la première
  // souscription va donc à Primovie, les suivantes à Épargne Pierre. Montants
  // absolus, 5 000 € à 12 000 € par palier.
  const P12_PLAN: Array<{ year: number; amount: number }> = [
    { year: 2012, amount: 5000 },
    { year: 2015, amount: 6750 },
    { year: 2018, amount: 8500 },
    { year: 2021, amount: 10250 },
    { year: 2024, amount: 12000 },
  ];
  for (const { year, amount } of P12_PLAN) {
    const ticker = year >= 2013 ? "EPARGNE-PIERRE" : "PRIMOVIE";
    histBuy({
      ticker,
      year,
      when: histDate("P12", year, 120),
      amountEur: D(amount),
      fees: D(0), // Commission de souscription incluse dans le prix de part.
      notes: note(`P12 souscription ${ticker} ${year}`),
    });
  }

  // ── P13 — crypto, 1-2/an, 2017-2026 ────────────────────────────────────────
  const P13_ANCHORS = [60, 240];
  let p13Index = 0;
  for (let year = 2017; year <= 2026; year++) {
    const count = histInt("P13-cadence", 1, 2);
    for (let k = 0; k < count; k++) {
      const ticker = p13Index % 2 === 0 ? "BTC" : "ETH";
      p13Index++;
      histBuy({
        ticker,
        year,
        when: histDate("P13", year, P13_ANCHORS[k]!),
        amountEur: scaledAmount(600, year),
        fees: D("1.50"),
        notes: note(`P13 achat ${ticker} ${year}`),
      });
    }
  }

  // ── P14 — diversifiants non cotés ──────────────────────────────────────────
  //
  // Une entrée tous les deux ou trois ans, dans la famille ouverte à cette
  // date : métaux dès 2001, tangibles dès 2003, private equity dès 2008,
  // crowdlending dès 2015. Aucune de ces quatre tables ne porte de clé
  // étrangère vers `Platform` — les plateformes créées ci-dessous existent donc
  // pour l'écran, et le rattachement se fait par le nom, seul lien que le
  // modèle offre.
  const comptoirOr = await prisma.platform.create({
    data: {
      userId,
      name: "Comptoir National de l'Or",
      type: "AUTRE",
      notes: note("Achat de métaux physiques — historique 2001+"),
    },
  });
  const platformePe = await prisma.platform.create({
    data: {
      userId,
      name: "Sowefund",
      type: "AUTRE",
      notes: note("Capital-investissement — historique 2008+"),
    },
  });
  const platformeCrowd = await prisma.platform.create({
    data: {
      userId,
      name: "WiSEED",
      type: "AUTRE",
      notes: note("Crowdlending immobilier — historique 2015+"),
    },
  });
  const nouvellesPlateformes = [comptoirOr, platformePe, platformeCrowd];

  type P14Family = "METAL" | "TANGIBLE" | "PE" | "CROWD";
  const P14_OPENING: Record<P14Family, number> = {
    METAL: 2001,
    TANGIBLE: 2003,
    PE: 2008,
    CROWD: 2015,
  };
  const P14_ORDER: P14Family[] = ["METAL", "TANGIBLE", "PE", "CROWD"];
  let p14Index = 0;
  for (let year = 2001; year <= 2026; ) {
    const ouvertes = P14_ORDER.filter((f) => year >= P14_OPENING[f]);
    const family = ouvertes[p14Index % ouvertes.length]!;
    p14Index++;
    const when = histDate("P14", year, 210);
    const montant = scaledAmount(900, year);
    const anneesDetenues = 2026 - year;
    if (family === "METAL") {
      // Prix de l'once d'or en euro, année par année : le poids se dérive du
      // montant, comme une quantité se dérive d'un montant ailleurs.
      const prixGramme = D(10).mul(D("1.08").pow(year - 2001)).toDecimalPlaces(2);
      const poids = montant.div(prixGramme).toDecimalPlaces(3);
      await prisma.preciousMetalPosition.create({
        data: {
          userId,
          metal: "GOLD",
          format: "PHYSICAL",
          productType: "BAR",
          denomination: `Lingotin ${poids.toFixed(0)} g (${year})`,
          fineness: D("999.9"),
          quantity: D(1),
          unitWeightG: poids,
          weightUnit: "GRAM",
          purchasePriceUnit: montant,
          acquisitionFees: D(0),
          acquiredAt: when,
          hasInvoice: true,
          currentValue: montant
            .mul(D("1.06").pow(anneesDetenues))
            .toDecimalPlaces(2),
          currency: "EUR",
          storageLocation: comptoirOr.name,
          notes: note(`P14 métaux ${year}`),
        },
      });
    } else if (family === "TANGIBLE") {
      await prisma.tangibleAsset.create({
        data: {
          userId,
          category: "WATCHES",
          brandOrArtist: "Omega",
          modelName: `Seamaster ${year}`,
          yearOrVintage: String(year),
          purchasePrice: montant,
          estimatedValue: montant
            .mul(D("1.05").pow(anneesDetenues))
            .toDecimalPlaces(2),
          currency: "EUR",
          hasCertificate: true,
          purchaseDate: when,
          isCollectible: true,
          watchBoxPapers: true,
          notes: note(`P14 tangible ${year}`),
        },
      });
    } else if (family === "PE") {
      await prisma.privateEquityPosition.create({
        data: {
          userId,
          companyName: `Participation ${year}`,
          sector: "TECH",
          peType: "DIRECT",
          shares: D(100),
          acquisitionPricePerShare: montant.div(100).toDecimalPlaces(4),
          investmentDate: when,
          currentNav: montant.mul(D("1.09").pow(anneesDetenues)).toDecimalPlaces(2),
          currency: "EUR",
          committedCapital: montant,
          calledCapital: montant,
          vehicleName: platformePe.name,
          notes: note(`P14 private equity ${year}`),
        },
      });
    } else {
      const echu = year <= 2022;
      await prisma.crowdlendingPosition.create({
        data: {
          userId,
          projectName: `Programme résidentiel ${year}`,
          platform: platformeCrowd.name,
          capitalInvested: montant,
          annualYieldPercent: D("8.5"),
          durationMonths: 24,
          repaymentType: "IN_FINE",
          startDate: when,
          maturityDate: new Date(
            Date.UTC(year + 2, when.getUTCMonth(), when.getUTCDate(), 10)
          ),
          status: echu ? "REPAID" : "ACTIVE",
          // Un projet remboursé ne porte plus de capital : le dire à zéro n'est
          // pas une valeur manquante, c'est le fait.
          remainingCapital: echu ? D(0) : montant,
          currency: "EUR",
          notes: note(`P14 crowdlending ${year}`),
        },
      });
    }
    year += histInt("P14-cadence", 2, 3);
  }

  // ── P15 — trésorerie, 2/an, 2001-2026 ──────────────────────────────────────
  //
  // Apport en juin, retrait en novembre. Le retrait n'est écrit que si le solde
  // de la plateforme reste positif : sinon il est **sauté**, jamais raboté.
  for (let year = 2001; year <= 2026; year++) {
    pushHistTx({
      type: "APPORT",
      platformId: boursorama.id,
      cashAmount: scaledAmount(2500, year),
      currency: "EUR",
      occurredAt: histDate("P15", year, 165),
      notes: note(`P15 apport de trésorerie ${year}`),
    });
    const retrait = scaledAmount(1400, year);
    if ((histCash.get(boursorama.id) ?? D(0)).greaterThanOrEqualTo(retrait)) {
      pushHistTx({
        type: "RETRAIT",
        platformId: boursorama.id,
        cashAmount: retrait,
        currency: "EUR",
        occurredAt: histDate("P15", year, 315),
        notes: note(`P15 retrait de trésorerie ${year}`),
      });
    }
  }

  // ── P16 — épargne salariale ────────────────────────────────────────────────
  //
  // PEE dès 2001, PERCO dès 2004, PER dès 2019 : un plan ne reçoit rien avant
  // d'exister. La valeur de part n'est pas un cours de marché — c'est une VL de
  // fonds, portée ici par une progression annoncée de 5 % l'an depuis le
  // versement, et non par une interpolation entre deux observations absentes.
  const P16_YEARS = [2003, 2006, 2009, 2012, 2015, 2018, 2021, 2024];
  const P16_PLANS = [
    { planType: "PEE", since: 2001, manager: "Amundi", fundName: "Amundi Label Actions Euro", fundCategory: "EQUITY", sourceType: "ABONDEMENT" },
    { planType: "PERCO", since: 2004, manager: "AXA", fundName: "AXA Diversifié", fundCategory: "DIVERSIFIED", sourceType: "INTERESSEMENT" },
    { planType: "PER", since: 2019, manager: "Natixis", fundName: "Natixis Horizon 2040", fundCategory: "DIVERSIFIED", sourceType: "VOLUNTARY" },
  ];
  let p16Index = 0;
  for (const year of P16_YEARS) {
    const ouverts = P16_PLANS.filter((p) => year >= p.since);
    const plan = ouverts[p16Index % ouverts.length]!;
    p16Index++;
    const when = histDate("P16", year, 90);
    const verse = scaledAmount(1000, year);
    const nav = D(10).mul(D("1.05").pow(2026 - year)).toDecimalPlaces(4);
    await prisma.employeeSavingsLine.create({
      data: {
        userId,
        planType: plan.planType,
        manager: plan.manager,
        fundName: plan.fundName,
        contributedAmount: verse,
        fundCategory: plan.fundCategory,
        units: verse.div(10).toDecimalPlaces(4),
        nav,
        currency: "EUR",
        sourceType: plan.sourceType,
        contributionDate: when,
        unlockDate:
          plan.planType === "PER"
            ? null
            : new Date(
                Date.UTC(year + 5, when.getUTCMonth(), when.getUTCDate(), 10)
              ),
        unlockMode: plan.planType === "PER" ? "RETIREMENT" : "DATE",
        notes: note(`P16 abondement ${plan.planType} ${year}`),
      },
    });
  }

  /*
    Régulateur de volume — la seule pièce qui ne vient pas de la table.

    L'arithmétique des seize patrons ne peut pas tenir la cible « aucune année
    sous douze écritures » sur ses six premières années : 2001 et 2002 ne
    connaissent que P01 (trois achats) et P15 (deux mouvements de trésorerie),
    soit cinq écritures ; 2003 en compte six, et il faut attendre 2007 pour que
    la somme des patrons ouverts franchisse douze. Aucun réglage de cadence à
    l'intérieur des bornes annoncées (« 3/an », « 1-2/an », « 1/an ») n'y change
    rien — c'est une propriété de la table, pas un défaut d'implémentation.

    Plutôt que de forcer un patron hors de sa cadence, le complément est écrit
    pour ce qu'il est : des mouvements de trésorerie, la seule famille qui court
    sur toute la plage et dont P15 décrit déjà la mécanique. Ils sont placés
    dans les **mois vides** de l'année, ce qui sert la même intention que le
    plancher annuel — resserrer les intervalles sans écriture.

    Le solde ne devient jamais négatif : un retrait qui ne passe pas est
    remplacé par un apport, jamais raboté.
  */
  const REGULATEUR_PLANCHER = 12;
  const REGULATEUR_PLATEFORMES = [boursorama, fortuneo, avPlatform, notaire];
  const moisOrdre = [1, 4, 7, 10, 2, 5, 8, 11, 0, 3, 6, 9];
  const anneeDe = (d: Date) => Number(dayKeyOf(d).slice(0, 4));
  const moisDe = (d: Date) => Number(dayKeyOf(d).slice(5, 7)) - 1;
  let regIndex = 0;
  for (let year = 2001; year <= 2026; year++) {
    const dansLAnnee = () => txs.filter((t) => anneeDe(t.occurredAt) === year);
    let garde = 0;
    while (dansLAnnee().length < REGULATEUR_PLANCHER && garde < 24) {
      garde++;
      const occupes = new Set(dansLAnnee().map((t) => moisDe(t.occurredAt)));
      const mois = moisOrdre.find((m) => !occupes.has(m)) ?? moisOrdre[garde % 12]!;
      const plateforme =
        REGULATEUR_PLATEFORMES[regIndex % REGULATEUR_PLATEFORMES.length]!;
      const apport = regIndex % 2 === 0;
      regIndex++;
      const when = histDate("P15-regulateur", year, mois * 30 + 15);
      const montant = scaledAmount(apport ? 900 : 500, year);
      const solde = histCash.get(plateforme.id) ?? D(0);
      pushHistTx({
        type: apport || solde.lessThan(montant) ? "APPORT" : "RETRAIT",
        platformId: plateforme.id,
        cashAmount: montant,
        currency: "EUR",
        occurredAt: when,
        notes: note(`P15 mouvement de trésorerie ${plateforme.name} ${year}`),
      });
    }
  }

  txs.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const BATCH = 50;
  for (let i = 0; i < txs.length; i += BATCH) {
    await prisma.transaction.createMany({ data: txs.slice(i, i + BATCH) });
  }

  // ── Cours ──────────────────────────────────────────────────────────────────
  const now = new Date();
  await prisma.priceQuote.createMany({
    data: positions.map((p) => {
      const fx = fxNum(p.currency);
      return {
        assetId: p.id,
        priceNative: D(String(p.marketPrice)),
        nativeCurrency: p.currency,
        priceEur: D(String(moneyN(p.marketPrice * fx))),
        source: "seed",
        status: "OK",
        lastUpdatedAt: now,
      };
    }),
  });

  /*
    Clôtures journalières.

    Sans elles, le moteur de valorisation historique retient chaque position à
    son prix de revient : la courbe est une suite de paliers qui ne bougent
    qu'aux transactions. Un jeu de démonstration doit porter une vraie
    chronologie de cours, sinon il ne démontre rien — et surtout pas que la
    courbe sait suivre le marché entre deux opérations.

    La marche est déterministe (générateur ensemencé par l'actif) : deux seeds
    successifs produisent la même histoire, ce dont les tests e2e dépendent.
  */
  const closeRows: Array<{
    assetId: string;
    day: string;
    closeEur: Prisma.Decimal;
    source: string;
  }> = [];

  for (const p of positions) {
    const fx = fxNum(p.currency);
    const days = Math.min(p.openDaysAgo, THREE_YEARS);
    // Interpole la tendance achat → marché, puis y superpose une volatilité
    // journalière bornée : le prix final retombe exactement sur le cours coté.
    let rnd = hashSeed(p.ticker);
    const drift = (p.marketPrice - p.buyPrice) / Math.max(days, 1);
    let wobble = 0;
    for (let k = days; k >= 0; k--) {
      rnd = (rnd * 1664525 + 1013904223) >>> 0;
      const shock = (rnd / 0xffffffff - 0.5) * 0.02;
      // Retour à la moyenne : l'écart ne dérive pas indéfiniment.
      wobble = wobble * 0.9 + shock;
      const trend = p.buyPrice + drift * (days - k);
      const native = k === 0 ? p.marketPrice : Math.max(trend * (1 + wobble), 0.0001);
      const dt = daysAgo(k);
      closeRows.push({
        assetId: p.id,
        day: dayKeyOf(dt),
        closeEur: D(String(moneyN(native * fx))),
        source: "seed",
      });
    }
  }

  /*
    Clôtures annuelles de l'historique long (≤ 2019).

    La boucle ci-dessus ne descend qu'à `THREE_YEARS` : avant elle, aucune
    clôture n'existe et le moteur retient chaque position à son prix de revient
    (`UNAVAILABLE`, point déclaré estimé). C'est correct — UNKNOWN n'est pas
    ZERO — mais cela laisse vingt ans de courbe qui ne bougent qu'aux
    transactions, alors que la table de cours **connaît** ces années.

    Une clôture par an et par ligne, au dernier jour ouvré de décembre, à la
    valeur de la table. Rien n'est interpolé entre deux décembres : le moteur
    reporte la dernière clôture connue (LOCF, `MARKET_CARRIED`, donc point
    estimé), ce qui est le contraire d'un lissage — la donnée manquante est
    signalée comme telle, pas comblée par une droite.

    La borne 2019 évite tout chevauchement avec la fenêtre récente, dont la
    ligne la plus ancienne remonte à `THREE_YEARS` (soit courant 2020).
  */
  const histCloseRows: typeof closeRows = [];
  for (const p of positions) {
    const serie = HISTORICAL_PRICES[p.ticker];
    if (!serie) continue;
    const fx = fxNum(p.currency);
    for (const [annee, prix] of Object.entries(serie)) {
      const year = Number(annee);
      if (year > 2019) continue;
      const dt = previousBusinessDay(new Date(Date.UTC(year, 11, 31, 10, 0, 0)));
      histCloseRows.push({
        assetId: p.id,
        day: dayKeyOf(dt),
        closeEur: D(prix).mul(D(String(fx))).toDecimalPlaces(2),
        source: "seed-historique",
      });
    }
  }
  closeRows.push(...histCloseRows);

  for (let i = 0; i < closeRows.length; i += 500) {
    await prisma.assetDailyClose.createMany({
      data: closeRows.slice(i, i + 500),
      skipDuplicates: true,
    });
  }

  // ── Cash / banques / livrets ────────────────────────────────────────────────
  await prisma.envelopeCash.createMany({
    data: [
      { userId, envelope: "CTO", balance: D("2450.50"), currency: "EUR" },
      { userId, envelope: "PEA", balance: D("890.00"), currency: "EUR" },
      { userId, envelope: "AV", balance: D("5200.00"), currency: "EUR" },
    ],
  });
  await prisma.bankAccount.createMany({
    data: [
      {
        userId,
        bankName: "BoursoBank",
        balance: D("8420.35"),
        currency: "EUR",
        notes: note("Compte courant"),
      },
      {
        userId,
        bankName: "Crédit Agricole",
        balance: D("2150.00"),
        currency: "EUR",
        notes: note("Compte joint"),
      },
      {
        userId,
        bankName: "Revolut",
        balance: D("1250.40"),
        currency: "EUR",
        notes: note("Compte EUR"),
      },
    ],
  });
  await prisma.savingsAccount.createMany({
    data: [
      {
        userId,
        name: "Livret A",
        // Sans banque de détention, le livret se range sous « établissement non
        // renseigné » dans la synthèse par établissement — ce qui est exact,
        // mais ne démontre rien.
        bankName: "BoursoBank",
        productType: "LIVRET_A",
        balance: D("22950"),
        apyPercent: D("2.4"),
        rateType: "APY",
        payoutFrequency: "YEARLY",
        payoutMonth: 1,
        payoutDayOfMonth: 1,
        currency: "EUR",
        notes: note("Livret A"),
      },
      {
        userId,
        name: "LDDS",
        // Sans banque de détention, le livret se range sous « établissement non
        // renseigné » dans la synthèse par établissement — ce qui est exact,
        // mais ne démontre rien.
        bankName: "Crédit Agricole",
        productType: "LDDS",
        balance: D("12000"),
        apyPercent: D("2.4"),
        rateType: "APY",
        payoutFrequency: "YEARLY",
        payoutMonth: 1,
        payoutDayOfMonth: 1,
        currency: "EUR",
        notes: note("LDDS"),
      },
      {
        userId,
        name: "PEL",
        // Sans banque de détention, le livret se range sous « établissement non
        // renseigné » dans la synthèse par établissement — ce qui est exact,
        // mais ne démontre rien.
        bankName: "Crédit Agricole",
        productType: "PEL",
        balance: D("18500"),
        apyPercent: D("2.25"),
        rateType: "APY",
        payoutFrequency: "YEARLY",
        payoutMonth: 12,
        payoutDayOfMonth: 31,
        currency: "EUR",
        notes: note("PEL ancien"),
      },
    ],
  });

  // ── Assurance-vie (onglet AV dédié) ─────────────────────────────────────────
  const avLinxea = await prisma.lifeInsurance.create({
    data: {
      userId,
      insurer: "Spirica / Linxea Spirit 2",
      openDate: daysAgo(950),
      cashEuro: D("15200"),
      currency: "EUR",
      notes: note("Contrat multi-supports"),
      // Le fonds euro vit dans `cashEuro` ci-dessus — le répéter ici le
      // compterait deux fois au patrimoine.
      products: {
        create: [
          {
            name: "UC Carmignac Patrimoine",
            currentValue: D("8400"),
            currency: "EUR",
          },
        ],
      },
    },
  });
  const avGenerali = await prisma.lifeInsurance.create({
    data: {
      userId,
      insurer: "Generali / Boursorama Vie",
      openDate: daysAgo(700),
      cashEuro: D("5000"),
      currency: "EUR",
      notes: note("Second contrat"),
      // Idem : pas de reprise du fonds euro en support.
      products: {
        create: [
          {
            name: "ETF World tracker",
            currentValue: D("9200"),
            currency: "EUR",
          },
        ],
      },
    },
  });

  /*
    Fiche immobilière des biens détenus en direct.

    Le journal sait qu'un appartement vaut 312 000 €, il ne sait rien du reste :
    ni la ville, ni la surface, ni le loyer, ni le DPE, ni le prêt qui le
    finance. Sans `RealEstateDetail`, l'onglet Immobilier n'avait donc aucun
    bien à montrer — la valeur remontait bien au patrimoine, mais le module
    restait vide.

    Seuls les biens détenus en direct en reçoivent une : une SCPI est une part
    de société, elle n'a ni étage ni taxe foncière propre, et lui inventer une
    adresse serait faux.
  */
  const directProperties = await prisma.asset.findMany({
    where: { userId, accountType: "IMMOBILIER", category: "REAL_ESTATE_DIRECT" },
    select: { id: true, name: true },
  });

  for (const a of directProperties) {
    await prisma.realEstateDetail.create({
      data: {
        assetId: a.id,
        propertyType: "APPARTEMENT",
        usage: "LOCATIF_NU",
        rooms: 3,
        livingAreaM2: 68,
        addressLine: "12 rue de la République",
        postalCode: "69003",
        city: "Lyon",
        valuationMode: "MANUAL",
        lastValuedAt: daysAgo(45),
        monthlyRentEur: D("1250"),
        monthlyChargesEur: D("180"),
        annualPropertyTaxEur: D("1420"),
        occupancyRatePct: D("100"),
        rentDay: 5,
        rentalStartDate: daysAgo(900),
        rentalRegime: "MICRO_FONCIER",
        taxScheme: "AUCUN",
        constructionYear: 2010,
        energyRating: "C",
        gesRating: "C",
        dpeKwhM2Year: 145,
        heatingType: "COLLECTIF_GAZ",
        floor: 3,
        totalFloors: 6,
        hasElevator: true,
        orientation: "SUD",
        hasBalcony: true,
        balconyAreaM2: 6,
        hasCellar: true,
        parkingSpots: 1,
        bathroomCount: 1,
        isCopropriete: true,
        annualCoproChargesEur: D("1200"),
      },
    });
  }

  /*
    Fiche des véhicules immobiliers indirects.

    Le raisonnement ci-dessus — une SCPI n'a ni étage ni taxe foncière, lui
    inventer une adresse serait faux — est juste, et il ne dit rien de la table
    faite pour elle. `IndirectRealEstateDetail` ne demande aucune adresse : elle
    porte la société de gestion, le taux de distribution, l'endettement du
    véhicule et la part imposable à l'IFI.

    Sans elle, deux SCPI comptaient 25 240 € au patrimoine sans apparaître dans
    aucun onglet du module Immobilier, et échappaient à l'assiette IFI alors
    qu'une part de SCPI y est assujettie comme un bien détenu en direct.

    Cette fiche ne porte aucune valeur : la valorisation reste celle de la
    position au journal, exactement comme le fait `createIndirectHolding()`
    quand un utilisateur souscrit depuis l'onglet SCPI.
  */
  const INDIRECT_VEHICLES_SEED: Record<
    string,
    { manager: string; distributionRatePct: string; debtRatioPct: string }
  > = {
    "SCPI Primovie": {
      manager: "Primonial REIM",
      distributionRatePct: "4.52",
      debtRatioPct: "18.400",
    },
    "SCPI Épargne Pierre": {
      manager: "Atland Voisin",
      distributionRatePct: "5.28",
      debtRatioPct: "12.100",
    },
  };

  const indirectProperties = await prisma.asset.findMany({
    where: { userId, accountType: "IMMOBILIER", category: "SCPI" },
    select: { id: true, name: true },
  });

  for (const a of indirectProperties) {
    const preset = INDIRECT_VEHICLES_SEED[a.name];
    if (!preset) continue;
    await prisma.indirectRealEstateDetail.create({
      data: {
        assetId: a.id,
        vehicle: "SCPI",
        manager: preset.manager,
        distributionRatePct: D(preset.distributionRatePct),
        debtRatioPct: D(preset.debtRatioPct),
        // Une SCPI de rendement classique est immobilière à 100 % : toute la
        // part entre dans l'assiette IFI (art. 965 2°).
        realEstateSharePct: D("100"),
        // Société de personnes : les revenus sont imposés chez l'associé.
        taxTransparency: "IR",
        ifiExcluded: false,
        notes: "[Admin seed] Véhicule immobilier indirect",
      },
    });
  }

  /*
    Rattachement des supports aux contrats.

    Sans lui, les trois lignes AV du journal restent orphelines : elles
    comptent bien dans l'encours du patrimoine, mais chaque contrat s'affiche à
    zéro euro et zéro support, et ni la répartition fonds euro / UC ni
    l'antériorité fiscale ne peuvent se calculer. Un jeu de démonstration qui
    montre deux contrats vides ne démontre rien.
  */
  const avAssets = await prisma.asset.findMany({
    where: { userId, accountType: "AV" },
    select: { id: true, name: true, assetClass: true },
  });

  for (const a of avAssets) {
    const isEuroFund = a.name.toLowerCase().includes("fonds euro");
    await prisma.lifeInsuranceSupport.create({
      data: {
        assetId: a.id,
        // Le fonds euro et le tracker monde sur le contrat Linxea, le reste
        // sur le contrat Generali : deux contrats réellement garnis, avec des
        // répartitions différentes à lire.
        lifeInsuranceId: isEuroFund || a.name.includes("MSCI World")
          ? avLinxea.id
          : avGenerali.id,
        kind: isEuroFund ? "FONDS_EURO" : "UC",
        issuer: isEuroFund ? "Spirica" : "Amundi",
        // Frais de gestion : sans eux, la vue « Frais » n'a rien à pondérer.
        managementFeePct: D(isEuroFund ? "0.60" : "0.85"),
        entryFeePct: D("0"),
      },
    });
  }

  // ── Passifs / crédits ──────────────────────────────────────────────────────
  const mortgage = await prisma.liability.create({
    data: {
      userId,
      name: "Crédit immo Lyon",
      initialAmount: D("220000"),
      remainingAmount: D("178500"),
      currency: "EUR",
      interestRate: D("2.15"),
      monthlyPayment: D("980"),
      startDate: daysAgo(THREE_YEARS - 20),
      endDate: daysAgo(-(25 * 365)),
      paymentDay: 5,
      bankName: "Crédit Agricole",
      // Sans catégorie, tous les crédits se rangent sous « Autre » et la
      // répartition par type de l'onglet Passifs ne distingue plus rien.
      category: "IMMOBILIER",
      insuranceMonthly: D("28"),
      notes: note("Prêt 25 ans"),
    },
  });
  /*
    Douze échéances qui amortissent vraiment.

    La version précédente écrivait `178500 + (12 - m) * 420` : le capital
    restant dû **montait** de 420 € à chaque mensualité, si bien qu'un débit de
    980 € alourdissait la dette. Sur la courbe des passifs, cela produisait deux
    marches ascendantes suivies d'un décrochage au jour du seed — un profil qui
    ne ressemble à aucun amortissement.

    Les échéances sont donc reconstruites à rebours depuis le capital restant
    dû courant, avec la règle qui vaut pour un prêt amortissable : la mensualité
    couvre d'abord les intérêts du mois, et seul le solde réduit le capital.

        capital_avant = (capital_après + mensualité) / (1 + r)
        intérêts      = capital_avant × r
        principal     = mensualité − intérêts

    Six premières échéances, à 2,15 % l'an sur 980 € :

        échéance   intérêts   principal   capital après
        la plus récente  320,99    659,01     178 500,00
        −1 mois          322,17    657,83     179 159,01
        −2 mois          323,35    656,65     179 816,83
        −3 mois          324,52    655,48     180 473,49
        −4 mois          325,70    654,30     181 128,96
        −5 mois          326,87    653,13     181 783,27

    L'assurance (28 €/mois) reste hors de ce calcul : c'est une charge, elle ne
    rembourse rien.

    Rien n'est touché du côté du moteur — `applyMonthlyDebit` impute toujours la
    mensualité entière au capital, et c'est un défaut distinct. Ici on corrige
    seulement des données qui décrivaient un prêt impossible.
  */
  const MORTGAGE_MONTHLY_RATE = 0.0215 / 12;
  const MORTGAGE_PAYMENT = 980;
  let crdAfter = 178500;
  for (let m = 0; m < 12; m++) {
    await prisma.liabilityEvent.create({
      data: {
        liabilityId: mortgage.id,
        type: "MONTHLY_DEBIT",
        amount: D(String(MORTGAGE_PAYMENT)),
        remainingAfter: D(moneyN(crdAfter).toFixed(2)),
        eventDate: daysAgo(30 + m * 30),
        notes: note(`Mensualité #${m + 1}`),
      },
    });
    // Remontée d'un mois : avant cette échéance, le capital était plus élevé.
    crdAfter = (crdAfter + MORTGAGE_PAYMENT) / (1 + MORTGAGE_MONTHLY_RATE);
  }
  /*
    Rattachement du prêt au bien qu'il finance.

    C'est la lecture la plus parlante du module Passifs pour un particulier :
    « ce prêt finance ce bien, le bien vaut X, il reste Y, donc mon equity est
    Z ». Sans ce lien, le panneau d'un crédit immobilier n'affiche aucun bien,
    et le rapprochement reste à faire de tête.
  */
  const financedProperty = await prisma.asset.findFirst({
    where: { userId, accountType: "IMMOBILIER", category: "REAL_ESTATE_DIRECT" },
    select: { id: true },
  });
  if (financedProperty) {
    await prisma.liability.update({
      where: { id: mortgage.id },
      data: { assetId: financedProperty.id },
    });
  }

  await prisma.liability.create({
    data: {
      userId,
      name: "Crédit conso auto",
      initialAmount: D("18000"),
      remainingAmount: D("6200"),
      currency: "EUR",
      interestRate: D("3.9"),
      monthlyPayment: D("320"),
      startDate: daysAgo(700),
      endDate: daysAgo(-200),
      paymentDay: 12,
      bankName: "Cetelem",
      category: "CONSOMMATION",
      notes: note("Voiture"),
    },
  });

  // ── Épargne salariale ──────────────────────────────────────────────────────
  await prisma.employeeSavingsLine.createMany({
    data: [
      {
        userId,
        planType: "PEE",
        manager: "Amundi",
        fundName: "Amundi Label Actions Euro",
        contributedAmount: D("3200"),
        fundCategory: "EQUITY",
        isin: "FR0010135103",
        units: D("145.5"),
        nav: D("28.40"),
        currency: "EUR",
        sourceType: "PARTICIPATION",
        contributionDate: daysAgo(800),
        unlockDate: daysAgo(800 - 5 * 365),
        unlockMode: "DATE",
        notes: note("PEE participation"),
      },
      {
        userId,
        planType: "PEE",
        manager: "Amundi",
        fundName: "Amundi Monétaire",
        contributedAmount: D("3800"),
        fundCategory: "MONETARY",
        units: D("320"),
        nav: D("12.10"),
        currency: "EUR",
        sourceType: "ABONDEMENT",
        contributionDate: daysAgo(400),
        unlockDate: daysAgo(400 - 5 * 365),
        unlockMode: "DATE",
        notes: note("PEE abondement"),
      },
      {
        userId,
        planType: "PER",
        manager: "Natixis",
        fundName: "Natixis Horizon 2040",
        contributedAmount: D("3000"),
        fundCategory: "DIVERSIFIED",
        units: D("88.2"),
        nav: D("42.75"),
        currency: "EUR",
        sourceType: "VOLUNTARY",
        contributionDate: daysAgo(600),
        unlockDate: null,
        unlockMode: "RETIREMENT",
        notes: note("PER volontaire"),
      },
      {
        userId,
        planType: "PERCO",
        manager: "AXA",
        fundName: "AXA Diversifié",
        contributedAmount: D("950"),
        fundCategory: "DIVERSIFIED",
        units: D("55"),
        nav: D("18.90"),
        currency: "EUR",
        sourceType: "INTERESSEMENT",
        contributionDate: daysAgo(500),
        unlockDate: daysAgo(500 - 5 * 365),
        unlockMode: "DATE",
        notes: note("PERCO intéressement"),
      },
    ],
  });

  // ── Alternatives ───────────────────────────────────────────────────────────
  await prisma.preciousMetalPosition.createMany({
    data: [
      {
        // Poids **brut** 6,4516 g au titre 900 : 5,806 g d'or fin. Le seed
        // portait auparavant 5,81 g comme poids brut, ce qui revenait à
        // compter le titre deux fois.
        userId,
        metal: "GOLD",
        format: "PHYSICAL",
        productType: "COIN",
        denomination: "Napoléon 20F",
        fineness: D("900"),
        quantity: D("12"),
        unitWeightG: D("6.4516"),
        weightUnit: "GRAM",
        purchasePriceUnit: D("320"),
        acquisitionFees: D("60"),
        acquiredAt: new Date("2016-04-12"),
        hasInvoice: true,
        currentValue: D("4200"),
        currency: "EUR",
        storageLocation: "Coffre banque",
        notes: note("Or physique"),
      },
      {
        // Lot sans facture : l'option pour le régime réel lui est fermée, ce
        // qui donne à l'écran un cas d'avertissement réel à afficher.
        userId,
        metal: "GOLD",
        format: "PHYSICAL",
        productType: "BAR",
        denomination: "Lingotin 50 g",
        fineness: D("999.9"),
        quantity: D("2"),
        unitWeightG: D("50"),
        weightUnit: "GRAM",
        purchasePriceUnit: D("3100"),
        acquisitionFees: D("0"),
        acquiredAt: new Date("2022-09-05"),
        hasInvoice: false,
        currentValue: D("6800"),
        currency: "EUR",
        storageLocation: "Domicile coffre",
        notes: note("Or"),
      },
      {
        // Détention de plus de 22 ans : exonération acquise par l'ancienneté.
        userId,
        metal: "SILVER",
        format: "PHYSICAL",
        productType: "COIN",
        denomination: "Écu 5F Semeuse",
        fineness: D("835"),
        quantity: D("40"),
        unitWeightG: D("12"),
        weightUnit: "GRAM",
        purchasePriceUnit: D("6"),
        acquisitionFees: D("0"),
        acquiredAt: new Date("1998-06-20"),
        hasInvoice: false,
        currentValue: D("520"),
        currency: "EUR",
        storageLocation: "Domicile coffre",
        notes: note("Argent"),
      },
      {
        // Papier : relève du PFU comme tout titre, pas de l'article 150 VI.
        userId,
        metal: "GOLD",
        format: "PAPER",
        productType: "ETC",
        denomination: "ETC Physical Gold",
        fineness: D("999.9"),
        quantity: D("15"),
        unitWeightG: D("31.1034768"),
        weightUnit: "OZ",
        purchasePriceUnit: D("180"),
        acquisitionFees: D("0"),
        acquiredAt: new Date("2021-02-10"),
        hasInvoice: true,
        currentValue: D("3100"),
        currency: "EUR",
        storageLocation: "CTO",
        notes: note("Or papier"),
      },
    ],
  });

  await prisma.privateEquityPosition.createMany({
    data: [
      {
        userId,
        companyName: "GreenTech SAS",
        sector: "Cleantech",
        peType: "CROWDEQUITY",
        shares: D("50"),
        acquisitionPricePerShare: D("100"),
        investmentDate: daysAgo(700),
        currentNav: D("6200"),
        currency: "EUR",
        notes: note("Crowdequity"),
      },
      {
        userId,
        companyName: "MedAI Lab",
        sector: "Healthtech",
        peType: "CLUB_DEAL",
        shares: D("10"),
        acquisitionPricePerShare: D("1000"),
        investmentDate: daysAgo(450),
        currentNav: D("12500"),
        currency: "EUR",
        notes: note("Club deal"),
      },
      {
        userId,
        companyName: "Holding Famille",
        sector: "Diversifié",
        peType: "HOLDING",
        shares: D("100"),
        acquisitionPricePerShare: D("50"),
        investmentDate: daysAgo(900),
        currentNav: D("8000"),
        currency: "EUR",
        notes: note("Parts holding"),
      },
    ],
  });

  await prisma.crowdlendingPosition.createMany({
    data: [
      {
        userId,
        projectName: "Résidence senior Nantes",
        platform: "Homunity",
        capitalInvested: D("5000"),
        annualYieldPercent: D("8.5"),
        durationMonths: 24,
        repaymentType: "IN_FINE",
        startDate: daysAgo(400),
        maturityDate: daysAgo(400 - 24 * 30),
        status: "ACTIVE",
        currency: "EUR",
        notes: note("Crowdlending immo"),
      },
      {
        userId,
        projectName: "PME Industrie 4.0",
        platform: "October",
        capitalInvested: D("2500"),
        annualYieldPercent: D("6.2"),
        durationMonths: 36,
        repaymentType: "AMORTIZING",
        startDate: daysAgo(600),
        maturityDate: daysAgo(600 - 36 * 30),
        status: "ACTIVE",
        currency: "EUR",
        notes: note("Dette privée"),
      },
      {
        userId,
        projectName: "Projet soldé Bordeaux",
        platform: "Homunity",
        capitalInvested: D("3000"),
        annualYieldPercent: D("7.0"),
        durationMonths: 18,
        repaymentType: "IN_FINE",
        startDate: daysAgo(800),
        maturityDate: daysAgo(250),
        status: "REPAID",
        currency: "EUR",
        notes: note("Remboursé"),
      },
    ],
  });

  await prisma.tangibleAsset.createMany({
    data: [
      {
        // Au-dessus du seuil de 5 000 €, daté et certifié : l'option pour le
        // régime réel lui est ouverte.
        userId,
        category: "WATCHES",
        brandOrArtist: "Rolex",
        modelName: "Submariner Date",
        yearOrVintage: "2019",
        purchasePrice: D("9500"),
        estimatedValue: D("12800"),
        currency: "EUR",
        hasCertificate: true,
        certificateRef: "126610LN-2019",
        certificateIssuer: "Rolex",
        purchaseDate: new Date("2019-06-14"),
        purchaseSource: "Concessionnaire agréé",
        hasPurchaseProof: true,
        acquisitionFees: D("150"),
        watchMovement: "AUTOMATIC",
        watchDiameterMm: D("41"),
        watchReference: "126610LN",
        watchBoxPapers: true,
        storageLocation: "Coffre domicile",
        insuranceValue: D("14000"),
        // Garde externalisée et assurée : le cas sain, qui sert de témoin.
        storageType: "BANK_VAULT",
        storageCostAnnual: D("180"),
        storageProvider: "Coffre BNP",
        // Dates relatives : une date fixe change de sens en vieillissant, et
        // le seed cesserait d'illustrer le cas qu'il est censé montrer.
        storageRenewalDate: daysAgo(-300),
        insurancePremiumAnnual: D("120"),
        insuranceProvider: "AXA Objets de valeur",
        insurancePolicyRef: "AXA-OV-2019-8841",
        insuranceType: "WATCH",
        insuranceExpiryDate: daysAgo(-20),
        notes: note("Montre"),
      },
      {
        // Sous le seuil de 5 000 € : aucune imposition à la revente, quel que
        // soit le gain — le cas le plus fréquent d'une collection.
        userId,
        category: "WINE",
        brandOrArtist: "Château Margaux",
        modelName: "Grand Vin",
        yearOrVintage: "2015",
        purchasePrice: D("2400"),
        estimatedValue: D("3100"),
        currency: "EUR",
        hasCertificate: false,
        purchaseDate: new Date("2018-11-02"),
        wineAppellation: "Margaux",
        wineBottleCount: 6,
        wineBottleFormat: "BOTTLE_75",
        wineStorageType: "CAVE_PERSO",
        notes: note("Cave 6 bouteilles"),
      },
      {
        userId,
        category: "ART",
        brandOrArtist: "Artiste contemporain FR",
        modelName: "Série Paysages #3",
        yearOrVintage: "2021",
        purchasePrice: D("1800"),
        estimatedValue: D("2200"),
        currency: "EUR",
        hasCertificate: true,
        certificateIssuer: "Galerie",
        purchaseDate: new Date("2021-03-18"),
        hasPurchaseProof: true,
        acquisitionFees: D("120"),
        appraisalValue: D("2500"),
        appraisalDate: new Date("2025-09-10"),
        appraisalProvider: "Galerie",
        // Conservée au domicile sans prime : l'alerte ne se déclenche pas,
        // la valeur restant sous le seuil de 5 000 €.
        storageType: "HOME",
        notes: note("Toile"),
      },
      {
        // Bijou serti : deux jeux de champs cohabitent, ceux du bijou et ceux
        // de la pierre principale.
        userId,
        category: "JEWELRY",
        brandOrArtist: "Cartier",
        modelName: "Solitaire 1895",
        yearOrVintage: "2012",
        purchasePrice: D("7800"),
        estimatedValue: D("9200"),
        currency: "EUR",
        hasCertificate: true,
        certificateRef: "GIA-2185463201",
        certificateIssuer: "GIA",
        purchaseDate: new Date("2012-12-20"),
        // Certifiée mais sans facture : le certificat atteste la pierre, pas
        // son prix. L'option pour le régime réel lui reste fermée.
        hasPurchaseProof: false,
        jewelryType: "RING",
        metalBase: "PLATINUM_950",
        metalWeightG: D("4.2"),
        hasPunchmarks: true,
        gemType: "DIAMOND",
        caratWeight: D("1.05"),
        gemClarity: "VS1",
        gemColor: "F",
        gemCut: "ROUND",
        gemTreatment: "NONE",
        storageLocation: "Coffre banque",
        // Garde chère au regard de la valeur : 1,6 %/an déclenche l'alerte.
        storageType: "PRO_VAULT",
        storageCostAnnual: D("150"),
        storageProvider: "Brink's",
        storageContractRef: "BR-2012-4471",
        storageRenewalDate: daysAgo(-45),
        // Assuré 6 000 € pour 9 200 € de valeur : sous-assurance de 35 %.
        insurancePremiumAnnual: D("95"),
        insuranceValue: D("6000"),
        insuranceType: "JEWELRY",
        insuranceExpiryDate: daysAgo(-500),
        appraisalValue: D("9000"),
        appraisalDate: new Date("2018-05-12"),
        appraisalProvider: "Expert indépendant",
        notes: note("Bijou"),
      },
      {
        // Véhicule de collection : l'exonération par nature de l'article
        // 150 UA II 1° tombe, la cession redevient imposable.
        userId,
        category: "AUTO",
        brandOrArtist: "Porsche",
        modelName: "911 Carrera (collection)",
        yearOrVintage: "1998",
        purchasePrice: D("42000"),
        estimatedValue: D("55000"),
        currency: "EUR",
        hasCertificate: false,
        purchaseDate: new Date("2015-05-30"),
        isCollectible: true,
        autoMileageKm: 96000,
        autoInspectionOk: true,
        autoPreviousOwners: 3,
        // Objet de forte valeur au domicile sans assurance déclarée : c'est
        // l'alerte la plus utile du module.
        storageType: "HOME",
        // Déjà donné en nue-propriété : hors assiette successorale.
        includeInEstate: false,
        estateNote: "Donation en nue-propriété consentie en 2023",
        notes: note("Véhicule de collection"),
      },
      {
        // Le témoin : même catégorie, sans qualification de collection. Aucun
        // impôt n'est dû malgré une plus-value de 3 000 €.
        userId,
        category: "AUTO",
        brandOrArtist: "Volkswagen",
        modelName: "Golf GTI",
        yearOrVintage: "2020",
        purchasePrice: D("28000"),
        estimatedValue: D("31000"),
        currency: "EUR",
        hasCertificate: false,
        purchaseDate: new Date("2020-09-01"),
        isCollectible: false,
        autoMileageKm: 42000,
        autoInspectionOk: true,
        autoPreviousOwners: 1,
        notes: note("Véhicule d'usage"),
      },
    ],
  });

  /*
    Historique daté des poches de cash, des tangibles et du private equity.

    Le moteur de valorisation historique ne sait remonter le temps que par des
    constats datés : sans eux, il rattache le solde courant à la date de
    création du compte et signale la journée comme estimée. Ces écritures
    donnent au jeu de démonstration ce que porte un vrai patrimoine — un relevé
    par mouvement, une expertise par revalorisation.
  */
  const bankRows = await prisma.bankAccount.findMany({ where: { userId } });
  const savingsRows = await prisma.savingsAccount.findMany({ where: { userId } });

  for (const [idx, b] of bankRows.entries()) {
    const finalBalance = Number(b.balance.toString());
    const openDay = THREE_YEARS - 10 - idx * 20;
    // Le solde d'ouverture représente environ la moitié du solde actuel ; le
    // reste arrive par versements, de sorte que la somme retombe au centime.
    let running = moneyN(finalBalance * 0.45);
    const events: Array<{
      bankAccountId: string;
      type: string;
      amount: Prisma.Decimal;
      balanceAfter: Prisma.Decimal;
      occurredAt: Date;
    }> = [
      {
        bankAccountId: b.id,
        type: "OPENING",
        amount: D(String(running)),
        balanceAfter: D(String(running)),
        occurredAt: daysAgo(openDay),
      },
    ];

    const steps = 14;
    const remainder = finalBalance - running;
    for (let k = 1; k <= steps; k++) {
      const day = Math.max(5, Math.round(openDay - (openDay * k) / steps));
      // Alternance dépôt / retrait : un compte courant ne monte pas en ligne
      // droite, et la courbe doit pouvoir descendre.
      const share = remainder / steps;
      const delta = moneyN(k % 4 === 0 ? -Math.abs(share) * 1.5 : share * 1.5);
      const isLast = k === steps;
      const after = isLast ? finalBalance : moneyN(running + delta);
      const amount = moneyN(after - running);
      running = after;
      events.push({
        bankAccountId: b.id,
        type: amount >= 0 ? "DEPOSIT" : "WITHDRAWAL",
        amount: D(String(amount)),
        balanceAfter: D(String(after)),
        occurredAt: daysAgo(day),
      });
    }
    await prisma.bankAccountEvent.createMany({ data: events });
  }

  for (const [idx, sv] of savingsRows.entries()) {
    const finalBalance = Number(sv.balance.toString());
    const openDay = THREE_YEARS - 30 - idx * 40;
    let running = moneyN(finalBalance * 0.3);
    const events: Array<{
      savingsAccountId: string;
      type: string;
      amount: Prisma.Decimal;
      balanceAfter: Prisma.Decimal;
      occurredAt: Date;
    }> = [
      {
        savingsAccountId: sv.id,
        type: "OPENING",
        amount: D(String(running)),
        balanceAfter: D(String(running)),
        occurredAt: daysAgo(openDay),
      },
    ];

    const steps = 18;
    const remainder = finalBalance - running;
    for (let k = 1; k <= steps; k++) {
      const day = Math.max(3, Math.round(openDay - (openDay * k) / steps));
      const isLast = k === steps;
      const after = isLast ? finalBalance : moneyN(running + remainder / steps);
      const amount = moneyN(after - running);
      running = after;
      events.push({
        savingsAccountId: sv.id,
        // Un versement sur trois est un intérêt crédité : le moteur doit le
        // compter en performance, pas en apport.
        type: k % 3 === 0 ? "INTEREST" : "DEPOSIT",
        amount: D(String(amount)),
        balanceAfter: D(String(after)),
        occurredAt: daysAgo(day),
      });
    }
    await prisma.savingsAccountEvent.createMany({ data: events });
  }

  const tangibleRows = await prisma.tangibleAsset.findMany({ where: { userId } });
  for (const t of tangibleRows) {
    if (!t.purchaseDate) continue;
    const purchase = Number(t.purchasePrice.toString());
    const current = Number(t.estimatedValue.toString());
    const heldDays = Math.round(
      (Date.now() - t.purchaseDate.getTime()) / 86_400_000
    );
    if (heldDays < 400) continue;
    // Une expertise tous les dix-huit mois environ : c'est le rythme réel d'un
    // objet de collection, et cela suffit à dessiner une progression par
    // paliers plutôt qu'un saut unique.
    const steps = Math.min(5, Math.floor(heldDays / 400));
    const rows = [];
    for (let k = 1; k <= steps; k++) {
      const day = Math.max(2, Math.round(heldDays - (heldDays * k) / (steps + 1)));
      const ratio = k / (steps + 1);
      rows.push({
        tangibleId: t.id,
        userId,
        valuedAt: daysAgo(day),
        valueEur: D(String(moneyN(purchase + (current - purchase) * ratio))),
        source: k % 2 === 0 ? "APPRAISAL" : "MARKET",
        note: note("Revalorisation périodique"),
      });
    }
    rows.push({
      tangibleId: t.id,
      userId,
      valuedAt: daysAgo(15),
      valueEur: D(String(current)),
      source: "APPRAISAL",
      note: note("Dernière expertise"),
    });
    if (rows.length > 0) await prisma.tangibleValuation.createMany({ data: rows });
  }

  const peRows = await prisma.privateEquityPosition.findMany({ where: { userId } });
  for (const pe of peRows) {
    if (!pe.investmentDate) continue;
    const invested = Number(pe.shares.toString()) * Number(pe.acquisitionPricePerShare.toString());
    const current = Number(pe.currentNav.toString());
    const heldDays = Math.round(
      (Date.now() - pe.investmentDate.getTime()) / 86_400_000
    );
    if (heldDays < 200) continue;
    // NAV semestrielle : le rythme auquel un fonds communique réellement.
    const steps = Math.max(1, Math.floor(heldDays / 180));
    const rows = [];
    for (let k = 1; k <= steps; k++) {
      const day = Math.max(2, heldDays - k * 180);
      const ratio = 1 - day / heldDays;
      rows.push({
        privateEquityPositionId: pe.id,
        valuedAt: daysAgo(day),
        nav: D(String(moneyN(invested + (current - invested) * ratio))),
        note: note("NAV semestrielle"),
      });
    }
    await prisma.privateEquityValuation.createMany({ data: rows });
  }

  /*
    Pas de série de snapshots fabriquée.

    Trente-sept points étaient posés ici par une formule arithmétique — un
    patrimoine partant de 320 000 € et progressant de 2 200 € par mois, avec
    un prix de revient figé à 340 000 €. Ils ne décrivaient rien du
    portefeuille effectivement semé, qui pèse près de 918 000 € bruts.

    La courbe ne les lit pas : elle est reconstruite par
    `PortfolioValuationEngine`, et `getPortfolioHistory` documente pourquoi
    les mélanger réintroduirait une incohérence de périmètre. Ils étaient donc
    invisibles — et c'est ce qui les rendait dangereux : une table peuplée,
    cohérente de forme, aux noms de champs engageants, qu'un futur écran
    lirait de bonne foi pour afficher une courbe plausible et fausse.

    `PortfolioSnapshot` garde son rôle de point de contrôle : trois écritures
    réelles l'alimentent — première visite, rafraîchissement des cours, import
    terminé. La première visite du compte de démonstration en posera un, juste,
    plutôt que d'en hériter trente-sept qui ne le sont pas.
  */

  // ── Trading à levier ───────────────────────────────────────────────────────
  //
  // Le module Trading n'avait aucune donnée de démonstration : l'écran ne
  // pouvait ni être vu ni être testé. Cinq positions couvrent les cas qui
  // changent l'affichage — long et short, ouverte et clôturée, crypto et CFD,
  // avec et sans prix de marque actualisé, avec et sans stop.
  const tradingAccount = await prisma.tradingAccount.create({
    data: {
      userId,
      brokerName: "IG Markets",
      accountType: "CFD",
      currency: "EUR",
      balance: D("12500"),
      marginAvailable: D("8200"),
      openDate: daysAgo(600),
      notes: note("Compte CFD indices et forex"),
    },
  });

  await prisma.tradingPosition.createMany({
    data: [
      {
        userId,
        underlyingType: "CRYPTO",
        exchange: "HYPERLIQUID",
        pair: "BTC/USD-PERP",
        contractType: "PERPETUAL",
        marginType: "USDT_M",
        baseCurrency: "BTC",
        quoteCurrency: "USD",
        direction: "LONG",
        leverage: D("5"),
        sizeContracts: D("0.42"),
        entryPrice: D("61200"),
        markPrice: D("63480"),
        // Observation récente : le P&L latent est crédible.
        markPriceUpdatedAt: daysAgo(1),
        fundingPaid: D("2.35"),
        commissionPaid: D("15.80"),
        stopLoss: D("58000"),
        takeProfit: D("72000"),
        isOpen: true,
        openedAt: daysAgo(35),
      },
      {
        userId,
        underlyingType: "CRYPTO",
        exchange: "BYBIT",
        pair: "SOL/USD-PERP",
        contractType: "PERPETUAL",
        marginType: "USDT_M",
        baseCurrency: "SOL",
        quoteCurrency: "USD",
        // Un short ouvert : c'est lui qui vérifie le signe de l'exposition
        // nette et la symétrie du P&L latent.
        direction: "SHORT",
        leverage: D("3"),
        sizeContracts: D("25"),
        entryPrice: D("168.30"),
        markPrice: D("162.45"),
        // Observation vieille de trois semaines : au-delà du seuil, l'écran
        // doit le dire au lieu de présenter le latent comme actuel.
        markPriceUpdatedAt: daysAgo(21),
        fundingPaid: D("-4.10"),
        commissionPaid: D("6.20"),
        isOpen: true,
        openedAt: daysAgo(12),
      },
      {
        userId,
        underlyingType: "FOREX",
        exchange: "IG",
        tradingAccountId: tradingAccount.id,
        pair: "EUR/USD",
        contractType: "CFD",
        baseCurrency: "EUR",
        quoteCurrency: "USD",
        direction: "LONG",
        leverage: D("10"),
        sizeContracts: D("50000"),
        entryPrice: D("1.08120"),
        // Prix de marque laissé au prix d'entrée et jamais horodaté : le cas
        // « jamais observé », que l'écran doit signaler au lieu d'afficher un
        // P&L nul crédible.
        markPrice: D("1.08120"),
        markPriceUpdatedAt: null,
        commissionPaid: D("4.50"),
        isOpen: true,
        openedAt: daysAgo(5),
      },
      {
        userId,
        underlyingType: "INDEX",
        exchange: "IG",
        tradingAccountId: tradingAccount.id,
        pair: "NAS100",
        contractType: "CFD",
        baseCurrency: "USD",
        quoteCurrency: "USD",
        direction: "LONG",
        leverage: D("20"),
        sizeContracts: D("1"),
        entryPrice: D("18520"),
        markPrice: D("18735.50"),
        markPriceUpdatedAt: daysAgo(2),
        tickValue: D("1"),
        commissionPaid: D("3.20"),
        isOpen: true,
        openedAt: daysAgo(3),
      },
      {
        userId,
        underlyingType: "CRYPTO",
        exchange: "BINANCE",
        pair: "ETH/USDT-PERP",
        contractType: "PERPETUAL",
        marginType: "USDT_M",
        baseCurrency: "ETH",
        quoteCurrency: "USDT",
        direction: "LONG",
        leverage: D("4"),
        sizeContracts: D("3.25"),
        entryPrice: D("2480.50"),
        markPrice: D("2712.00"),
        // Prix de sortie : définitif, pas périmé — une position close ne bouge
        // plus, donc l'ancienneté ne la concerne pas.
        markPriceUpdatedAt: daysAgo(48),
        realizedPnl: D("752.38"),
        fundingPaid: D("11.20"),
        commissionPaid: D("18.40"),
        exchangeTradeId: "BNB-DEMO-772109",
        isOpen: false,
        openedAt: daysAgo(90),
        closedAt: daysAgo(48),
      },
    ],
  });

  return {
    platforms: allPlatforms.length + nouvellesPlateformes.length,
    assets: positions.length,
    transactions: txs.length,
  };
}
