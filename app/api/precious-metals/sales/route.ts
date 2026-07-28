import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { preciousMetalSaleSchema } from "@/app/lib/schemas";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import { validationErrorResponse } from "@/app/lib/api/validation";
import {
  createPreciousMetalSale,
  deletePreciousMetalSale,
  listPreciousMetalSales,
  PreciousMetalInputError,
} from "@/app/lib/alternatives/precious-metals";

export const dynamic = "force-dynamic";

/** GET — cessions et récapitulatif par année fiscale. */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  }
  try {
    return NextResponse.json(await listPreciousMetalSales(userId));
  } catch (e) {
    console.error("[precious-metals/sales GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur") },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = preciousMetalSaleSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  try {
    const sale = await createPreciousMetalSale(userId, parsed.data);
    return NextResponse.json({ sale }, { status: 201 });
  } catch (e) {
    if (e instanceof PreciousMetalInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[precious-metals/sales POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur") },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  }
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  try {
    return NextResponse.json(await deletePreciousMetalSale(userId, id));
  } catch (e) {
    if (e instanceof PreciousMetalInputError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("[precious-metals/sales DELETE]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur") },
      { status: 500 }
    );
  }
}
