/**
 * Type de plateforme accueillant les biens immobiliers.
 *
 * Isolé dans son propre module : `property-service.ts` importe Prisma, donc
 * l'exposer depuis là forcerait les composants client à tirer le client de
 * base de données dans le bundle navigateur pour une simple chaîne.
 */
export const REAL_ESTATE_PLATFORM_TYPE = "NOTAIRE_IMMOBILIER";
