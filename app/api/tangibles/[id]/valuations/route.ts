import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { validationErrorResponse } from "@/app/lib/api/validation";
import {
  addValuation,
  deleteValuation,
  listValuations,
  TangibleValuationError,
} from "@/app/lib/alternatives/tangible-valuations";
import { VALUATION_SOURCES } from "@/app/lib/tangibles/valuation-history";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  valuedAt: z.string().min(1, "Date requise"),
  valueEur: z.union([z.string(), z.number()]),
  source: z.enum(VALUATION_SOURCES).optional(),
  note: z.string().trim().max(500).optional().nullable(),
});

function errorResponse(e: unknown) {
  if (e instanceof TangibleValuationError) {
    const status = e.code === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json({ error: e.message, code: e.code }, { status });
  }
  console.error("[tangibles/valuations]", e);
  return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
}

/**
 * Historique de valeur d'un objet tangible.
 *
 * Ces marchés ne cotent pas : la valeur ne se rafraîchit pas toute seule, elle
 * se constate. Cette route est donc le « tracker » de ces actifs — chaque
 * expertise, chaque adjudication comparable y devient un point daté, et la
 * courbe se déduit de ces points.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await ctx.params;
  try {
    return NextResponse.json(await listValuations(userId, id));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const valuation = await addValuation(userId, id, parsed.data);
    return NextResponse.json({ valuation }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const valuationId = new URL(req.url).searchParams.get("valuationId");
  if (!valuationId) {
    return NextResponse.json({ error: "valuationId requis" }, { status: 400 });
  }

  try {
    await deleteValuation(userId, id, valuationId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
