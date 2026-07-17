/**
 * Identifiants seed / comptes bootstrap — jamais de mots de passe en dur.
 * Serveur / scripts uniquement (dotenv chargé par le seed).
 */

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `[config] Variable d'environnement manquante : ${name}.\n` +
        `  → Définissez-la dans .env (voir .env.example).\n` +
        `  → Pour le seed local : ADMIN_PASSWORD et DEMO_PASSWORD sont obligatoires.`
    );
  }
  return v;
}

function optionalEnv(name: string, fallback: string): string {
  const v = process.env[name]?.trim();
  return v || fallback;
}

/** Identifiants non secrets (logins publics) + mots de passe depuis l'env. */
export type SeedCredentials = {
  adminUsername: string;
  adminEmail: string;
  adminPassword: string;
  demoUsername: string;
  demoEmail: string;
  demoPassword: string;
};

/**
 * Charge les credentials de seed. Échoue explicitement si un mot de passe manque.
 * Ne jamais logger `adminPassword` / `demoPassword`.
 */
export function loadSeedCredentials(): SeedCredentials {
  return {
    adminUsername: optionalEnv("ADMIN_USERNAME", "admin"),
    adminEmail: optionalEnv("ADMIN_EMAIL", "admin@patrimo.local"),
    adminPassword: requireEnv("ADMIN_PASSWORD"),
    demoUsername: optionalEnv("DEMO_USERNAME", "demo"),
    demoEmail: optionalEnv("DEMO_EMAIL", "demo@patrimo.fr"),
    demoPassword: requireEnv("DEMO_PASSWORD"),
  };
}

/**
 * Mot de passe E2E (Playwright). Préfère E2E_PASS, sinon DEMO_PASSWORD.
 */
export function loadE2ePassword(): string {
  const pass =
    process.env.E2E_PASS?.trim() || process.env.DEMO_PASSWORD?.trim();
  if (!pass) {
    throw new Error(
      `[config] E2E_PASS (ou DEMO_PASSWORD) manquant.\n` +
        `  → Définissez E2E_PASS dans .env pour Playwright (voir .env.example).`
    );
  }
  return pass;
}

export function loadE2eUsername(): string {
  return (
    process.env.E2E_USER?.trim() ||
    process.env.DEMO_USERNAME?.trim() ||
    "demo"
  );
}
