/**
 * T-2 — pourquoi un fournisseur n'a rien rendu.
 *
 * Les fetchers d'historique (`price-history.ts`) répondent `null` aussi bien
 * quand le fournisseur ne connaît pas l'instrument que quand il a refusé
 * l'appel (429, timeout, clé invalide). Confondre les deux produisait un
 * rapport de backfill `assetsFilled: 0, errors: []` : un quota dépassé y était
 * indiscernable d'un « rien à collecter ».
 *
 * Ce module ouvre un canal parallèle au retour de fonction : un fetcher
 * *signale* un refus, sans changer sa signature ni casser le repli vers un
 * autre fournisseur. L'appelant qui veut savoir (le backfill) englobe son
 * traitement dans `collectProviderIncidents` ; tous les autres (les graphiques)
 * ne voient rien changer.
 *
 * L'absence de donnée, elle, ne signale rien : US100 (CFD) et l'OAT
 * FR0013313582 (ISIN seul) n'ont pas de cours chez Yahoo, et c'est un fait
 * stable, pas un incident. Les faire remonter chaque nuit remplacerait un
 * silence par du bruit.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { CoingeckoHttpError } from "./providers/coingecko";

export type ProviderIncidentReason =
  /** Le fournisseur a répondu, mais en refusant : 429, 401, 5xx. */
  | "refused"
  /** Aucune réponse dans le délai imparti. */
  | "timeout"
  /** Erreur réseau / transport : DNS, socket, TLS. */
  | "transport";

export type ProviderIncident = {
  provider: string;
  reason: ProviderIncidentReason;
  message: string;
  status?: number;
};

const store = new AsyncLocalStorage<ProviderIncident[]>();

/**
 * Classe une exception de fetcher.
 *
 * Rend `null` quand rien ne prouve un refus : mieux vaut taire un incident
 * douteux que polluer `errors[]` à chaque passage sur un actif sans cours.
 */
export function classifyProviderError(
  provider: string,
  err: unknown
): ProviderIncident | null {
  if (err instanceof CoingeckoHttpError) {
    // 404 : la pièce n'existe pas chez CoinGecko — absence, pas refus.
    if (err.status === 404) return null;
    return {
      provider,
      reason: err.status === 408 || err.status === 504 ? "timeout" : "refused",
      message: err.message,
      status: err.status,
    };
  }

  if (!(err instanceof Error)) return null;

  const name = err.name;
  const message = err.message;

  if (
    name === "TimeoutError" ||
    name === "AbortError" ||
    /timed out|timeout/i.test(message)
  ) {
    return { provider, reason: "timeout", message };
  }

  // Yahoo répond « Not Found » / « No data found » pour un symbole inconnu :
  // l'instrument n'est pas couvert, ce n'est pas une défaillance.
  if (/not found|no data|invalid symbol|404/i.test(message)) return null;

  if (
    /rate limit|too many requests|429|quota/i.test(message) ||
    /\b5\d{2}\b/.test(message)
  ) {
    return { provider, reason: "refused", message };
  }

  if (
    name === "TypeError" ||
    name === "FetchError" ||
    /fetch failed|network|ECONN|ENOTFOUND|socket|EAI_AGAIN/i.test(message)
  ) {
    return { provider, reason: "transport", message };
  }

  // Une exception inattendue reste une défaillance : la taire reproduirait le
  // silence que ce module existe pour supprimer.
  return { provider, reason: "transport", message };
}

/** Signale un refus fournisseur, si un collecteur écoute. */
export function recordProviderIncident(incident: ProviderIncident | null): void {
  if (!incident) return;
  store.getStore()?.push(incident);
}

/** Classe puis signale, en un geste — la forme utilisée dans les `catch`. */
export function reportProviderError(provider: string, err: unknown): void {
  recordProviderIncident(classifyProviderError(provider, err));
}

/**
 * Exécute `fn` en écoutant les refus fournisseurs qu'elle provoque.
 * Hors de cette portée, `recordProviderIncident` est un no-op.
 */
export async function collectProviderIncidents<T>(
  fn: () => Promise<T>
): Promise<{ result: T; incidents: ProviderIncident[] }> {
  const incidents: ProviderIncident[] = [];
  const result = await store.run(incidents, fn);
  return { result, incidents };
}

/** Résumé lisible dans un rapport : « coingecko refused: Quota dépassé ». */
export function summarizeIncidents(incidents: ProviderIncident[]): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const i of incidents) {
    const key = `${i.provider} ${i.reason}: ${i.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    parts.push(key);
  }
  return parts.join(" · ");
}
