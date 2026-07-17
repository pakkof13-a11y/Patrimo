import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import {
  lifeInsuranceSchema,
  lifeInsuranceUpdateSchema,
  lifeProductSchema,
  lifeProductUpdateSchema,
} from "@/app/lib/schemas";
import {
  presentFields,
  requireBodyId,
  validationErrorResponse,
} from "@/app/lib/api/validation";
import { listLifeInsurances } from "@/app/lib/cash/pockets";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const policies = await listLifeInsurances(userId);
  return NextResponse.json({ policies });
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const body = await req.json();

  // Product line under an existing policy
  if (body?.kind === "product") {
    const parsed = lifeProductSchema.safeParse(body);
    if (!parsed.success) {
      return validationErrorResponse(parsed.error);
    }
    const parent = await prisma.lifeInsurance.findFirst({
      where: { id: parsed.data.lifeInsuranceId, userId },
    });
    if (!parent) return NextResponse.json({ error: "Contrat introuvable" }, { status: 404 });
    const product = await prisma.lifeInsuranceProduct.create({
      data: {
        lifeInsuranceId: parsed.data.lifeInsuranceId,
        name: parsed.data.name,
        currentValue: new Prisma.Decimal(parsed.data.currentValue || "0"),
        currency: (parsed.data.currency || "EUR").toUpperCase(),
        notes: parsed.data.notes || null,
      },
    });
    return NextResponse.json({ product }, { status: 201 });
  }

  const parsed = lifeInsuranceSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }
  const policy = await prisma.lifeInsurance.create({
    data: {
      userId,
      insurer: parsed.data.insurer,
      openDate: parsed.data.openDate ? new Date(parsed.data.openDate) : null,
      cashEuro: new Prisma.Decimal(parsed.data.cashEuro || "0"),
      currency: (parsed.data.currency || "EUR").toUpperCase(),
      notes: parsed.data.notes || null,
    },
  });
  return NextResponse.json({ policy }, { status: 201 });
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const body = await req.json();
  const id = requireBodyId(body);
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  if (body?.kind === "product") {
    const product = await prisma.lifeInsuranceProduct.findFirst({
      where: { id, lifeInsurance: { userId } },
    });
    if (!product) return NextResponse.json({ error: "Produit introuvable" }, { status: 404 });

    const parsed = lifeProductUpdateSchema.safeParse(body);
    if (!parsed.success) return validationErrorResponse(parsed.error);

    const f = presentFields(body, parsed.data as Record<string, unknown>) as typeof parsed.data;
    const data: Prisma.LifeInsuranceProductUpdateInput = {};
    if (f.name !== undefined) data.name = f.name;
    if (f.currentValue !== undefined)
      data.currentValue = new Prisma.Decimal(f.currentValue || "0");
    if (f.currency !== undefined) data.currency = f.currency;
    if (f.notes !== undefined) data.notes = f.notes || null;

    const write = await prisma.lifeInsuranceProduct.updateMany({
      where: { id, lifeInsurance: { userId } },
      data,
    });
    if (write.count === 0) {
      return NextResponse.json({ error: "Produit introuvable" }, { status: 404 });
    }
    const updated = await prisma.lifeInsuranceProduct.findFirst({
      where: { id, lifeInsurance: { userId } },
    });
    return NextResponse.json({ product: updated });
  }

  const existing = await prisma.lifeInsurance.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const parsed = lifeInsuranceUpdateSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const f = presentFields(body, parsed.data as Record<string, unknown>) as typeof parsed.data;
  const data: Prisma.LifeInsuranceUpdateInput = {};
  if (f.insurer !== undefined) data.insurer = f.insurer;
  if (f.openDate !== undefined) data.openDate = f.openDate ? new Date(f.openDate) : null;
  if (f.cashEuro !== undefined) data.cashEuro = new Prisma.Decimal(f.cashEuro || "0");
  if (f.currency !== undefined) data.currency = f.currency;
  if (f.notes !== undefined) data.notes = f.notes || null;

  const write = await prisma.lifeInsurance.updateMany({
    where: { id, userId },
    data,
  });
  if (write.count === 0) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  const policy = await prisma.lifeInsurance.findFirst({ where: { id, userId } });
  return NextResponse.json({ policy });
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const kind = searchParams.get("kind");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  if (kind === "product") {
    await prisma.lifeInsuranceProduct.deleteMany({
      where: { id, lifeInsurance: { userId } },
    });
  } else {
    await prisma.lifeInsurance.deleteMany({ where: { id, userId } });
  }
  return NextResponse.json({ ok: true });
}
