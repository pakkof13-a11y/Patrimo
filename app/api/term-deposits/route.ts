import { NextResponse } from "next/server";
import { Prisma } from "@/app/lib/prisma-client/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { termDepositSchema } from "@/app/lib/schemas";
import { validationErrorResponse } from "@/app/lib/api/validation";
import { listTermDeposits } from "@/app/lib/cash/term-deposits-list";
import {
  TermDepositInputError,
  validatePrincipal,
  validateTermDepositDates,
} from "@/app/lib/cash/term-deposit-service";
import { findOrCreatePlatform } from "@/app/lib/platforms/upsert";
import { findPreset, primaryType } from "@/app/lib/platforms/presets";

async function ensureBankPlatform(userId: string, bankName: string | null | undefined) {
  const name = (bankName || "").trim();
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
    /* non bloquant */
  }
}

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const base = new URL(req.url).searchParams.get("base") || "EUR";
  const termDeposits = await listTermDeposits(userId, base);
  return NextResponse.json({ termDeposits });
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const body = await req.json();
  const parsed = termDepositSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const d = parsed.data;
  try {
    validatePrincipal(d.principal);
    const { openedAt, maturityDate } = validateTermDepositDates(
      d.openedAt,
      d.maturityDate
    );

    const termDeposit = await prisma.termDeposit.create({
      data: {
        userId,
        bankName: d.bankName?.trim() || null,
        principal: new Prisma.Decimal(d.principal),
        ratePercent: new Prisma.Decimal(d.ratePercent),
        currency: (d.currency || "EUR").toUpperCase(),
        openedAt,
        maturityDate,
        earlyWithdrawalPenaltyPct: d.earlyWithdrawalPenaltyPct
          ? new Prisma.Decimal(d.earlyWithdrawalPenaltyPct)
          : null,
        isPro: d.isPro,
        ownershipPct: d.ownershipPct ?? null,
        notes: d.notes || null,
      },
    });
    await ensureBankPlatform(userId, d.bankName);
    return NextResponse.json({ termDeposit }, { status: 201 });
  } catch (e) {
    if (e instanceof TermDepositInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
