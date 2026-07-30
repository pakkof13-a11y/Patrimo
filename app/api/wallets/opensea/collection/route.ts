import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { safeParseBody } from "@/app/lib/api/validation";
import { consumeRateLimit } from "@/app/lib/api/simple-rate-limit";
import { fetchCollectionStats, OpenSeaError } from "@/app/lib/opensea";

/**
 * GET /api/wallets/opensea/collection?slug=boredapeyachtclub
 * POST /api/wallets/opensea/collection { slug, apiKey? }
 *
 * Stats collection OpenSea (floor, volume, owners…).
 */

const querySchema = z.object({
  slug: z.string().min(1),
});

const bodySchema = z.object({
  slug: z.string().min(1),
  apiKey: z.string().optional().nullable(),
});

async function handle(slug: string, apiKey?: string | null) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const rl = await consumeRateLimit(`opensea-coll:${userId}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      {
        error: "Trop de requêtes OpenSea — réessayez dans un instant",
        code: "RATE_LIMITED",
        retryAfterSec: rl.retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec) },
      }
    );
  }

  try {
    const stats = await fetchCollectionStats(slug, { apiKey });
    return NextResponse.json({
      ok: true,
      source: "opensea",
      stats,
    });
  } catch (e) {
    if (e instanceof OpenSeaError) {
      const status =
        e.code === "AUTH"
          ? 401
          : e.code === "RATE_LIMIT"
            ? 429
            : e.code === "CONFIG"
              ? 400
              : 502;
      return NextResponse.json(
        {
          error: e.message,
          code: e.code,
          source: "opensea",
        },
        { status }
      );
    }
    console.error(
      "[opensea-collection]",
      e instanceof Error ? e.message : e
    );
    return NextResponse.json(
      {
        error: "Échec OpenSea collection stats",
        code: "OPENSEA_UNAVAILABLE",
        source: "opensea",
      },
      { status: 502 }
    );
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    slug: url.searchParams.get("slug") || "",
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Paramètre slug requis", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  return handle(parsed.data.slug);
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }
  const parsed = safeParseBody(bodySchema, json);
  if (!parsed.success) return parsed.response;
  return handle(parsed.data.slug, parsed.data.apiKey);
}
