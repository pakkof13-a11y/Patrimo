import { NextResponse } from "next/server";
import { Prisma } from "@/app/lib/prisma-client/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { termDepositUpdateSchema } from "@/app/lib/schemas";
import {
  presentFields,
  readJsonBody,
  unreadableBodyResponse,
  validationErrorResponse,
} from "@/app/lib/api/validation";
import { owned } from "@/app/lib/db/tenant-scope";
import {
  TermDepositInputError,
  validatePenaltyPct,
  validatePrincipal,
  validateRatePercent,
  validateTermDepositDates,
} from "@/app/lib/cash/term-deposit-service";
import { ensureBankPlatform } from "@/app/lib/platforms/ensure-bank-platform";

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const { id } = await ctx.params;

  const existing = await prisma.termDeposit.findFirst({ where: owned(id, userId) });
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 });

  const body = await readJsonBody(req);
  if (!body) return unreadableBodyResponse();
  const parsed = termDepositUpdateSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const f = presentFields(body, parsed.data as Record<string, unknown>) as typeof parsed.data;

  try {
    // Les deux dates doivent être validées ensemble : si une seule change,
    // recompléter l'autre depuis l'existant avant de vérifier l'ordre.
    let openedAt: Date | undefined;
    let maturityDate: Date | undefined;
    if (f.openedAt !== undefined || f.maturityDate !== undefined) {
      const validated = validateTermDepositDates(
        f.openedAt ?? existing.openedAt.toISOString(),
        f.maturityDate ?? existing.maturityDate.toISOString()
      );
      openedAt = validated.openedAt;
      maturityDate = validated.maturityDate;
    }
    if (f.principal !== undefined) validatePrincipal(f.principal);
    // Même garde qu'à la création : la chaîne vide ne doit pas atteindre
    // `Prisma.Decimal`, qui lèverait hors de la traduction en 400.
    if (f.ratePercent !== undefined) validateRatePercent(f.ratePercent);
    if (f.earlyWithdrawalPenaltyPct) {
      validatePenaltyPct(f.earlyWithdrawalPenaltyPct);
    }

    const data: Prisma.TermDepositUpdateInput = {};
    if (f.bankName !== undefined) data.bankName = f.bankName?.trim() || null;
    if (f.principal !== undefined) data.principal = new Prisma.Decimal(f.principal);
    if (f.ratePercent !== undefined) data.ratePercent = new Prisma.Decimal(f.ratePercent);
    // Déjà normalisée et restreinte par le schéma (`accountCurrency`).
    if (f.currency !== undefined) data.currency = f.currency;
    if (openedAt) data.openedAt = openedAt;
    if (maturityDate) data.maturityDate = maturityDate;
    if (f.earlyWithdrawalPenaltyPct !== undefined) {
      data.earlyWithdrawalPenaltyPct = f.earlyWithdrawalPenaltyPct
        ? new Prisma.Decimal(f.earlyWithdrawalPenaltyPct)
        : null;
    }
    if (f.isPro !== undefined) data.isPro = f.isPro;
    if (f.ownershipPct !== undefined) data.ownershipPct = f.ownershipPct ?? null;
    if (f.notes !== undefined) data.notes = f.notes || null;

    const write = await prisma.termDeposit.updateMany({ where: owned(id, userId), data });
    if (write.count === 0) {
      return NextResponse.json({ error: "Introuvable" }, { status: 404 });
    }
    const termDeposit = await prisma.termDeposit.findFirst({ where: owned(id, userId) });

    /*
      La plateforme homonyme, après le succès seulement.

      Le POST l'assure, le PATCH ne l'a jamais fait : renommer la banque d'un
      CAT le regroupait sous un établissement qui n'a aucune tuile dans
      Sources → Plateformes. Après l'écriture, et pas avant, pour la raison
      établie en D39 et D40 — une requête qui échoue ne doit rien laisser
      derrière elle.
    */
    if (typeof data.bankName === "string" && data.bankName) {
      await ensureBankPlatform(userId, data.bankName);
    }

    return NextResponse.json({ termDeposit });
  } catch (e) {
    if (e instanceof TermDepositInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const { id } = await ctx.params;
  /*
    Cf. `app/api/banks` et `app/api/savings` : le compte du `deleteMany` était
    jeté et la route répondait toujours 200. Supprimer un identifiant
    inexistant — ou celui d'un autre utilisateur — rendait « c'est fait », et
    l'écran rafraîchissait en l'annonçant.
  */
  const { count } = await prisma.termDeposit.deleteMany({ where: owned(id, userId) });
  if (count === 0) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
