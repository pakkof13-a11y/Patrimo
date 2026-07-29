import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { clientErrorMessage } from "@/app/lib/api/error-response";
import {
  ENERGY_RATINGS,
  GES_RATINGS,
  HEATING_TYPES,
  ORIENTATIONS,
  VIEW_TYPES,
  WINDOW_QUALITIES,
} from "@/app/lib/real-estate/constants";

export const dynamic = "force-dynamic";

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+([.,]\d+)?$/, "Nombre invalide")
  .transform((v) => v.replace(",", "."));

const patchSchema = z.object({
  // ── Physique ──
  constructionYear: z.coerce.number().int().min(1000).max(2200).nullable().optional(),
  floor: z.coerce.number().int().min(-10).max(200).nullable().optional(),
  totalFloors: z.coerce.number().int().min(0).max(200).nullable().optional(),
  hasElevator: z.boolean().nullable().optional(),
  orientation: z
    .enum(Object.keys(ORIENTATIONS) as [string, ...string[]])
    .nullable()
    .optional(),
  viewType: z
    .enum(Object.keys(VIEW_TYPES) as [string, ...string[]])
    .nullable()
    .optional(),
  hasBalcony: z.boolean().nullable().optional(),
  balconyAreaM2: z.coerce.number().int().min(0).max(10_000).nullable().optional(),
  hasGarden: z.boolean().nullable().optional(),
  gardenAreaM2: z.coerce.number().int().min(0).max(10_000_000).nullable().optional(),
  hasCellar: z.boolean().nullable().optional(),
  parkingSpots: z.coerce.number().int().min(0).max(1000).nullable().optional(),

  // ── État et performance énergétique ──
  energyRating: z.enum(ENERGY_RATINGS).nullable().optional(),
  dpeKwhM2Year: z.coerce.number().int().min(0).max(10_000).nullable().optional(),
  gesRating: z.enum(GES_RATINGS).nullable().optional(),
  heatingType: z
    .enum(Object.keys(HEATING_TYPES) as [string, ...string[]])
    .nullable()
    .optional(),
  windowQuality: z
    .enum(Object.keys(WINDOW_QUALITIES) as [string, ...string[]])
    .nullable()
    .optional(),

  // ── Copropriété ──
  isCopropriete: z.boolean().nullable().optional(),
  annualCoproChargesEur: decimalString.nullable().optional(),
  annualCoproProvisions: decimalString.nullable().optional(),

  // ── Fiscalité locale ──
  annualHabitationTaxEur: decimalString.nullable().optional(),

  // ── Équipements complémentaires ──
  hasPool: z.boolean().nullable().optional(),
  bathroomCount: z.coerce.number().int().min(0).max(50).nullable().optional(),
  hasAirConditioning: z.boolean().nullable().optional(),
  hasFireplace: z.boolean().nullable().optional(),
  hasAlarm: z.boolean().nullable().optional(),
});

// Les risques (riskFlood, riskSeismic, riskRadon, riskClaySoil,
// georisquesFetched) sont volontairement absents de ce schéma : ce sont des
// champs renseignés par `refreshGeorisquesRisks`, jamais par une saisie
// utilisateur — un PATCH qui les accepterait permettrait d'écraser une donnée
// de source officielle par une valeur inventée.

/**
 * PATCH /api/real-estate/properties/[id]/characteristics
 *
 * Descriptif physique, état/DPE, copropriété et fiscalité locale d'un bien —
 * séparé de la création comme `/fiscal` : ce sont des détails qu'on précise
 * ou corrige après coup, pas des champs qui bloquent l'entrée au patrimoine.
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
  const input = parsed.data;

  try {
    const detail = await prisma.realEstateDetail.findFirst({
      where: { assetId, asset: { is: { userId } } },
      select: { id: true },
    });
    if (!detail) {
      return NextResponse.json({ error: "Bien introuvable" }, { status: 404 });
    }

    const set = <K extends keyof typeof input>(key: K) =>
      input[key] !== undefined ? { [key]: input[key] } : {};

    const updated = await prisma.realEstateDetail.update({
      where: { id: detail.id },
      data: {
        ...set("constructionYear"),
        ...set("floor"),
        ...set("totalFloors"),
        ...set("hasElevator"),
        ...set("orientation"),
        ...set("viewType"),
        ...set("hasBalcony"),
        ...set("balconyAreaM2"),
        ...set("hasGarden"),
        ...set("gardenAreaM2"),
        ...set("hasCellar"),
        ...set("parkingSpots"),
        ...set("energyRating"),
        ...set("dpeKwhM2Year"),
        ...set("gesRating"),
        ...set("heatingType"),
        ...set("windowQuality"),
        ...set("isCopropriete"),
        ...set("annualCoproChargesEur"),
        ...set("annualCoproProvisions"),
        ...set("annualHabitationTaxEur"),
        ...set("hasPool"),
        ...set("bathroomCount"),
        ...set("hasAirConditioning"),
        ...set("hasFireplace"),
        ...set("hasAlarm"),
      },
      select: {
        assetId: true,
        constructionYear: true,
        floor: true,
        totalFloors: true,
        hasElevator: true,
        orientation: true,
        viewType: true,
        hasBalcony: true,
        balconyAreaM2: true,
        hasGarden: true,
        gardenAreaM2: true,
        hasCellar: true,
        parkingSpots: true,
        energyRating: true,
        dpeKwhM2Year: true,
        gesRating: true,
        heatingType: true,
        windowQuality: true,
        isCopropriete: true,
        annualCoproChargesEur: true,
        annualCoproProvisions: true,
        annualHabitationTaxEur: true,
        hasPool: true,
        bathroomCount: true,
        hasAirConditioning: true,
        hasFireplace: true,
        hasAlarm: true,
      },
    });

    return NextResponse.json({
      property: {
        ...updated,
        annualCoproChargesEur: updated.annualCoproChargesEur?.toString() ?? null,
        annualCoproProvisions: updated.annualCoproProvisions?.toString() ?? null,
        annualHabitationTaxEur: updated.annualHabitationTaxEur?.toString() ?? null,
      },
    });
  } catch (e) {
    console.error("[real-estate/properties/characteristics PATCH]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Mise à jour impossible") },
      { status: 500 }
    );
  }
}
