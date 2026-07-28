import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import {
  createTradingAccount,
  TRADING_ACCOUNT_TYPES,
  TradingInputError,
} from "@/app/lib/trading/account-service";

export const dynamic = "force-dynamic";

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+([.,]\d+)?$/, "Montant invalide")
  .transform((v) => v.replace(",", "."));

const createSchema = z.object({
  brokerName: z.string().trim().min(1, "Courtier requis").max(120),
  accountType: z.enum(
    Object.keys(TRADING_ACCOUNT_TYPES) as [string, ...string[]]
  ),
  currency: z.string().trim().max(8).optional().nullable(),
  balance: decimalString.optional().nullable(),
  marginAvailable: decimalString.optional().nullable(),
  openDate: z.string().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/** POST — déclare un compte de trading. */
export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    const account = await createTradingAccount(userId, parsed.data);
    return NextResponse.json(
      {
        ...account,
        openDate: account.openDate?.toISOString() ?? null,
        createdAt: account.createdAt.toISOString(),
        updatedAt: account.updatedAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof TradingInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[trading/accounts POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Création du compte impossible") },
      { status: 500 }
    );
  }
}
