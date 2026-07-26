import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  clientErrorMessage,
  clientErrorStatus,
} from "@/app/lib/api/error-response";
import {
  confirmEntries,
  listPendingEntries,
} from "@/app/lib/real-estate/rent-schedule";

/** Échéances de loyers et charges dues, non encore écrites au journal. */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    return NextResponse.json({ pending: await listPendingEntries(userId) });
  } catch (e) {
    console.error("[real-estate/rent-schedule GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de lecture des échéances") },
      { status: clientErrorStatus(e) }
    );
  }
}

const confirmSchema = z.object({
  entries: z
    .array(
      z.object({
        assetId: z.string().min(1),
        kind: z.enum(["RENT", "CHARGES"]),
        dueDate: z.string().min(1),
      })
    )
    .min(1)
    .max(200),
});

/**
 * Confirme des échéances : c'est cette confirmation qui écrit au journal.
 *
 * Générer les loyers d'office gonflerait la trésorerie affichée avec de
 * l'argent jamais reçu — un locataire peut payer en retard, partiellement, ou
 * pas du tout.
 */
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

  const parsed = confirmSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Paramètres invalides" },
      { status: 400 }
    );
  }

  try {
    return NextResponse.json(
      await confirmEntries(userId, parsed.data.entries)
    );
  } catch (e) {
    console.error("[real-estate/rent-schedule POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Enregistrement impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
