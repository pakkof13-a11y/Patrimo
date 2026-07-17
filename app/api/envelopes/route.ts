import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { envelopeCashUpdateSchema } from "@/app/lib/schemas";
import { presentFields, validationErrorResponse } from "@/app/lib/api/validation";
import { listEnvelopeCash, getOrCreateEnvelopeCash } from "@/app/lib/cash/pockets";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const envelopes = await listEnvelopeCash(userId);
  return NextResponse.json({ envelopes });
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const body = await req.json();

  const parsed = envelopeCashUpdateSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const envelope = parsed.data.envelope;
  const row = await getOrCreateEnvelopeCash(userId, envelope);
  const f = presentFields(body, parsed.data as Record<string, unknown>) as typeof parsed.data;

  let currency = f.currency ?? row.currency ?? "EUR";
  // PEA locked to EUR
  if (envelope === "PEA") currency = "EUR";

  const balance =
    f.balance !== undefined ? new Prisma.Decimal(f.balance || "0") : row.balance;

  const write = await prisma.envelopeCash.updateMany({
    where: { id: row.id, userId },
    data: { balance, currency },
  });
  if (write.count === 0) {
    return NextResponse.json({ error: "Enveloppe introuvable" }, { status: 404 });
  }
  const updated = await prisma.envelopeCash.findFirst({
    where: { id: row.id, userId },
  });
  return NextResponse.json({ envelope: updated });
}
