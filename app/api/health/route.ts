import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { serverErrorDetail } from "@/app/lib/api/error-response";
import {
  getDeployBlockingConfigIssues,
  getDeployConfigWarnings,
  getRuntimeEnvStatus,
} from "@/app/lib/env/runtime";

/**
 * Health check léger — DB + process + flags config (sans secrets).
 * Public (middleware allowlist) — ne pas exposer de détails d’erreur DB en déployé.
 */
export async function GET() {
  const started = Date.now();
  let db: "ok" | "error" = "ok";
  let dbError: string | undefined;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    db = "error";
    // Détail uniquement en développement local (évite fuite infra en test/prod)
    if (process.env.NODE_ENV === "development" && !process.env.VERCEL) {
      // Déjà borné au dev local : on veut ici le détail brut de l'erreur DB.
      dbError = serverErrorDetail(e);
    }
  }

  const env = getRuntimeEnvStatus();
  const configIssues = getDeployBlockingConfigIssues();
  const configWarnings = getDeployConfigWarnings();
  const configOk = configIssues.length === 0;

  const body = {
    ok: db === "ok" && (env.isDeployedLike ? configOk : true),
    service: "patrimo",
    db,
    ...(dbError ? { dbError } : {}),
    uptimeSec: Math.floor(process.uptime()),
    latencyMs: Date.now() - started,
    timestamp: new Date().toISOString(),
    /**
     * Ce serveur a-t-il été lancé pour les tests de bout en bout ?
     *
     * Playwright réutilise un serveur déjà à l'écoute sur le port. Si celui-ci
     * est un `npm run dev` ordinaire, la suite s'exécute alors contre la base
     * de **travail** au lieu de la base isolée : les fixtures s'y accumulent,
     * et les tests finissent par échouer pour une raison qui n'a rien à voir
     * avec le code. Ce drapeau permet au `globalSetup` de refuser tout de
     * suite plutôt que de laisser croire à une régression.
     */
    e2e: process.env.E2E === "1",
    env: {
      nodeEnv: env.nodeEnv,
      authSecretConfigured: env.authSecretConfigured,
      databaseUrlConfigured: env.databaseUrlConfigured,
      cronSecretConfigured: env.cronSecretConfigured,
      demoFallbackEnabled: env.demoFallbackEnabled,
      deployedLike: env.isDeployedLike,
      rateLimitBackend: env.rateLimitBackend,
      authUrlConfigured: env.authUrlConfigured,
      upstashConfigured: env.upstashConfigured,
    },
    ...(configIssues.length > 0
      ? { configIssues, configOk: false }
      : { configOk: true }),
    ...(configWarnings.length > 0 ? { configWarnings } : {}),
  };

  const status =
    db !== "ok" ? 503 : env.isDeployedLike && !configOk ? 503 : 200;

  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
