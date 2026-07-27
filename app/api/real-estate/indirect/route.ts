import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import {
  createIndirectHolding,
  IndirectInputError,
} from "@/app/lib/real-estate/indirect-service";
import { loadIndirectRows } from "@/app/lib/real-estate/tax/service";
import { INDIRECT_VEHICLES, TAX_TRANSPARENCY } from "@/app/lib/real-estate/indirect";
import { clientErrorMessage } from "@/app/lib/api/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const createSchema = z.object({
  platformId: z.string().min(1, "Plateforme requise"),
  name: z.string().trim().min(1, "Nom requis").max(200),
  vehicle: z.enum(Object.keys(INDIRECT_VEHICLES) as [string, ...string[]]),
  manager: z.string().trim().max(200).optional().nullable(),
  isin: z.string().trim().max(20).optional().nullable(),

  shares: z.string().min(1, "Nombre de parts requis"),
  sharePriceEur: z.string().min(1, "Prix de part requis"),
  subscriptionFeesEur: z.string().optional().nullable(),
  purchaseDate: z.string().min(1, "Date d'acquisition requise"),
  currentSharePriceEur: z.string().optional().nullable(),

  distributionRatePct: z.string().optional().nullable(),
  debtRatioPct: z.string().optional().nullable(),
  realEstateSharePct: z.string().optional().nullable(),
  ownershipStakePct: z.string().optional().nullable(),
  taxTransparency: z
    .enum(Object.keys(TAX_TRANSPARENCY) as [string, ...string[]])
    .optional()
    .nullable(),
  ifiExcluded: z.boolean().optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/** GET — véhicules indirects, valeur issue du journal et part IFI calculée. */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  try {
    return NextResponse.json(
      { vehicles: await loadIndirectRows(userId) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[real-estate/indirect GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de chargement") },
      { status: 500 }
    );
  }
}

/** POST — souscription : actif, détail et transaction d'achat, en un bloc. */
export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    const result = await createIndirectHolding(userId, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof IndirectInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[real-estate/indirect POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Création impossible") },
      { status: 500 }
    );
  }
}

/** DELETE — retire le véhicule ; la position et son détail suivent l'actif. */
export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const assetId = new URL(req.url).searchParams.get("assetId");
  if (!assetId) {
    return NextResponse.json({ error: "assetId requis" }, { status: 400 });
  }

  try {
    const detail = await prisma.indirectRealEstateDetail.findFirst({
      where: { assetId, asset: { is: { userId } } },
      select: { id: true },
    });
    if (!detail) {
      return NextResponse.json({ error: "Véhicule introuvable" }, { status: 404 });
    }

    // Les transactions sont supprimées explicitement : l'actif n'est retiré
    // qu'ensuite, pour ne pas laisser d'écriture orpheline au journal.
    await prisma.$transaction(async (tx) => {
      await tx.transaction.deleteMany({ where: { userId, assetId } });
      await tx.asset.delete({ where: { id: assetId } });
    });

    const { invalidateLedgerCache } = await import(
      "@/app/lib/portfolio/ledger-cache"
    );
    invalidateLedgerCache(userId);

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[real-estate/indirect DELETE]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Suppression impossible") },
      { status: 500 }
    );
  }
}
