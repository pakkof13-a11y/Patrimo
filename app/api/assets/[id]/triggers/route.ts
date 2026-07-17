import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { updateAssetTriggersSchema } from "@/app/lib/schemas";
import { presentFields, validationErrorResponse } from "@/app/lib/api/validation";

const FIELDS = ["stopLoss", "tp1", "tp2", "tp3", "tp4"] as const;

/**
 * PATCH exit levels (Stop Loss / TP1–4) for an asset.
 * Body: { stopLoss?, tp1?, tp2?, tp3?, tp4? } — null/"" clears the level.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const asset = await prisma.asset.findFirst({ where: { id, userId } });
  if (!asset) {
    return NextResponse.json({ error: "Actif introuvable" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = updateAssetTriggersSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const f = presentFields(body, parsed.data as Record<string, unknown>) as typeof parsed.data;
  const data: Prisma.AssetUpdateInput = {};

  for (const field of FIELDS) {
    if (f[field] === undefined) continue;
    const v = f[field];
    data[field] = v == null ? null : new Prisma.Decimal(v);
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  const write = await prisma.asset.updateMany({ where: { id, userId }, data });
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
      stopLoss: updated.stopLoss?.toString() ?? null,
      tp1: updated.tp1?.toString() ?? null,
      tp2: updated.tp2?.toString() ?? null,
      tp3: updated.tp3?.toString() ?? null,
      tp4: updated.tp4?.toString() ?? null,
    },
  });
}
