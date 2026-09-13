import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { employeeSavingsLineSchema } from "@/app/lib/schemas";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import {
  fxUnavailableResponse,
  presentFields,
  requireBodyId,
  validationErrorResponse,
} from "@/app/lib/api/validation";
import { FxRateUnknownError } from "@/app/lib/market/fx";
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
    /*
      Une ligne héritée en devise inconnue (SEK, écrite avant la liste blanche
      de `employeeSavingsLineSchema.currency`) faisait lever `mapLine` sur
      TOUTE la liste : un 500 générique pour un utilisateur dont la plupart des
      lignes sont parfaitement lisibles. Même repli qu'`app/api/banks/route.ts`
      GET : 503 nommé, pas un 500 muet.
    */
    if (e instanceof FxRateUnknownError) return fxUnavailableResponse(e.currency);
    console.error("[employee-savings GET]", e);
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
  const body = await req.json();
  const parsed = employeeSavingsLineSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);
  try {
    const line = await createEmployeeSavingsLine(userId, parsed.data);
    return NextResponse.json({ line }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur") },
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
    const msg = clientErrorMessage(e, "Erreur");
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
    const msg = clientErrorMessage(e, "Erreur");
    const status = msg.includes("introuvable") ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
