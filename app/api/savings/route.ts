import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { savingsAccountSchema } from "@/app/lib/schemas";
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
    return NextResponse.json(
      { error: "Validation échouée", details: parsed.error.flatten() },
      { status: 400 }
    );
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
  const id = body?.id as string;
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const existing = await prisma.savingsAccount.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  // Credit pending interest before rate/balance changes so history is fair
  await applyDueInterestForUser(userId);

  const data: Prisma.SavingsAccountUpdateInput = {};
  if (body.name !== undefined) data.name = String(body.name);
  if (body.balance !== undefined) {
    data.balance = new Prisma.Decimal(String(body.balance).replace(",", "."));
    data.lastAccruedAt = new Date();
    data.lastPayoutAt = new Date();
  }
  if (body.apyPercent !== undefined) {
    data.apyPercent = new Prisma.Decimal(String(body.apyPercent).replace(",", "."));
  }
  if (body.rateType !== undefined) {
    data.rateType = body.rateType === "APR" ? "APR" : "APY";
  }
  if (body.payoutFrequency !== undefined) {
    const f = String(body.payoutFrequency).toUpperCase();
    data.payoutFrequency = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(f)
      ? f
      : "DAILY";
  }
  if (body.payoutDayOfWeek !== undefined) {
    data.payoutDayOfWeek =
      body.payoutDayOfWeek === null || body.payoutDayOfWeek === ""
        ? null
        : Math.max(1, Math.min(7, Number(body.payoutDayOfWeek)));
  }
  if (body.payoutDayOfMonth !== undefined) {
    data.payoutDayOfMonth =
      body.payoutDayOfMonth === null || body.payoutDayOfMonth === ""
        ? null
        : Math.max(1, Math.min(31, Number(body.payoutDayOfMonth)));
  }
  if (body.payoutMonth !== undefined) {
    data.payoutMonth =
      body.payoutMonth === null || body.payoutMonth === ""
        ? null
        : Math.max(1, Math.min(12, Number(body.payoutMonth)));
  }
  if (body.currency !== undefined) data.currency = String(body.currency).toUpperCase();
  if (body.notes !== undefined) data.notes = body.notes || null;

  const account = await prisma.savingsAccount.update({ where: { id }, data });
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
