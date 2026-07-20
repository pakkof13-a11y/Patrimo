import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { bankAccountSchema, bankAccountUpdateSchema } from "@/app/lib/schemas";
import {
  presentFields,
  requireBodyId,
  validationErrorResponse,
} from "@/app/lib/api/validation";
import { listBankAccounts } from "@/app/lib/cash/pockets";
import { findOrCreatePlatform } from "@/app/lib/platforms/upsert";
import { findPreset, primaryType } from "@/app/lib/platforms/presets";

/** Assure une plateforme homonyme pour afficher le cash en Sources → Plateformes. */
async function ensureBankPlatform(userId: string, bankName: string) {
  const name = bankName.trim();
  if (name.length < 2) return;
  const preset = findPreset(name);
  try {
    await findOrCreatePlatform(userId, {
      name: preset?.name || name,
      type: preset ? primaryType(preset) : "BANQUE",
      logoKey: preset?.key || null,
      logoUrl: preset?.logoUrl || null,
    });
  } catch {
    // Ne bloque pas la création du compte si la plateforme échoue
  }
}

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
    return validationErrorResponse(parsed.error);
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
  await ensureBankPlatform(userId, parsed.data.bankName);
  return NextResponse.json({ account }, { status: 201 });
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const body = await req.json();
  const id = requireBodyId(body);
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const existing = await prisma.bankAccount.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const parsed = bankAccountUpdateSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const f = presentFields(body, parsed.data as Record<string, unknown>) as typeof parsed.data;
  const data: Prisma.BankAccountUpdateInput = {};
  if (f.bankName !== undefined) data.bankName = f.bankName;
  if (f.balance !== undefined) data.balance = new Prisma.Decimal(f.balance || "0");
  if (f.currency !== undefined) data.currency = f.currency;
  if (f.notes !== undefined) data.notes = f.notes || null;

  const write = await prisma.bankAccount.updateMany({
    where: { id, userId },
    data,
  });
  if (write.count === 0) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  if (f.bankName) {
    await ensureBankPlatform(userId, f.bankName);
  }
  const account = await prisma.bankAccount.findFirst({ where: { id, userId } });
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
