import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { employeeSavingsLineSchema } from "@/app/lib/schemas";
import {
  presentFields,
  requireBodyId,
  validationErrorResponse,
} from "@/app/lib/api/validation";
import {
  createEmployeeSavingsLine,
  deleteEmployeeSavingsLine,
  listEmployeeSavings,
  updateEmployeeSavingsLine,
} from "@/app/lib/employee-savings/service";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  }
  try {
    const data = await listEmployeeSavings(userId);
    return NextResponse.json(data);
  } catch (e) {
    console.error("[employee-savings GET]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  }
  const body = await req.json();
  const parsed = employeeSavingsLineSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);
  try {
    const line = await createEmployeeSavingsLine(userId, parsed.data);
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
  if (!userId) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  }
  const body = await req.json();
  const id = requireBodyId(body);
  if (!id) {
    return NextResponse.json({ error: "id requis" }, { status: 400 });
  }
  const parsed = employeeSavingsLineSchema.partial().safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);
  const patch = presentFields(body, parsed.data as Record<string, unknown>);
  try {
    const line = await updateEmployeeSavingsLine(userId, id, patch);
    return NextResponse.json({ line });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur";
    const status = msg.includes("introuvable") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id requis" }, { status: 400 });
  }
  try {
    await deleteEmployeeSavingsLine(userId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur";
    const status = msg.includes("introuvable") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
