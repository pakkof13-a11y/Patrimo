import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { geocodeAddress } from "@/app/lib/real-estate/geocode";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  addressLine: z.string().trim().max(300),
  postalCode: z.string().trim().max(10).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
});

/**
 * POST /api/real-estate/geocode
 *
 * Enveloppe fine autour de `geocodeAddress` (BAN) pour l'autocomplétion
 * d'adresse à la saisie d'un bien — ne réimplémente rien, ne fait que router
 * la requête et sérialiser l'issue.
 *
 * POST plutôt que GET : l'adresse saisie est une donnée personnelle, elle n'a
 * rien à faire dans les journaux d'accès ni l'historique du navigateur (même
 * raison que `/estimate/address`).
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

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  const outcome = await geocodeAddress(parsed.data);
  return NextResponse.json(outcome);
}
