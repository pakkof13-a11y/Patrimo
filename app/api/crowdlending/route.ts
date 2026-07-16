import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { crowdlendingSchema } from "@/app/lib/schemas";
import {
  createCrowdlending,
  deleteCrowdlending,
  listCrowdlending,
  updateCrowdlending,
} from "@/app/lib/alternatives/crowdlending";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  try {
    return NextResponse.json(await listCrowdlending(userId));
  } catch (e) {
    console.error("[crowdlending GET]", e);
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
  const parsed = crowdlendingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation échouée", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  try {
    const line = await createCrowdlending(userId, parsed.data);
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
  const id = body?.id as string;
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const parsed = crowdlendingSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation échouée", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  try {
    const line = await updateCrowdlending(userId, id, parsed.data);
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
    await deleteCrowdlending(userId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur";
    return NextResponse.json({ error: msg }, { status: msg.includes("introuvable") ? 404 : 400 });
  }
}
