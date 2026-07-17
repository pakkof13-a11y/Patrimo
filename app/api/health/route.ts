import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  getDeployBlockingConfigIssues,
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
      dbError = e instanceof Error ? e.message : "db error";
    }
  }

  const env = getRuntimeEnvStatus();
  const configIssues = getDeployBlockingConfigIssues();
  const configOk = configIssues.length === 0;

  const body = {
    ok: db === "ok" && (env.isDeployedLike ? configOk : true),
    service: "patrimo",
    db,
    ...(dbError ? { dbError } : {}),
    uptimeSec: Math.floor(process.uptime()),
    latencyMs: Date.now() - started,
    timestamp: new Date().toISOString(),
    env: {
      nodeEnv: env.nodeEnv,
      authSecretConfigured: env.authSecretConfigured,
      databaseUrlConfigured: env.databaseUrlConfigured,
      cronSecretConfigured: env.cronSecretConfigured,
      demoFallbackEnabled: env.demoFallbackEnabled,
      deployedLike: env.isDeployedLike,
    },
    ...(configIssues.length > 0
      ? { configIssues, configOk: false }
      : { configOk: true }),
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
