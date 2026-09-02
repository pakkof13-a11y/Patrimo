/**
 * Reconnaissance d'une requête de tâche planifiée.
 *
 * ## Deux questions, volontairement séparées
 *
 * - « Cette requête **prétend-elle** être un cron ? » → `hasCronCredential`.
 *   Question de forme, sans secret : lisible partout, y compris dans le proxy.
 * - « Ce cron est-il **authentique** ? » → `timingSafeEqualSecret` dans le
 *   handler, en temps constant.
 *
 * Le proxy `auth.ts` couvre `/api/**` et redirige vers `/login` toute requête
 * sans session. Une tâche Vercel Cron n'en a pas : elle n'apporte qu'un
 * en-tête. Elle n'atteignait donc jamais son handler — le cron des intérêts de
 * livrets, pourtant documenté, ne pouvait pas s'exécuter.
 *
 * Le proxy s'appuie sur la question de forme pour cesser de rediriger ; c'est
 * le handler qui décide. Comparer le secret aux deux endroits créerait deux
 * autorités pour une seule décision, et `timingSafeEqualSecret` dépend de
 * `node:crypto`, dont la disponibilité dans le proxy n'est pas garantie.
 *
 * Conséquence assumée : un en-tête inventé franchit le proxy sur les seuls
 * chemins de cron, et se fait refuser 401 par le handler. Il n'obtient rien.
 */

/** En-tête alternatif, pour les ordonnanceurs qui ne posent pas `Authorization`. */
export const CRON_SECRET_HEADER = "x-cron-secret";

/** Jeton porté par la requête, sans jugement sur sa validité. */
export function readCronCredential(req: {
  headers: { get(name: string): string | null };
}): string | null {
  const authHeader = req.headers.get("authorization") || "";
  if (authHeader.toLowerCase().startsWith("bearer ")) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const header = req.headers.get(CRON_SECRET_HEADER);
  return header?.trim() || null;
}

/** true si la requête présente une créance de cron — vraie ou fausse. */
export function hasCronCredential(req: {
  headers: { get(name: string): string | null };
}): boolean {
  return readCronCredential(req) !== null;
}

/**
 * Chemins où une créance de cron dispense de session.
 *
 * Périmètre volontairement étroit : `/api/cron/**`, répertoire réservé aux
 * tâches planifiées, et la route historique des livrets qui précède cette
 * convention. Ailleurs, un en-tête inventé n'ouvre rien — c'est ce qui empêche
 * la dispense de devenir une porte dérobée sur toute l'API.
 *
 * Les deux handlers concernés vérifient le secret eux-mêmes et répondent 401
 * s'il est faux : franchir le proxy n'est pas être autorisé.
 */
export function isCronPath(path: string): boolean {
  return path.startsWith("/api/cron/") || path === "/api/savings/accrue";
}
