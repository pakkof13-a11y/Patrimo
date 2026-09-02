import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import {
  setPositionAccount,
  TradingInputError,
} from "@/app/lib/trading/account-service";

export const dynamic = "force-dynamic";

const attachSchema = z.object({
  positionId: z.string().min(1),
  /** `null` détache la position de tout compte. */
  tradingAccountId: z.string().min(1).nullable(),
});

/** PATCH — rattache ou détache une position d'un compte de trading. */
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
    await setPositionAccount(
      userId,
      parsed.data.positionId,
      parsed.data.tradingAccountId
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof TradingInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[trading/positions PATCH]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Rattachement impossible") },
      { status: 500 }
    );
  }
}
