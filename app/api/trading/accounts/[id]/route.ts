import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import {
  deleteTradingAccount,
  TRADING_ACCOUNT_TYPES,
  TradingInputError,
  updateTradingAccount,
} from "@/app/lib/trading/account-service";

export const dynamic = "force-dynamic";

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+([.,]\d+)?$/, "Montant invalide")
  .transform((v) => v.replace(",", "."));

const updateSchema = z.object({
  brokerName: z.string().trim().min(1).max(120).optional(),
  accountType: z
    .enum(Object.keys(TRADING_ACCOUNT_TYPES) as [string, ...string[]])
    .optional(),
  currency: z.string().trim().max(8).optional().nullable(),
  balance: decimalString.optional().nullable(),
  marginAvailable: decimalString.optional().nullable(),
  openDate: z.string().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    const account = await updateTradingAccount(userId, id, parsed.data);
    return NextResponse.json({
      ...account,
      openDate: account.openDate?.toISOString() ?? null,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    });
  } catch (e) {
    if (e instanceof TradingInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[trading/accounts/:id PATCH]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Mise à jour impossible") },
      { status: 500 }
    );
  }
}

/**
 * DELETE — ferme un compte.
 *
 * Les positions ne sont jamais supprimées : elles sont détachées, et le
 * journal de trading — donc le P&L réalisé et le stock de moins-values
 * reportables — reste intact.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await params;

  try {
    return NextResponse.json(await deleteTradingAccount(userId, id));
  } catch (e) {
    console.error("[trading/accounts/:id DELETE]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Suppression impossible") },
      { status: 500 }
    );
  }
}
