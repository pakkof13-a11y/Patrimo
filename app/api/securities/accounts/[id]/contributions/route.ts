import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import { SecuritiesInputError } from "@/app/lib/securities/account-service";
import {
  CONTRIBUTION_TYPES,
  listContributions,
  recordContribution,
} from "@/app/lib/securities/fiscal-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const decimalString = z
  .string()
  .trim()
  .regex(/^\d+([.,]\d+)?$/, "Montant invalide")
  .transform((v) => v.replace(",", "."));

/**
 * Le signe est porté par `type`, jamais par le montant : un versement négatif
 * serait un retrait déguisé, que les totaux ne sauraient pas classer.
 */
const createSchema = z.object({
  type: z.enum(CONTRIBUTION_TYPES),
  amountEur: decimalString,
  occurredAt: z.string().min(1, "Date requise"),
  notes: z.string().trim().max(500).optional().nullable(),
});

/** GET — historique des versements et retraits déclarés du compte. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await params;

  try {
    const rows = await listContributions(userId, id);
    return NextResponse.json(
      {
        contributions: rows.map((c) => ({
          id: c.id,
          type: c.type,
          amountEur: c.amountEur.toFixed(2),
          occurredAt: c.occurredAt.toISOString(),
          notes: c.notes,
        })),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    if (e instanceof SecuritiesInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[securities/contributions GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de chargement des versements") },
      { status: 500 }
    );
  }
}

/** POST — déclare un versement ou un retrait. */
export async function POST(
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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    const row = await recordContribution(userId, id, parsed.data);
    return NextResponse.json(
      {
        id: row.id,
        type: row.type,
        amountEur: row.amountEur.toFixed(2),
        occurredAt: row.occurredAt.toISOString(),
        notes: row.notes,
      },
      { status: 201 }
    );
  } catch (e) {
    if (e instanceof SecuritiesInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[securities/contributions POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Enregistrement impossible") },
      { status: 500 }
    );
  }
}
