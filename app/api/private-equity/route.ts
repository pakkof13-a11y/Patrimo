import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { privateEquitySchema } from "@/app/lib/schemas";
import {
  presentFields,
  requireBodyId,
  validationErrorResponse,
} from "@/app/lib/api/validation";
import {
  createPrivateEquity,
  deletePrivateEquity,
  listPrivateEquity,
  updatePrivateEquity,
} from "@/app/lib/alternatives/private-equity";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  try {
    return NextResponse.json(await listPrivateEquity(userId));
  } catch (e) {
    console.error("[private-equity GET]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const parsed = privateEquitySchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);
  try {
    const line = await createPrivateEquity(userId, parsed.data);
    return NextResponse.json({ line }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur" },
      { status: 400 }
    );
  }
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const id = requireBodyId(body);
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const parsed = privateEquitySchema.partial().safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);
  const patch = presentFields(body, parsed.data as Record<string, unknown>);
  try {
    const line = await updatePrivateEquity(userId, id, patch);
    return NextResponse.json({ line });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: msg }, { status: msg.includes("introuvable") ? 404 : 400 });
  }
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  try {
    await deletePrivateEquity(userId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: msg }, { status: msg.includes("introuvable") ? 404 : 400 });
  }
}
