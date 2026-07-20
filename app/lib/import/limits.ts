/** Aperçu UI — ne pas confondre avec le plafond d’import réel. */
export const IMPORT_PREVIEW_MAX_ROWS = 500;

/** Commit : re-parse du CSV complet côté serveur (pas seulement l’aperçu). */
export const IMPORT_COMMIT_MAX_ROWS = 15_000;

/** Taille max du corps CSV (octets UTF-8 approx. côté length string). */
export const IMPORT_MAX_CSV_CHARS = 5_000_000;
