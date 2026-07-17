import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { liabilitySchema, liabilityUpdateSchema } from "@/app/lib/schemas";
import {
  presentFields,
  requireBodyId,
  validationErrorResponse,
} from "@/app/lib/api/validation";
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
    return validationErrorResponse(parsed.error);
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
  const id = requireBodyId(body);
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const existing = await prisma.liability.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const parsed = liabilityUpdateSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const f = presentFields(body, parsed.data as Record<string, unknown>) as typeof parsed.data;
  const data: Prisma.LiabilityUpdateInput = {};

  if (f.name !== undefined) data.name = f.name;
  if (f.initialAmount !== undefined)
    data.initialAmount = new Prisma.Decimal(f.initialAmount || "0");
  if (f.remainingAmount !== undefined)
    data.remainingAmount = new Prisma.Decimal(f.remainingAmount || "0");
  if (f.currency !== undefined) data.currency = f.currency;
  if (f.interestRate !== undefined)
    data.interestRate = f.interestRate != null ? new Prisma.Decimal(f.interestRate) : null;
  if (f.monthlyPayment !== undefined)
    data.monthlyPayment =
      f.monthlyPayment != null ? new Prisma.Decimal(f.monthlyPayment) : null;
  if (f.bankName !== undefined) data.bankName = f.bankName || null;
  if (f.notes !== undefined) data.notes = f.notes || null;
  if (f.startDate !== undefined) data.startDate = f.startDate ? new Date(f.startDate) : null;
  if (f.endDate !== undefined) data.endDate = f.endDate ? new Date(f.endDate) : null;
  if (f.paymentDay !== undefined) data.paymentDay = f.paymentDay;

  const write = await prisma.liability.updateMany({
    where: { id, userId },
    data,
  });
  if (write.count === 0) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  const liability = await prisma.liability.findFirst({ where: { id, userId } });
  return NextResponse.json({ liability });
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const del = await prisma.liability.deleteMany({ where: { id, userId } });
  if (del.count === 0) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
