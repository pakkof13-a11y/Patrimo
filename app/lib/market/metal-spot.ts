/**
 * Cours des métaux précieux — récupération et cache.
 *
 * Le suivi d'un stock physique reposait entièrement sur une valeur saisie à la
 * main, qui vieillissait sans le dire. Or un lingot n'a rien d'inestimable :
 * son métal se cote, et son poids fin est connu. Ce module va chercher le
 * cours, le convertit en euro par gramme, et le range dans un cache journalier.
 *
 * Comme le cache de clôtures des actifs, c'est un cache et rien d'autre : le
 * vider ne perd aucune donnée patrimoniale. Un fournisseur muet laisse un
 * trou, et l'appelant retombe sur la dernière valeur connue — ou sur rien,
 * plutôt que sur un chiffre inventé.
 */

import yahooFinance from "yahoo-finance2";
import { prisma } from "../prisma";
import { parisDayKey } from "../dates/paris";
import { d, toFixed } from "../money/decimal";
import {
  METAL_QUOTE_SYMBOLS,
  perGramFromOunce,
} from "../precious-metals/spot";
import type { PreciousMetal } from "../precious-metals/constants";
import { getEurRates, convertToEurSync } from "./fx";

/** Métaux réellement cotés — « OTHER » n'en désigne aucun. */
export const QUOTED_METALS: PreciousMetal[] = [
  "GOLD",
  "SILVER",
  "PLATINUM",
  "PALLADIUM",
];

/**
 * Fraîcheur exigée du cours du jour.
 *
 * Six heures : un cours de métal ne se lit pas à la seconde, et trois
 * rechargements de l'onglet ne doivent pas déclencher trois séries d'appels.
 */
const REFRESH_AFTER_MS = 6 * 60 * 60 * 1000;

/** Cours du gramme, par métal. */
export type MetalSpotIndex = Map<PreciousMetal, { eurPerGram: number; day: string; source: string }>;

/** Lecture seule du cache — aucun appel réseau. */
export async function readMetalSpots(
  metals: PreciousMetal[] = QUOTED_METALS
): Promise<MetalSpotIndex> {
  const index: MetalSpotIndex = new Map();
  if (metals.length === 0) return index;

  /*
    Une seule requête, puis on ne garde que la ligne la plus récente de chaque
    métal : le cours d'hier vaut mieux que pas de cours du tout quand le
    fournisseur n'a pas encore répondu aujourd'hui.
  */
  const rows = await prisma.metalSpotPrice.findMany({
    where: { metal: { in: metals } },
    orderBy: { day: "desc" },
    take: metals.length * 8,
  });

  for (const row of rows) {
    const metal = row.metal as PreciousMetal;
    if (index.has(metal)) continue;
    const value = Number(row.eurPerGram.toString());
    if (!Number.isFinite(value) || value <= 0) continue;
    index.set(metal, { eurPerGram: value, day: row.day, source: row.source });
  }
  return index;
}

/**
 * Interroge le fournisseur pour un métal, et rend le prix du gramme en euro.
 *
 * Les symboles sont essayés dans l'ordre : la paire en euro d'abord, qui évite
 * une conversion, puis la paire en dollar convertie au taux du jour. `null` si
 * aucun symbole ne répond — on ne devine pas un cours de l'or.
 */
export async function fetchMetalSpot(
  metal: PreciousMetal
): Promise<{ eurPerGram: number; source: string } | null> {
  const candidates = METAL_QUOTE_SYMBOLS[metal] ?? [];
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    try {
      /*
        Le typage du client rend une union très large : on ne consomme que les
        trois champs de prix, comme le fait déjà le fournisseur Yahoo des
        actifs cotés.
      */
      const quote = (await yahooFinance.quote(candidate.symbol)) as {
        regularMarketPrice?: number;
        postMarketPrice?: number;
        preMarketPrice?: number;
      };
      const price =
        quote?.regularMarketPrice ??
        quote?.postMarketPrice ??
        quote?.preMarketPrice;
      if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
        continue;
      }

      /*
        Les paires XAU… cotent l'once troy. Le libellé de la paire dit le sens
        de la cotation : `XAUEUR=X` vaut « une once vaut N euros ».
      */
      let perGram = perGramFromOunce(price);
      let source = candidate.symbol;

      if (candidate.currency === "USD") {
        const rates = await getEurRates();
        perGram = d(convertToEurSync(perGram, "USD", rates));
        source = `${candidate.symbol}→EUR`;
      }

      const value = Number(toFixed(perGram, 6));
      if (!Number.isFinite(value) || value <= 0) continue;
      return { eurPerGram: value, source };
    } catch {
      // Fournisseur muet ou symbole inconnu : on essaie le suivant.
    }
  }
  return null;
}

/**
 * Rafraîchit le cache si nécessaire, puis rend les cours connus.
 *
 * L'échec de récupération n'est jamais fatal : l'écran des métaux doit
 * s'afficher même sans réseau, avec la mention que le cours date.
 */
export async function getMetalSpots(
  metals: PreciousMetal[] = QUOTED_METALS,
  opts?: { now?: Date }
): Promise<MetalSpotIndex> {
  const now = opts?.now ?? new Date();
  const today = parisDayKey(now);
  const wanted = metals.filter((m) => QUOTED_METALS.includes(m));
  if (wanted.length === 0) return new Map();

  const fresh = await prisma.metalSpotPrice.findMany({
    where: { metal: { in: wanted }, day: today },
    select: { metal: true, fetchedAt: true },
  });
  const freshAt = new Map(fresh.map((r) => [r.metal, r.fetchedAt.getTime()]));

  const stale = wanted.filter((metal) => {
    const at = freshAt.get(metal);
    return at == null || now.getTime() - at > REFRESH_AFTER_MS;
  });

  for (const metal of stale) {
    const spot = await fetchMetalSpot(metal);
    if (!spot) continue;
    try {
      await prisma.metalSpotPrice.upsert({
        where: { metal_day: { metal, day: today } },
        create: {
          metal,
          day: today,
          eurPerGram: spot.eurPerGram.toString(),
          source: spot.source,
        },
        update: {
          eurPerGram: spot.eurPerGram.toString(),
          source: spot.source,
          fetchedAt: now,
        },
      });
    } catch (e) {
      console.error("[metal-spot] écriture du cache impossible", metal, e);
    }
  }

  return readMetalSpots(wanted);
}
