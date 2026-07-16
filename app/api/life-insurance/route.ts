import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { lifeInsuranceSchema, lifeProductSchema } from "@/app/lib/schemas";
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
      return NextResponse.json({ error: "Validation échouée", details: parsed.error.flatten() }, { status: 400 });
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
    return NextResponse.json({ error: "Validation échouée", details: parsed.error.flatten() }, { status: 400 });
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
  const id = body?.id as string;
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  if (body?.kind === "product") {
    const product = await prisma.lifeInsuranceProduct.findFirst({
      where: { id, lifeInsurance: { userId } },
    });
    if (!product) return NextResponse.json({ error: "Produit introuvable" }, { status: 404 });
    const data: Prisma.LifeInsuranceProductUpdateInput = {};
    if (body.name !== undefined) data.name = String(body.name);
    if (body.currentValue !== undefined)
      data.currentValue = new Prisma.Decimal(String(body.currentValue).replace(",", "."));
    if (body.notes !== undefined) data.notes = body.notes || null;
    const updated = await prisma.lifeInsuranceProduct.update({ where: { id }, data });
    return NextResponse.json({ product: updated });
  }

  const existing = await prisma.lifeInsurance.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  const data: Prisma.LifeInsuranceUpdateInput = {};
  if (body.insurer !== undefined) data.insurer = String(body.insurer);
  if (body.openDate !== undefined)
    data.openDate = body.openDate ? new Date(body.openDate) : null;
  if (body.cashEuro !== undefined)
    data.cashEuro = new Prisma.Decimal(String(body.cashEuro).replace(",", "."));
  if (body.currency !== undefined) data.currency = String(body.currency).toUpperCase();
  if (body.notes !== undefined) data.notes = body.notes || null;
  const policy = await prisma.lifeInsurance.update({ where: { id }, data });
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
