import { d, toFixed, type DecimalInput } from "../money/decimal";

type CacheEntry = {
  rates: Record<string, number>;
  fetchedAt: number;
  /** true si `rates` provient du FALLBACK statique (Frankfurter indisponible). */
  isFallback: boolean;
};

let cache: CacheEntry | null = null;
let inflight: Promise<Record<string, number>> | null = null;
/** Instant du dernier échec fournisseur, 0 si le dernier appel a abouti. */
let lastFailureAt = 0;

const TTL_MS = 60 * 60 * 1000;

/**
 * Délai minimal entre deux tentatives après un échec.
 *
 * Le repli écrivait `fetchedAt: 0`, ce qui rendait l'entrée perpétuellement
 * périmée : chaque lecture relançait un appel sortant, avec 2 500 ms de budget.
 * Mesuré sur une suite E2E de 27 minutes, 1 913 tentatives — environ soixante-
 * dix par minute, pour une donnée qui ne bouge pas en une heure.
 *
 * Une minute borne le débit à une tentative par minute et par processus, soit
 * une soixantaine de fois moins. C'est assez court pour que le retour du
 * fournisseur soit vu presque tout de suite, et assez long pour cesser de le
 * marteler pendant qu'il est à terre.
 */
const RETRY_AFTER_ERROR_MS = 60 * 1000;

/**
 * Âge au-delà duquel des taux réels cessent d'être servis, même en panne.
 *
 * Le repli ne doit pas devenir un cache permanent. Une journée est la borne
 * retenue : les grandes devises bougent de l'ordre du demi-pourcent par jour,
 * si bien qu'un taux de la veille reste une bien meilleure approximation que la
 * table figée ci-dessous — laquelle peut dériver de plusieurs pourcents en
 * quelques mois. Passé ce délai, en revanche, on ne peut plus prétendre que la
 * valeur décrit le marché du jour, et la table déclarée reprend la main.
 */
const STALE_MAX_MS = 24 * 60 * 60 * 1000;
const FALLBACK: Record<string, number> = {
  EUR: 1,
  USD: 1.08,
  CHF: 0.96,
  GBP: 0.85,
  JPY: 160,
};

/**
 * Rates as 1 EUR = X foreign.
 * Never hangs the UI: short timeout + shared inflight + fallback.
 *
 * NOTE multi-lambda (Vercel) : ce cache est process-local. Deux lambdas
 * peuvent servir des taux légèrement différents pendant la fenêtre TTL.
 * Si la précision FX inter-lambda devient critique (ex. cohérence stricte
 * entre deux refresh utilisateur simultanés), partager ce cache via Upstash
 * (déjà utilisé pour le rate-limit, cf. app/lib/api/kv-store.ts).
 */
