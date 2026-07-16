import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
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
  const envelope = String(body?.envelope || "").toUpperCase();
  if (!["CTO", "PEA", "AV"].includes(envelope)) {
    return NextResponse.json({ error: "envelope invalide (CTO|PEA|AV)" }, { status: 400 });
  }

  const row = await getOrCreateEnvelopeCash(userId, envelope as "CTO" | "PEA" | "AV");
  let currency = String(body?.currency || row.currency || "EUR").toUpperCase();
  // PEA locked to EUR
  if (envelope === "PEA") currency = "EUR";

  const balance =
    body?.balance !== undefined
      ? new Prisma.Decimal(String(body.balance).replace(",", "."))
      : row.balance;

  const updated = await prisma.envelopeCash.update({
    where: { id: row.id },
    data: { balance, currency },
  });
  return NextResponse.json({ envelope: updated });
}
