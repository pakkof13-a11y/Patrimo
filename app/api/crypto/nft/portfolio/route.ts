import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage, clientErrorStatus } from "@/app/lib/api/error-response";
import { getNftPortfolio } from "@/app/lib/crypto/nft-portfolio-service";
import { NFT_STANDARDS, NFT_CATEGORIES, NFT_HOLDING_STATUSES } from "@/app/lib/crypto/nft-taxonomy";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const boolFlag = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

const querySchema = z.object({
  chain: z.string().trim().min(1).max(40).optional(),
  standard: z.enum(Object.keys(NFT_STANDARDS) as [string, ...string[]]).optional(),
  collectionId: z.string().min(1).optional(),
  category: z.enum(Object.keys(NFT_CATEGORIES) as [string, ...string[]]).optional(),
  platformId: z.string().min(1).optional(),
  status: z.enum(Object.keys(NFT_HOLDING_STATUSES) as [string, ...string[]]).optional(),
  ownerLabel: z.string().trim().min(1).max(120).optional(),
  isHidden: boolFlag,
  isIgnoredInPortfolio: boolFlag,
  includeInactive: boolFlag,
});

/**
 * GET /api/crypto/nft/portfolio
 *
 * Vue enrichie des détentions NFT : identité + collection + valorisation +
 * agrégats par chaîne / collection / catégorie + conflits de double compte.
 *
 * Distincte de `GET /api/crypto/nft`, la vue historique consommée par la
 * galerie existante — deux routes plutôt qu'une réponse élargie, même
 * raison que côté DeFi (F1).
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Filtres invalides",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      },
      { status: 400 }
    );
  }

  try {
    const bundle = await getNftPortfolio(userId, parsed.data);
    return NextResponse.json(bundle, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[crypto/nft/portfolio GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Chargement du portefeuille NFT impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
