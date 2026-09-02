import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  clientErrorMessage,
  clientErrorStatus,
} from "@/app/lib/api/error-response";
import {
  createAccount,
  SecuritiesInputError,
} from "@/app/lib/securities/account-service";
import { SECURITIES_ENVELOPE_TYPES } from "@/app/lib/securities/constants";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  envelopeType: z.enum(
    Object.keys(SECURITIES_ENVELOPE_TYPES) as [string, ...string[]]
  ),
  platformId: z.string().min(1, "Courtier requis"),
  openDate: z.string().min(1, "Date d'ouverture requise"),
  iban: z.string().trim().max(34).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/** POST — ouvre un compte titres. */
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
    const account = await createAccount(userId, parsed.data);
    return NextResponse.json(
      {
        ...account,
        openDate: account.openDate.toISOString(),
        createdAt: account.createdAt.toISOString(),
        updatedAt: account.updatedAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (e) {
    // Second PEA, courtier d'autrui, date future : messages métier destinés à
    // l'utilisateur, à ne pas masquer derrière un libellé générique.
    if (e instanceof SecuritiesInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[securities/accounts POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Ouverture du compte impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
