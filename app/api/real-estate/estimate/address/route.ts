import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { geocodeAddress, departmentFromCode } from "@/app/lib/real-estate/geocode";
import {
  estimateProperty,
  isDvfCoveredDepartment,
} from "@/app/lib/real-estate/estimate";
import { ENERGY_RATINGS, isDvfEstimable } from "@/app/lib/real-estate/constants";
import { clientErrorMessage } from "@/app/lib/api/error-response";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  addressLine: z.string().trim().min(3, "Adresse requise").max(300),
  postalCode: z.string().trim().max(10).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  propertyType: z.enum(["MAISON", "APPARTEMENT"]),
  surfaceM2: z.coerce.number().positive().max(10_000),
  rooms: z.coerce.number().int().min(1).max(50).optional().nullable(),
  radiusM: z.coerce.number().int().min(100).max(50_000).optional().nullable(),
  monthsBack: z.coerce.number().int().min(1).max(120).optional().nullable(),
  /** Facultative : sans elle, l'estimation reste le prix DVF pur (coefficient 1). */
  dpeClass: z.enum(ENERGY_RATINGS).optional().nullable(),
});

/**
 * POST /api/real-estate/estimate/address
 *
 * Estime un bien **à partir d'une adresse libre**, sans qu'il soit enregistré :
 * géocodage BAN → recherche de ventes DVF comparables → prix au m².
 *
 * La route existante `/api/real-estate/estimate` exige déjà lat/lon ; elle
 * suppose donc un bien géocodé. Celle-ci sert le cas amont — évaluer une
 * adresse avant même de l'acheter — et renvoie le point géocodé pour que
 * l'utilisateur vérifie que la BAN a bien reconnu l'adresse visée.
 *
 * POST et non GET : l'adresse est une donnée personnelle, elle n'a pas à
 * finir dans les journaux d'accès ni dans l'historique du navigateur.
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
  const input = parsed.data;

  if (!isDvfEstimable(input.propertyType)) {
    return NextResponse.json(
      {
        error:
          "Seuls les maisons et appartements s'estiment au m² à partir de DVF.",
      },
      { status: 400 }
    );
  }

  try {
    const geo = await geocodeAddress({
      addressLine: input.addressLine,
      postalCode: input.postalCode,
      city: input.city,
    });

    if (geo.kind === "not-found") {
      return NextResponse.json(
        { error: "Adresse introuvable dans la Base Adresse Nationale." },
        { status: 404 }
      );
    }
    if (geo.kind === "unavailable") {
      return NextResponse.json(
        { error: `Service d'adresse indisponible : ${geo.error}` },
        { status: 503 }
      );
    }

    // Une correspondance douteuse est renvoyée telle quelle, avec son score :
    // mieux vaut afficher l'adresse retenue et laisser l'utilisateur juger
    // que de refuser sans expliquer, ou pire, d'estimer la mauvaise rue.
    const place = geo.kind === "low-confidence" ? geo.best : geo.result;
    const lowConfidenceAddress = geo.kind === "low-confidence";

    const department = place.postalCode
      ? departmentFromCode(place.postalCode)
      : null;
    // Alsace-Moselle et Mayotte : DVF n'y trouvera jamais rien (livre
    // foncier, régime distinct). `departmentUncovered` sert uniquement à
    // préciser le message si l'estimation échoue.
    const departmentUncovered = department
      ? !isDvfCoveredDepartment(department)
      : false;

    const estimate = await estimateProperty({
      propertyType: input.propertyType,
      surfaceM2: input.surfaceM2,
      rooms: input.rooms ?? null,
      latitude: place.latitude,
      longitude: place.longitude,
      radiusM: input.radiusM ?? null,
      monthsBack: input.monthsBack ?? null,
      inseeCode: place.inseeCode,
      subject: input.dpeClass ? { energyRating: input.dpeClass } : null,
    });

    return NextResponse.json({
      geocode: place,
      lowConfidenceAddress,
      departmentUncovered,
      estimate,
    });
  } catch (e) {
    console.error("[real-estate/estimate/address]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Estimation impossible") },
      { status: 500 }
    );
  }
}
