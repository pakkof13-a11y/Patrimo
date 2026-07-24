import { Prisma } from "@/app/lib/prisma-client/client";
import { AccountingError } from "@/app/lib/accounting/types";

/**
 * Traduction d'une exception en message destiné au client.
 *
 * Les routes renvoyaient `e.message` tel quel. C'est le bon comportement pour
 * les erreurs **métier** — la couche service lève des messages rédigés pour
 * l'utilisateur (« Quantité insuffisante… », « Plateforme source introuvable »)
 * et les masquer dégraderait l'UX. En revanche la même branche laissait passer
 * les erreurs **d'infrastructure** : une erreur Prisma expose le nom des
 * modèles, des colonnes, des contraintes, parfois des fragments de requête ou
 * d'URL de connexion. C'est une fuite d'information inutile côté client.
 *
 * On garde donc le message pour les erreurs volontaires, et on renvoie un
 * libellé générique pour tout ce qui vient de la base ou du runtime — le
 * détail complet restant journalisé côté serveur par l'appelant.
 */

/** Erreurs Prisma : jamais renvoyées telles quelles au client. */
function isInfrastructureError(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError ||
    e instanceof Prisma.PrismaClientUnknownRequestError ||
    e instanceof Prisma.PrismaClientRustPanicError ||
    e instanceof Prisma.PrismaClientInitializationError ||
    e instanceof Prisma.PrismaClientValidationError
  );
}

/**
 * Message affichable pour le client.
 * @param fallback libellé générique utilisé pour les erreurs non métier.
 */
export function clientErrorMessage(e: unknown, fallback = "Erreur"): string {
  if (isInfrastructureError(e)) return fallback;
  // Erreur comptable : code métier explicite, message déjà rédigé pour l'UI.
  if (e instanceof AccountingError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/**
 * Statut HTTP adapté : 400 pour une violation de règle métier (l'appelant peut
 * corriger sa saisie), 500 pour une panne d'infrastructure.
 */
export function clientErrorStatus(e: unknown): number {
  if (isInfrastructureError(e)) return 500;
  if (e instanceof AccountingError) return 400;
  return 500;
}

/** Détail complet pour les logs serveur (jamais renvoyé au client). */
export function serverErrorDetail(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}
