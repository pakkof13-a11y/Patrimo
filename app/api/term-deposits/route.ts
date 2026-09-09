import { NextResponse } from "next/server";
import { Prisma } from "@/app/lib/prisma-client/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { termDepositSchema } from "@/app/lib/schemas";
import {
  readJsonBody,
  unreadableBodyResponse,
  validationErrorResponse,
} from "@/app/lib/api/validation";
import { listTermDeposits } from "@/app/lib/cash/term-deposits-list";
import {
  TermDepositInputError,
  validatePenaltyPct,
  validatePrincipal,
  validateRatePercent,
  validateTermDepositDates,
} from "@/app/lib/cash/term-deposit-service";
import { BASE_CURRENCY_OPTIONS } from "@/app/lib/money/currencies";
import { FxRateUnknownError } from "@/app/lib/market/fx";
import { ensureBankPlatform } from "@/app/lib/platforms/ensure-bank-platform";

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });

  /*
    La devise de restitution est validée, pas seulement lue — même remède
    qu'`app/api/banks/summary` (D39).

    Elle partait telle quelle vers `convertFromEurSync`, qui lève sur tout
    code sans taux : `?base=ZZZ` rendait un 500 sans corps là où la demande
    est simplement invalide.
  */
  const demande = new URL(req.url).searchParams.get("base");
  const base = (demande || "EUR").toUpperCase();
  if (!(BASE_CURRENCY_OPTIONS as readonly string[]).includes(base)) {
    return NextResponse.json(
      {
        error: `Devise de restitution inconnue : ${base}. Attendu : ${BASE_CURRENCY_OPTIONS.join(", ")}.`,
      },
      { status: 400 }
    );
  }

  try {
    const termDeposits = await listTermDeposits(userId, base);
    return NextResponse.json({ termDeposits });
  } catch (e) {
    /*
      Une devise de dépôt sans taux n'est pas une faute de l'appelant : la
      base vient d'être validée, et c'est une ligne déjà en place qui ne peut
      pas être convertie. Elle ne peut plus être écrite — le schéma s'y
      oppose désormais — mais rien n'efface celles d'avant, et un 500 nu
      laissait l'onglet mort sans un mot.
    */
    if (e instanceof FxRateUnknownError) {
      return NextResponse.json(
        {
          error: `Taux de change indisponible pour ${e.currency}. Corrigez la devise du dépôt concerné.`,
        },
        { status: 503 }
      );
    }
    throw e;
  }
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const body = await readJsonBody(req);
  if (!body) return unreadableBodyResponse();
  const parsed = termDepositSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const d = parsed.data;
  try {
    validatePrincipal(d.principal);
    /*
      Le taux et la pénalité passent par le même garde que le principal.

      Ils filaient nus vers `new Prisma.Decimal(...)`, qui lève sur la chaîne
      vide — que `decimalString` accepte. L'exception n'étant pas une
      `TermDepositInputError`, le `catch` plus bas la relayait : 500 au lieu
      de 400.
    */
    validateRatePercent(d.ratePercent);
    if (d.earlyWithdrawalPenaltyPct) {
      validatePenaltyPct(d.earlyWithdrawalPenaltyPct);
    }
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
        // Déjà normalisée et restreinte par le schéma (`accountCurrency`).
        currency: d.currency,
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
