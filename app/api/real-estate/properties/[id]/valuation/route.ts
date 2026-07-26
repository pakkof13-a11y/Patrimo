import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  clientErrorMessage,
  clientErrorStatus,
} from "@/app/lib/api/error-response";
import {
  getValuationHistory,
  revalueFromDvf,
  setManualValuation,
} from "@/app/lib/real-estate/valuation";

/** Historique de valorisation — se lit comme un cours de bourse. */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await ctx.params;

  try {
    return NextResponse.json({ history: await getValuationHistory(userId, id) });
  } catch (e) {
    console.error("[real-estate/valuation GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de lecture de l'historique") },
      { status: clientErrorStatus(e) }
    );
  }
}

const bodySchema = z.union([
  z.object({
    mode: z.literal("manual"),
    /** Valeur du bien **entier**, pas de la quote-part détenue. */
    valueEur: z
      .string()
      .trim()
      .regex(/^\d+([.,]\d+)?$/, "Montant invalide")
      .transform((v) => v.replace(",", ".")),
  }),
  z.object({
    mode: z.literal("dvf"),
    /**
     * `false` : estimer et proposer, sans écrire. Sert au parcours où
     * l'utilisateur voit le chiffre avant de décider.
     */
    apply: z.boolean().optional().default(true),
    /** Force l'estimation même en mode manuel ou hors fenêtre de fraîcheur. */
    force: z.boolean().optional().default(false),
  }),
]);

/**
 * Fixe une valeur, ou déclenche une estimation DVF.
 *
 * Une valeur saisie bascule le bien en mode manuel et n'est plus jamais
 * écrasée automatiquement.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await ctx.params;

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
    if (parsed.data.mode === "manual") {
      await setManualValuation(userId, id, parsed.data.valueEur);
      return NextResponse.json({
        kind: "updated",
        valueEur: parsed.data.valueEur,
        source: "manual",
      });
    }

    const outcome = await revalueFromDvf(userId, id, {
      force: parsed.data.force,
      apply: parsed.data.apply,
    });
    return NextResponse.json(outcome);
  } catch (e) {
    console.error("[real-estate/valuation POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Valorisation impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
