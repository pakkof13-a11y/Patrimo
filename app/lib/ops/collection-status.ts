import { kvGet, kvSet } from "@/app/lib/api/kv-store";

/**
 * Trace minimale du dernier passage d'une tâche planifiée (NOTIF-01).
 *
 * Avant ceci, `GET /api/cron/collect-intraday` pouvait échouer (exception
 * non rattrapée sur `collectIntradayBars`, timeout, fournisseur en panne)
 * sans que rien n'en garde trace nulle part : le rapport détaillé n'existait
 * que dans la réponse HTTP du passage cron lui-même, jamais lue par personne.
 * Un échec de nuit restait invisible jusqu'à ce qu'un utilisateur remarque des
 * cours périmés.
 *
 * Ce n'est pas un système de notification : pas d'email, pas d'historique —
 * un seul état par tâche, écrasé à chaque passage. `getCollectionStatus`
 * rend `{ status: "never" }` tant qu'aucun passage n'a encore écrit.
 *
 * Backend : `kv-store` (Upstash si configuré, sinon mémoire process — voir
 * `app/lib/api/kv-store.ts`). Pas de table Prisma dédiée : un seul point de
 * lecture (bandeau admin), aucun besoin de requêter/joindre cet état.
 */

/** Identifiant de la tâche planifiée de collecte intraday/clôtures. */
export const COLLECT_INTRADAY_JOB = "collect-intraday";

export type CollectionRunStatus = "ok" | "ko";

export type CollectionStatusRecord = {
  status: CollectionRunStatus;
  /** ISO 8601 */
  at: string;
  /** Résumé de l'erreur — absent si `status === "ok"`. */
  message?: string;
};

export type CollectionStatusView = { status: "never" } | CollectionStatusRecord;

const KEY_PREFIX = "ops:collection-status:";

/** Message tronqué : un rapport d'erreur n'a pas à porter une stack complète. */
const MAX_MESSAGE_LENGTH = 500;

/** Enregistre l'issue du dernier passage — écrase l'état précédent. */
export async function recordCollectionRun(
  job: string,
  status: CollectionRunStatus,
  message?: string
): Promise<void> {
  const record: CollectionStatusRecord = {
    status,
    at: new Date().toISOString(),
    ...(message ? { message: message.slice(0, MAX_MESSAGE_LENGTH) } : {}),
  };
  await kvSet(KEY_PREFIX + job, JSON.stringify(record));
}

/** Lit le dernier état connu — `{ status: "never" }` si rien n'a encore écrit. */
export async function getCollectionStatus(
  job: string
): Promise<CollectionStatusView> {
  const raw = await kvGet(KEY_PREFIX + job);
  if (!raw) return { status: "never" };

  try {
    const parsed = JSON.parse(raw) as Partial<CollectionStatusRecord>;
    if (
      (parsed.status !== "ok" && parsed.status !== "ko") ||
      typeof parsed.at !== "string"
    ) {
      return { status: "never" };
    }
    return {
      status: parsed.status,
      at: parsed.at,
      ...(typeof parsed.message === "string" ? { message: parsed.message } : {}),
    };
  } catch {
    // Valeur corrompue/illisible : mieux vaut « jamais lancée » qu'un throw
    // qui ferait tomber le bandeau admin.
    return { status: "never" };
  }
}
