import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { liabilitySchema } from "@/app/lib/schemas";
import {
  changeInterestRate,
  changeMonthlyPayment,
  listLiabilities,
  recordEarlyRepayment,
} from "@/app/lib/liabilities/service";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });

  try {
    const data = await listLiabilities(userId);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur passifs";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });

  const body = await req.json();

  // Lifecycle actions on existing credit
  const action = body?.action as string | undefined;
  if (action === "early_repayment") {
    try {
      const liability = await recordEarlyRepayment({
        userId,
        liabilityId: String(body.liabilityId || body.id || ""),
        kind: body.kind === "TOTAL" ? "TOTAL" : "PARTIAL",
        amount: body.amount != null ? String(body.amount) : undefined,
        eventDate: body.eventDate ? String(body.eventDate) : undefined,
        notes: body.notes ? String(body.notes) : undefined,
      });
      return NextResponse.json({ liability });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  if (action === "payment_change") {
    try {
      const liability = await changeMonthlyPayment({
        userId,
        liabilityId: String(body.liabilityId || body.id || ""),
        monthlyPayment: String(body.monthlyPayment || ""),
        eventDate: body.eventDate ? String(body.eventDate) : undefined,
        notes: body.notes ? String(body.notes) : undefined,
      });
      return NextResponse.json({ liability });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  if (action === "rate_change") {
    try {
      const liability = await changeInterestRate({
        userId,
        liabilityId: String(body.liabilityId || body.id || ""),
        interestRate: String(body.interestRate ?? body.rate ?? ""),
        eventDate: body.eventDate ? String(body.eventDate) : undefined,
        notes: body.notes ? String(body.notes) : undefined,
      });
      return NextResponse.json({ liability });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  const parsed = liabilitySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation échouée", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const paymentDay =
    parsed.data.paymentDay != null
      ? Math.max(1, Math.min(31, Math.floor(Number(parsed.data.paymentDay))))
      : null;

  const liability = await prisma.liability.create({
    data: {
      userId,
      name: parsed.data.name,
      initialAmount: new Prisma.Decimal(parsed.data.initialAmount || "0"),
      remainingAmount: new Prisma.Decimal(parsed.data.remainingAmount || "0"),
      currency: (parsed.data.currency || "EUR").toUpperCase(),
      interestRate: parsed.data.interestRate
        ? new Prisma.Decimal(parsed.data.interestRate)
        : null,
      monthlyPayment: parsed.data.monthlyPayment
        ? new Prisma.Decimal(parsed.data.monthlyPayment)
        : null,
      startDate: parsed.data.startDate ? new Date(parsed.data.startDate) : null,
      endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
      paymentDay,
      bankName: parsed.data.bankName || null,
      notes: parsed.data.notes || null,
    },
  });

  return NextResponse.json({ liability }, { status: 201 });
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });

  const body = await req.json();
  const id = body?.id as string | undefined;
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const existing = await prisma.liability.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const data: Prisma.LiabilityUpdateInput = {};
  if (body.name !== undefined) data.name = String(body.name);
  if (body.initialAmount !== undefined)
    data.initialAmount = new Prisma.Decimal(String(body.initialAmount).replace(",", "."));
  if (body.remainingAmount !== undefined)
    data.remainingAmount = new Prisma.Decimal(String(body.remainingAmount).replace(",", "."));
  if (body.currency !== undefined) data.currency = String(body.currency).toUpperCase();
  if (body.interestRate !== undefined && body.interestRate !== "")
    data.interestRate = new Prisma.Decimal(String(body.interestRate).replace(",", "."));
  if (body.interestRate === "" || body.interestRate === null) data.interestRate = null;
  if (body.monthlyPayment !== undefined && body.monthlyPayment !== "")
    data.monthlyPayment = new Prisma.Decimal(String(body.monthlyPayment).replace(",", "."));
  if (body.monthlyPayment === "" || body.monthlyPayment === null) data.monthlyPayment = null;
  if (body.bankName !== undefined) data.bankName = body.bankName || null;
  if (body.notes !== undefined) data.notes = body.notes || null;
  if (body.startDate !== undefined)
    data.startDate = body.startDate ? new Date(body.startDate) : null;
  if (body.endDate !== undefined) data.endDate = body.endDate ? new Date(body.endDate) : null;
  if (body.paymentDay !== undefined && body.paymentDay !== "" && body.paymentDay != null) {
    data.paymentDay = Math.max(1, Math.min(31, Math.floor(Number(body.paymentDay))));
  }
  if (body.paymentDay === "" || body.paymentDay === null) data.paymentDay = null;

  const liability = await prisma.liability.update({ where: { id }, data });
  return NextResponse.json({ liability });
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const existing = await prisma.liability.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  await prisma.liability.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
