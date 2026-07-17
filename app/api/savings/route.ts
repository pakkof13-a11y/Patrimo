import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { savingsAccountSchema, savingsAccountUpdateSchema } from "@/app/lib/schemas";
import {
  presentFields,
  requireBodyId,
  validationErrorResponse,
} from "@/app/lib/api/validation";
import { listSavingsAccounts } from "@/app/lib/cash/pockets";
import { applyDueInterestForUser } from "@/app/lib/money/savings-accrual";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const accounts = await listSavingsAccounts(userId);
  return NextResponse.json({ accounts });
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const body = await req.json();
  const parsed = savingsAccountSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }
  const d = parsed.data;
  const now = new Date();
  const account = await prisma.savingsAccount.create({
    data: {
      userId,
      name: d.name,
      balance: new Prisma.Decimal(d.balance || "0"),
      apyPercent: new Prisma.Decimal(d.apyPercent || "0"),
      rateType: d.rateType || "APY",
      payoutFrequency: d.payoutFrequency || "DAILY",
      payoutDayOfWeek: d.payoutDayOfWeek ?? null,
      payoutDayOfMonth: d.payoutDayOfMonth ?? null,
      payoutMonth: d.payoutMonth ?? null,
      lastPayoutAt: now,
      lastAccruedAt: now,
      currency: (d.currency || "EUR").toUpperCase(),
      notes: d.notes || null,
    },
  });
  return NextResponse.json({ account }, { status: 201 });
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const body = await req.json();
  const id = requireBodyId(body);
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const existing = await prisma.savingsAccount.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const parsed = savingsAccountUpdateSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  // Credit pending interest before rate/balance changes so history is fair
  await applyDueInterestForUser(userId);

  const f = presentFields(body, parsed.data as Record<string, unknown>) as typeof parsed.data;
  const data: Prisma.SavingsAccountUpdateInput = {};
  if (f.name !== undefined) data.name = f.name;
  if (f.balance !== undefined) {
    data.balance = new Prisma.Decimal(f.balance || "0");
    data.lastAccruedAt = new Date();
    data.lastPayoutAt = new Date();
  }
  if (f.apyPercent !== undefined) {
    data.apyPercent = new Prisma.Decimal(f.apyPercent || "0");
  }
  if (f.rateType !== undefined) data.rateType = f.rateType;
  if (f.payoutFrequency !== undefined) data.payoutFrequency = f.payoutFrequency;
  if (f.payoutDayOfWeek !== undefined) data.payoutDayOfWeek = f.payoutDayOfWeek;
  if (f.payoutDayOfMonth !== undefined) data.payoutDayOfMonth = f.payoutDayOfMonth;
  if (f.payoutMonth !== undefined) data.payoutMonth = f.payoutMonth;
  if (f.currency !== undefined) data.currency = f.currency;
  if (f.notes !== undefined) data.notes = f.notes || null;

  const write = await prisma.savingsAccount.updateMany({
    where: { id, userId },
    data,
  });
  if (write.count === 0) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  const account = await prisma.savingsAccount.findFirst({ where: { id, userId } });
  return NextResponse.json({ account });
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  await prisma.savingsAccount.deleteMany({ where: { id, userId } });
  return NextResponse.json({ ok: true });
}
