import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  clientErrorMessage,
  clientErrorStatus,
} from "@/app/lib/api/error-response";
import { listNftItems } from "@/app/lib/crypto/nft-service";
import {
  createNftManual,
  deleteNftItem,
  NftInputError,
} from "@/app/lib/crypto/nft-manual-service";
import { NFT_STANDARDS } from "@/app/lib/crypto/nft-constants";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+([.,]\d+)?$/, "Nombre invalide")
  .transform((v) => v.replace(",", "."));

/** GET — galerie des NFT. `?hidden=1` inclut les NFT masqués. */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const includeHidden = new URL(req.url).searchParams.get("hidden") === "1";

  try {
    const items = await listNftItems(userId, { includeHidden });
    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[crypto/nft GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de chargement des NFT") },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
  platformId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  tokenId: z.string().trim().min(1).max(100),
  contractAddr: z.string().trim().max(120).optional().nullable(),
  chain: z.string().trim().min(1).max(40),
  collectionName: z.string().trim().max(200).optional().nullable(),
  collectionSlug: z.string().trim().max(200).optional().nullable(),
  imageUrl: z.string().trim().max(2000).optional().nullable(),
  standard: z
    .enum(Object.keys(NFT_STANDARDS) as [string, ...string[]])
    .optional()
    .nullable(),
  quantity: decimalString.optional(),
  acquisitionPriceEur: decimalString,
  acquisitionDate: z.string().min(1),
  manualFloorPriceEur: decimalString.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/** POST — saisie manuelle d'un NFT (fonctionne sans aucune clé API). */
export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Paramètres invalides",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  try {
    const result = await createNftManual(userId, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof NftInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/nft POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Création impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}

/** DELETE — retire un NFT (?assetId=...). */
export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const assetId = new URL(req.url).searchParams.get("assetId");
  if (!assetId) {
    return NextResponse.json({ error: "Identifiant requis" }, { status: 400 });
  }

  try {
    await deleteNftItem(userId, assetId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof NftInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/nft DELETE]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Suppression impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
