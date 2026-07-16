import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";

const FIELDS = ["stopLoss", "tp1", "tp2", "tp3", "tp4"] as const;

function parseLevel(raw: unknown): Prisma.Decimal | null | undefined {
  // undefined = leave unchanged; null = clear; number/string = set
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const s = String(raw).trim().replace(",", ".");
  if (s === "" || s === "-" || s.toLowerCase() === "null") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error("Niveau invalide (nombre ≥ 0 attendu)");
  }
  if (n === 0) return null;
  return new Prisma.Decimal(s);
}

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

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const data: Prisma.AssetUpdateInput = {};
  try {
    for (const f of FIELDS) {
      if (!(f in body)) continue;
      const v = parseLevel(body[f]);
      if (v === undefined) continue;
      data[f] = v;
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Niveau invalide" },
      { status: 400 }
    );
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 });
  }

  const updated = await prisma.asset.update({ where: { id }, data });
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
