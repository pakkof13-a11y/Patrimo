import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import {
  SecuritiesInputError,
  setAssetAccount,
} from "@/app/lib/securities/account-service";

export const dynamic = "force-dynamic";

const attachSchema = z.object({
  assetId: z.string().min(1),
  /** `null` détache la ligne de tout compte. */
  securitiesAccountId: z.string().min(1).nullable(),
});

/**
 * PATCH — rattache ou détache une ligne de titres d'un compte.
 *
 * Un écart d'enveloppe est refusé par le service : déplacer une ligne d'un CTO
 * vers un PEA n'est pas une correction de saisie mais un transfert de titres.
 */
export async function PATCH(req: Request) {
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

  const parsed = attachSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    await setAssetAccount(
      userId,
      parsed.data.assetId,
      parsed.data.securitiesAccountId
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof SecuritiesInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[securities/positions PATCH]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Rattachement impossible") },
      { status: 500 }
    );
  }
}
