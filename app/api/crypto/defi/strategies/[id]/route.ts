import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import {
  deleteStrategy,
  renameStrategy,
} from "@/app/lib/crypto/defi-strategy-service";
import { DefiInputError } from "@/app/lib/crypto/defi-manual-service";

export const dynamic = "force-dynamic";

const renameSchema = z.object({
  name: z.string().trim().min(1, "Nom requis").max(120),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/** PATCH — renomme une stratégie / met à jour ses notes. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    const strategy = await renameStrategy(userId, id, parsed.data);
    return NextResponse.json({
      ...strategy,
      createdAt: strategy.createdAt.toISOString(),
      updatedAt: strategy.updatedAt.toISOString(),
    });
  } catch (e) {
    if (e instanceof DefiInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/defi/strategies/:id PATCH]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Mise à jour de la stratégie impossible") },
      { status: 500 }
    );
  }
}

/**
 * DELETE — supprime la stratégie. Les positions rattachées ne sont pas
 * supprimées : `SetNull` les détache, elles redeviennent autonomes.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await params;

  try {
    const out = await deleteStrategy(userId, id);
    return NextResponse.json(out);
  } catch (e) {
    console.error("[crypto/defi/strategies/:id DELETE]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Suppression impossible") },
      { status: 500 }
    );
  }
}
