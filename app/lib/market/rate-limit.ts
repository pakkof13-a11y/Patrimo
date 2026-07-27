/**
 * Budget d'appels réseau à fenêtre glissante.
 *
 * Motivation : `refreshEligiblePrices` lançait tous les actifs « actions » en
 * `Promise.all` sans borne. Un portefeuille de 80 lignes déclenchait donc 80
 * requêtes Finnhub simultanées, alors que le free tier plafonne à 60 appels par
 * minute — le quota partait en fumée dès le premier refresh, et Finnhub répond
 * alors 429 sur tout le reste de la minute.
 *
 * ## Fenêtre glissante, pas seau à jetons
 *
 * Finnhub compte les appels sur une fenêtre glissante : ce qui importe est le
 * nombre de requêtes dans les 60 dernières secondes, à tout instant. Un seau à
 * jetons classique (recharge continue) autoriserait des rafales dépassant la
 * limite en bord de fenêtre. On mémorise donc les horodatages des appels admis
 * et on refuse dès que la fenêtre en contient déjà `limit`.
 *
 * ## Sérialisation
 *
 * Les acquisitions sont mises en file. Sans cela, N appelants concurrents
 * observeraient tous la même fenêtre creuse au même instant et entreraient
 * ensemble : le compteur serait juste, la limite franchie quand même. Chaque
 * `acquire()` attend donc son tour avant de tester la fenêtre.
 *
 * Horloge et attente sont injectables pour que les tests soient déterministes
 * et instantanés — aucun test ne doit dormir une minute pour vérifier une
 * fenêtre d'une minute.
 */

export type RateLimiterOptions = {
  /** Nombre maximal d'appels admis dans la fenêtre. */
  limit: number;
  /** Largeur de la fenêtre glissante, en millisecondes. */
  windowMs: number;
  /** Horloge — injectable pour les tests. */
  now?: () => number;
  /** Attente — injectable pour les tests. */
  sleep?: (ms: number) => Promise<void>;
};

export type RateLimiter = {
  /** Attend qu'un jeton soit disponible, puis le consomme. */
  acquire(): Promise<void>;
  /** Consomme un jeton s'il y en a un tout de suite ; sinon `false`, sans attendre. */
  tryAcquire(): boolean;
  /** Nombre d'appels actuellement comptés dans la fenêtre. */
  used(): number;
  /** Jetons encore disponibles à cet instant. */
  available(): number;
  /** Vide la fenêtre (tests, redémarrage à chaud). */
  reset(): void;
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = opts;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? defaultSleep;

  if (limit <= 0) throw new Error("limit doit être strictement positif");
  if (windowMs <= 0) throw new Error("windowMs doit être strictement positif");

  /** Horodatages des appels admis, du plus ancien au plus récent. */
  let hits: number[] = [];
  /** Queue de sérialisation : chaque acquisition attend la précédente. */
  let tail: Promise<void> = Promise.resolve();

  function prune(t: number): void {
    const cutoff = t - windowMs;
    // Les horodatages sont croissants : il suffit de couper le préfixe expiré.
    let i = 0;
    while (i < hits.length && hits[i]! <= cutoff) i++;
    if (i > 0) hits = hits.slice(i);
  }

  function tryAcquire(): boolean {
    const t = now();
    prune(t);
    if (hits.length >= limit) return false;
    hits.push(t);
    return true;
  }

  async function waitForSlot(): Promise<void> {
    // Boucle plutôt qu'une attente unique : après le réveil, un autre appelant
    // peut avoir pris la place libérée, et l'horloge injectée des tests peut ne
    // pas avoir avancé exactement comme prévu.
    for (;;) {
      const t = now();
      prune(t);
      if (hits.length < limit) {
        hits.push(t);
        return;
      }
      const oldest = hits[0]!;
      // +1 ms pour tomber juste après l'expiration, pas pile dessus.
      const waitMs = Math.max(1, oldest + windowMs - t + 1);
      await sleep(waitMs);
    }
  }

  function acquire(): Promise<void> {
    const turn = tail.then(waitForSlot);
    // La file ne doit jamais rester bloquée sur un rejet.
    tail = turn.then(
      () => undefined,
      () => undefined
    );
    return turn;
  }

  return {
    acquire,
    tryAcquire,
    used(): number {
      prune(now());
      return hits.length;
    },
    available(): number {
      prune(now());
      return Math.max(0, limit - hits.length);
    },
    reset(): void {
      hits = [];
      tail = Promise.resolve();
    },
  };
}

/**
 * Free tier Finnhub : 60 appels REST par minute.
 *
 * On garde une marge : le compteur de Finnhub et le nôtre ne démarrent pas au
 * même instant, et une requête peut lui parvenir un peu après avoir été admise
 * ici. Viser exactement 60 revient à jouer avec le bord de la fenêtre pour rien.
 */
export const FINNHUB_REST_LIMIT_PER_MINUTE = 55;

/** Budget partagé par tous les appels REST Finnhub du processus. */
export const finnhubRestLimiter: RateLimiter = createRateLimiter({
  limit: FINNHUB_REST_LIMIT_PER_MINUTE,
  windowMs: 60_000,
});

/**
 * Free tier OpenSea (clé obtenue via `POST /api/v2/auth/keys`, sans
 * inscription) : 4 requêtes GET par seconde, 2 POST par seconde. Aurea ne
 * fait que du GET (floor price, NFT d'un wallet) — seul ce budget est câblé.
 *
 * Comme pour Finnhub, on garde une marge (3 au lieu de 4) : la fenêtre
 * d'OpenSea et la nôtre ne démarrent pas au même instant.
 */
export const OPENSEA_GET_LIMIT_PER_SECOND = 3;

/** Budget partagé par tous les appels GET OpenSea du processus. */
export const openSeaGetLimiter: RateLimiter = createRateLimiter({
  limit: OPENSEA_GET_LIMIT_PER_SECOND,
  windowMs: 1_000,
});