export async function getEurRates(): Promise<Record<string, number>> {
  const now = Date.now();

  // Taux réels encore frais : rien à demander.
  if (cache && !cache.isFallback && now - cache.fetchedAt < TTL_MS) {
    return cache.rates;
  }

  /*
    Panne récente : on sert ce qu'on a plutôt que de refrapper à la porte.

    Ce palier est toute la correction. Sans lui, une indisponibilité
    transformait chaque lecture — et il y a dix appelants, dont le chargement de
    l'historique et les soldes de plateformes — en un aller-retour réseau voué à
    échouer.

    Ce qui est servi dépend de ce qu'on détient : des taux réels tant qu'ils ont
    moins d'un jour, la table déclarée sinon.
  */
  if (cache && now - lastFailureAt < RETRY_AFTER_ERROR_MS) {
    if (cache.isFallback || now - cache.fetchedAt < STALE_MAX_MS) {
      return cache.rates;
    }
  }

  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch("https://api.frankfurter.app/latest?from=EUR", {
        cache: "no-store",
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) throw new Error(`FX HTTP ${res.status}`);
      const data = (await res.json()) as { rates?: Record<string, number> };
      const rates = { EUR: 1, ...FALLBACK, ...(data.rates ?? {}) };
      cache = { rates, fetchedAt: Date.now(), isFallback: false };
      // Le fournisseur répond : la fenêtre de repli n'a plus lieu d'être.
      lastFailureAt = 0;
      return rates;
    } catch (e) {
      console.warn(
        "[fx] Frankfurter indisponible — fallback taux statiques",
        e instanceof Error ? e.message : e
      );
      const echecAt = Date.now();
      lastFailureAt = echecAt;

      /*
        Les derniers taux réels valent mieux qu'une table figée.

        Le repli les écrasait : un fournisseur tombé cinq minutes après une
        réponse correcte faisait basculer l'application sur des valeurs
        approchées, alors qu'elle venait de connaître les vraies. On les
        conserve tant qu'ils ont moins d'un jour.
      */
      if (
        cache &&
        !cache.isFallback &&
        echecAt - cache.fetchedAt < STALE_MAX_MS
      ) {
        return cache.rates;
      }

      const rates = { ...FALLBACK };
      cache = { rates, fetchedAt: echecAt, isFallback: true };
      return rates;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

/**
 * Aucun taux fondé n'existe pour cette devise.
 *
 * Distincte d'une panne réseau : le fournisseur peut très bien avoir répondu.
 * Elle dit qu'aucune source — taux vivants, cache, table déclarée — ne permet
 * d'affirmer combien vaut une unité de cette devise.
 */
export class FxRateUnknownError extends Error {
  readonly currency: string;
  constructor(currency: string) {
    super(
      `Taux ${currency}→EUR indisponible : aucune source ne permet de le fonder.`
    );
    this.name = "FxRateUnknownError";
    this.currency = currency;
  }
}

/**
 * Combien d'unités de `cur` pour un euro, ou `null` si rien ne le fonde.
 *
 * Le dernier maillon était `?? 1`. Pour une devise absente à la fois des taux
 * servis et de la table déclarée — couronne suédoise, zloty, livre turque —, il
 * affirmait une parité avec l'euro. Mesuré : 1 000 SEK convertis en 1 000 €,
 * soit onze fois leur valeur, et ce montant pouvait être persisté.
 *
 * Les cinq entrées de la table restent des replis légitimes, assumés et
 * documentés. Ce qui disparaît est le sixième cas, celui qu'aucune source ne
 * fonde : il vaut désormais « inconnu », jamais « un ».
 */
function rateOf(cur: string, rates: Record<string, number>): number | null {
  if (cur === "EUR") return 1;
  const rate = rates[cur] ?? FALLBACK[cur];
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;
  return rate;
}

export function convertFromEurSync(
  amountEur: DecimalInput,
  to: string,
  rates: Record<string, number>
): string {
  const cur = to.toUpperCase();
  if (cur === "EUR") return toFixed(d(amountEur), 12);
  const rate = rateOf(cur, rates);
  if (rate == null) throw new FxRateUnknownError(cur);
  return toFixed(d(amountEur).times(rate), 12);
}

export function convertToEurSync(
  amount: DecimalInput,
  from: string,
  rates: Record<string, number>
): string {
  const cur = from.toUpperCase();
  if (cur === "EUR") return toFixed(d(amount), 12);
  const rate = rateOf(cur, rates);
  if (rate == null) throw new FxRateUnknownError(cur);
  return toFixed(d(amount).div(rate), 12);
}

export async function toEurAmount(amount: DecimalInput, from: string): Promise<string> {
  const rates = await getEurRates();
  return convertToEurSync(amount, from, rates);
}

export async function fromEurAmount(amountEur: DecimalInput, to: string): Promise<string> {
  const rates = await getEurRates();
  return convertFromEurSync(amountEur, to, rates);
}

export async function fxRateToEur(from: string): Promise<string> {
  const cur = from.toUpperCase();
  if (cur === "EUR") return "1";
  const rates = await getEurRates();
  const rate = rateOf(cur, rates);
  if (rate == null) throw new FxRateUnknownError(cur);
  return toFixed(d(1).div(rate), 10);
}

/**
 * Taux historique : 1 unité `from` → EUR, pour une date donnée (YYYY-MM-DD).
 *
 * Source Frankfurter (BCE), et elle seule. Rend `null` quand le taux de cette
 * date n'est pas démontré — fournisseur injoignable, délai dépassé, date hors
 * série, devise absente de la réponse.
 *
 * ## Pourquoi aucun repli
 *
 * Cette fonction rendait `fxRateToEur(cur)` en cas d'échec, c'est-à-dire le
 * taux **du jour** — lequel, depuis le cache dégradé, peut lui-même être la
 * table statique déclarée plus haut. Un dividende de 2021 pouvait donc être
 * converti à 1,08 USD et le résultat écrit dans `Transaction.fxRateToEur`, où
 * plus rien ne le distinguait d'un taux réellement constaté. L'écart valait la
 * dérive entre les deux dates, sans borne.
 *
 * Le taux courant et le taux historique répondent à deux questions
 * différentes. Le repli du premier n'a pas à contaminer le second : quand la
 * date n'est pas documentée, la seule réponse vraie est « je ne sais pas », et
 * c'est à l'appelant de décider quoi en faire. Aucun appelant n'a le droit de
 * la remplacer par une approximation.
 */
export async function fxRateToEurOnDate(
  from: string,
  date: Date | string
): Promise<string | null> {
  const cur = from.toUpperCase();
  if (cur === "EUR") return "1";

  const day =
    typeof date === "string"
      ? date.slice(0, 10)
      : date.toISOString().slice(0, 10);

  try {
    // Frankfurter: 1 EUR = X foreign
    const res = await fetch(
      `https://api.frankfurter.app/${day}?from=EUR&to=${encodeURIComponent(cur)}`,
      { cache: "no-store", signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> };
      const rate = data.rates?.[cur];
      if (rate && rate > 0) {
        return toFixed(d(1).div(rate), 10);
      }
    }
  } catch {
    // Réseau, délai dépassé, réponse illisible : rien n'est démontré.
  }
  return null;
}

export async function convertAmount(
  amount: DecimalInput,
  from: string,
  to: string
): Promise<string> {
  if (from.toUpperCase() === to.toUpperCase()) return toFixed(d(amount), 12);
  const rates = await getEurRates();
  const eur = convertToEurSync(amount, from, rates);
  return convertFromEurSync(eur, to, rates);
}
