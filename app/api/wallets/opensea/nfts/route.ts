import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { safeParseBody } from "@/app/lib/api/validation";
import { consumeRateLimit } from "@/app/lib/api/simple-rate-limit";
import {
  fetchAllNftsByAccount,
  fetchNftsByAccount,
  getOpenSeaChain,
  OpenSeaError,
} from "@/app/lib/opensea";

/**
 * GET /api/wallets/opensea/nfts?address=0x…&chain=ethereum&limit=50
 * POST /api/wallets/opensea/nfts { address, chain?, collection?, limit?, next?, allPages? }
 *
 * Liste les NFT d’un wallet via OpenSea API v2.
 * Auth session requise. Clé : OPENSEA_API_KEY ou auto free-tier (POST /auth/keys).
 */

export const maxDuration = 60;

const querySchema = z.object({
  address: z.string().min(1),
  chain: z.string().optional().nullable(),
  collection: z.string().optional().nullable(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  next: z.string().optional().nullable(),
  allPages: z
    .union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false")])
    .optional(),
});

const bodySchema = z.object({
  address: z.string().min(1),
  chain: z.string().optional().nullable(),
  collection: z.string().optional().nullable(),
  limit: z.number().int().min(1).max(200).optional(),
  next: z.string().optional().nullable(),
  allPages: z.boolean().optional(),
  maxPages: z.number().int().min(1).max(20).optional(),
  apiKey: z.string().optional().nullable(),
});

function isEvmAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr.trim());
}

function isSolanaAddress(addr: string): boolean {
  // Base58, 32–44 chars — validation légère
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr.trim());
}

async function handle(
  input: z.infer<typeof bodySchema>
): Promise<NextResponse> {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const rl = await consumeRateLimit(`opensea-nfts:${userId}`, 10, 60_000);
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

  const address = input.address.trim();
  const chainMeta = getOpenSeaChain(input.chain);
  const isSol = chainMeta.openseaChain === "solana";

  if (isSol) {
    if (!isSolanaAddress(address)) {
      return NextResponse.json(
        {
          error: "Adresse Solana invalide pour OpenSea",
          code: "INVALID_ADDRESS",
        },
        { status: 400 }
      );
    }
  } else if (!isEvmAddress(address)) {
    return NextResponse.json(
      {
        error:
          "Adresse EVM invalide (0x + 40 hex). Pour Solana, passez chain=solana.",
        code: "INVALID_ADDRESS",
      },
      { status: 400 }
    );
  }

  try {
    if (input.allPages) {
      const page = await fetchAllNftsByAccount(address, {
        chain: input.chain,
        collection: input.collection,
        limit: input.limit,
        maxPages: input.maxPages,
        apiKey: input.apiKey,
      });
      return NextResponse.json({
        ok: true,
        source: "opensea",
        chain: {
          presetKey: chainMeta.presetKey,
          label: chainMeta.label,
          openseaChain: chainMeta.openseaChain,
        },
        ...page,
        summary: {
          count: page.nfts.length,
          truncated: page.truncated,
          pageCount: page.pageCount,
        },
      });
    }

    const page = await fetchNftsByAccount(address, {
      chain: input.chain,
      collection: input.collection,
      limit: input.limit,
      next: input.next,
      apiKey: input.apiKey,
    });

    return NextResponse.json({
      ok: true,
      source: "opensea",
      chain: {
        presetKey: chainMeta.presetKey,
        label: chainMeta.label,
        openseaChain: chainMeta.openseaChain,
      },
      ...page,
      summary: {
        count: page.nfts.length,
        hasMore: Boolean(page.next),
      },
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
          hint:
            e.code === "CONFIG" || e.code === "AUTH"
              ? "Configurez OPENSEA_API_KEY (portail OpenSea) ou laissez OPENSEA_AUTO_KEY=true pour une clé free-tier."
              : undefined,
        },
        { status }
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[opensea-nfts]", msg);
    return NextResponse.json(
      {
        error: "Échec OpenSea NFT",
        code: "OPENSEA_UNAVAILABLE",
        source: "opensea",
      },
      { status: 502 }
    );
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = {
    address: url.searchParams.get("address") || "",
    chain: url.searchParams.get("chain"),
    collection: url.searchParams.get("collection"),
    limit: url.searchParams.get("limit") || undefined,
    next: url.searchParams.get("next"),
    allPages: url.searchParams.get("allPages") || undefined,
  };
  const parsed = querySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Paramètres invalides — address requis",
        details: parsed.error.flatten(),
      },
      { status: 400 }
    );
  }
  const allPages =
    parsed.data.allPages === "1" || parsed.data.allPages === "true";
  return handle({
    address: parsed.data.address,
    chain: parsed.data.chain,
    collection: parsed.data.collection,
    limit: parsed.data.limit,
    next: parsed.data.next,
    allPages,
  });
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
  return handle(parsed.data);
}
