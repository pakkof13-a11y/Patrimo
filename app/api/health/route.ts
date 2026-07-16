import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

/**
 * Health check léger — DB + process.
 * Utilisé par e2e / monitoring local.
 */
export async function GET() {
  const started = Date.now();
  let db: "ok" | "error" = "ok";
  let dbError: string | undefined;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    db = "error";
    dbError = e instanceof Error ? e.message : "db error";
  }

  const body = {
    ok: db === "ok",
    service: "patrimo",
    db,
    dbError,
    uptimeSec: Math.floor(process.uptime()),
    latencyMs: Date.now() - started,
    timestamp: new Date().toISOString(),
  };

  return NextResponse.json(body, {
    status: db === "ok" ? 200 : 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
