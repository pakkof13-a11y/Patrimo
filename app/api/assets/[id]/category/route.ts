import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { updateAssetCategorySchema } from "@/app/lib/schemas";
import { validationErrorResponse } from "@/app/lib/api/validation";
import { assetCategoryLabel } from "@/app/lib/assets/categories";

/**
 * PATCH /api/assets/:id/category
 * Met à jour la sous-catégorie UI d’un actif appartenant à l’utilisateur.
 * N’affecte ni transactions ni calculs financiers.
 */
async function updateCategory(req: Request, id: string) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = updateAssetCategorySchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const asset = await prisma.asset.findFirst({ where: { id, userId } });
  if (!asset) {
    return NextResponse.json({ error: "Actif introuvable" }, { status: 404 });
  }

  const write = await prisma.asset.updateMany({
    where: { id, userId },
    data: { category: parsed.data.category },
  });
  if (write.count === 0) {
    return NextResponse.json({ error: "Actif introuvable" }, { status: 404 });
  }
  const updated = await prisma.asset.findFirst({ where: { id, userId } });
  if (!updated) {
    return NextResponse.json({ error: "Actif introuvable" }, { status: 404 });
  }

  return NextResponse.json({
    asset: {
      id: updated.id,
      name: updated.name,
      category: updated.category,
      categoryLabel: assetCategoryLabel(updated.category),
    },
  });
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  return updateCategory(req, id);
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  return updateCategory(req, id);
}
