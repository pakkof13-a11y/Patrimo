import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { bankAccountSchema } from "@/app/lib/schemas";
import { listBankAccounts } from "@/app/lib/cash/pockets";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const accounts = await listBankAccounts(userId);
  return NextResponse.json({ accounts });
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const body = await req.json();
  const parsed = bankAccountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation échouée", details: parsed.error.flatten() }, { status: 400 });
  }
  const account = await prisma.bankAccount.create({
    data: {
      userId,
      bankName: parsed.data.bankName,
      balance: new Prisma.Decimal(parsed.data.balance || "0"),
      currency: (parsed.data.currency || "EUR").toUpperCase(),
      notes: parsed.data.notes || null,
    },
  });
  return NextResponse.json({ account }, { status: 201 });
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const body = await req.json();
  const id = body?.id as string;
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const existing = await prisma.bankAccount.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const data: Prisma.BankAccountUpdateInput = {};
  if (body.bankName !== undefined) data.bankName = String(body.bankName);
  if (body.balance !== undefined)
    data.balance = new Prisma.Decimal(String(body.balance).replace(",", "."));
  if (body.currency !== undefined) data.currency = String(body.currency).toUpperCase();
  if (body.notes !== undefined) data.notes = body.notes || null;

  const account = await prisma.bankAccount.update({ where: { id }, data });
  return NextResponse.json({ account });
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await prisma.bankAccount.deleteMany({ where: { id, userId } });
  return NextResponse.json({ ok: true });
}
