import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  clientErrorMessage,
  clientErrorStatus,
} from "@/app/lib/api/error-response";
import {
  estimateProperty,
  EstimateInputError,
} from "@/app/lib/real-estate/estimate";

const querySchema = z.object({
  type: z.enum(["MAISON", "APPARTEMENT"]),
  surface: z.coerce.number().positive().max(10_000),
  rooms: z.coerce.number().int().min(1).max(50).optional(),
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  /** Rayon imposé — sinon élargissement progressif 1 → 10 km. */
  radius: z.coerce.number().int().min(100).max(50_000).optional(),
  months: z.coerce.number().int().min(1).max(120).optional(),
});

/**
 * Estimation immobilière par comparaison DVF.
 *
 * Strictement consultative : rien n'est écrit, aucun actif n'est modifié. Le
 * patrimoine net continue de reposer sur les valeurs saisies.
 *
 * Authentifiée comme toute fonctionnalité de l'application, bien que le
 * référentiel DVF soit public et non rattaché à un utilisateur.
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
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

  const { type, surface, rooms, lat, lon, radius, months } = parsed.data;

  try {
    const result = await estimateProperty({
      propertyType: type,
      surfaceM2: surface,
      rooms: rooms ?? null,
      latitude: lat,
      longitude: lon,
      radiusM: radius ?? null,
      monthsBack: months ?? null,
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof EstimateInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[real-estate/estimate]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur d'estimation immobilière") },
      { status: clientErrorStatus(e) }
    );
  }
}
