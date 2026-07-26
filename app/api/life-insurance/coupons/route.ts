import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  clientErrorMessage,
  clientErrorStatus,
} from "@/app/lib/api/error-response";
import {
  listPendingCoupons,
  settleCoupons,
} from "@/app/lib/life-insurance/coupon-schedule";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  try {
    return NextResponse.json({ pending: await listPendingCoupons(userId) });
  } catch (e) {
    console.error("[life-insurance/coupons GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de chargement des coupons") },
      { status: clientErrorStatus(e) }
    );
  }
}

const bodySchema = z.object({
  decisions: z
    .array(
      z.object({
        assetId: z.string().min(1),
        observedOn: z.string().min(1),
        /** false = constatation non versée : curseur avancé, rien au journal. */
        paid: z.boolean(),
        amountEur: z
          .string()
          .trim()
          .regex(/^\d+([.,]\d+)?$/, "Montant invalide")
          .optional()
          .nullable(),
      })
    )
    .min(1)
    .max(200),
});

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Paramètres invalides",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(
      await settleCoupons(userId, parsed.data.decisions)
    );
  } catch (e) {
    console.error("[life-insurance/coupons POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Enregistrement impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
