import { NextResponse, after } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import { refreshGeorisquesRisks } from "@/app/lib/real-estate/georisques";
import {
  PropertyUpdateError,
  planPropertyUpdate,
  type PropertyUpdateInput,
} from "@/app/lib/real-estate/property-update";

export const dynamic = "force-dynamic";

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+([.,]\d+)?$/, "Nombre invalide");

/**
 * Volontairement restreint au loyer, aux charges et à l'adresse.
 *
 * Le descriptif physique passe par `/characteristics`, le régime d'imposition
 * par `/fiscal`, la valeur par `/valuation` et le nom par le PATCH générique
 * `/api/assets/[id]` : chaque champ garde une porte d'entrée et une seule.
 *
 * L'usage, le type de bien et la quote-part restent hors de portée : ils
 * commandent la quantité et la valorisation de la position, donc se corrigent
 * par le journal, pas par un PATCH descriptif.
 */
const patchSchema = z
  .object({
    addressLine: z.string().trim().max(300).nullable().optional(),
    postalCode: z.string().trim().max(10).nullable().optional(),
    city: z.string().trim().max(120).nullable().optional(),
    /** Issus d'une sélection d'adresse (BAN), jamais saisis directement. */
    inseeCode: z.string().trim().max(10).nullable().optional(),
    latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
    longitude: z.coerce.number().min(-180).max(180).nullable().optional(),

    monthlyRentEur: decimalString.nullable().optional(),
    monthlyChargesEur: decimalString.nullable().optional(),
  })
  .strict();

/**
 * PATCH /api/real-estate/properties/[id]
 *
 * Loyer, charges et adresse d'un bien détenu en direct — les trois seules
 * données d'exploitation qu'on ne pouvait corriger nulle part après la
 * création. Un loyer se révise, une provision de charges s'ajuste, une adresse
 * se recopie de travers : les figer à vie fausse le rendement affiché, le
 * cash-flow, et les revenus fonciers déclarés.
 *
 * Changer l'adresse efface les coordonnées et les risques qui en découlent —
 * voir `property-update.ts` : sans cela, l'estimation DVF continuerait à
 * valoriser le bien sur son ancien quartier.
 *
 * La valeur du bien (`manualPrice`) n'est jamais touchée ici : corriger une
 * adresse ne revalorise pas un patrimoine, et une réévaluation reste une
 * décision explicite prise via `/valuation`.
 */
export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { id: assetId } = await ctx.params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    const detail = await prisma.realEstateDetail.findFirst({
      where: { assetId, asset: { is: { userId } } },
      select: { id: true, addressLine: true, postalCode: true, city: true },
    });
    if (!detail) {
      return NextResponse.json({ error: "Bien introuvable" }, { status: 404 });
    }

    // `safeParse` remplit les clés absentes par `undefined` : on repart du
    // corps reçu pour distinguer « champ non transmis » de « champ vidé ».
    const body = raw as Record<string, unknown>;
    const input: PropertyUpdateInput = {};
    for (const key of Object.keys(parsed.data) as Array<
      keyof typeof parsed.data
    >) {
      if (key in body) {
        (input as Record<string, unknown>)[key] = parsed.data[key];
      }
    }

    const plan = planPropertyUpdate(
      {
        addressLine: detail.addressLine,
        postalCode: detail.postalCode,
        city: detail.city,
      },
      input
    );

    if (Object.keys(plan.data).length === 0) {
      return NextResponse.json(
        { error: "Aucun champ à mettre à jour" },
        { status: 400 }
      );
    }

    const updated = await prisma.realEstateDetail.update({
      where: { id: detail.id },
      data: plan.data,
      select: {
        assetId: true,
        addressLine: true,
        postalCode: true,
        city: true,
        inseeCode: true,
        latitude: true,
        longitude: true,
        monthlyRentEur: true,
        monthlyChargesEur: true,
        georisquesFetched: true,
      },
    });

    // Même contrat qu'à la création : l'enrichissement Géorisques s'exécute
    // après l'envoi de la réponse et son échec ne remet jamais en cause la
    // correction déjà enregistrée.
    if (plan.georisquesPoint) {
      const point = plan.georisquesPoint;
      after(() => refreshGeorisquesRisks(assetId, point));
    }

    return NextResponse.json({
      property: {
        ...updated,
        monthlyRentEur: updated.monthlyRentEur?.toString() ?? null,
        monthlyChargesEur: updated.monthlyChargesEur?.toString() ?? null,
      },
      /** L'appelant sait ainsi que coordonnées et risques ont été remis à zéro. */
      addressChanged: plan.addressChanged,
    });
  } catch (e) {
    if (e instanceof PropertyUpdateError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[real-estate/properties PATCH]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Mise à jour impossible") },
      { status: 500 }
    );
  }
}
