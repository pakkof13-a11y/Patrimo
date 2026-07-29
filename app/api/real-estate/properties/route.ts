import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  clientErrorMessage,
  clientErrorStatus,
} from "@/app/lib/api/error-response";
import {
  createProperty,
  RealEstateInputError,
} from "@/app/lib/real-estate/property-service";
import { AccountingError } from "@/app/lib/accounting";
import { prisma } from "@/app/lib/prisma";
import {
  ENERGY_RATINGS,
  PROPERTY_TYPES,
  PROPERTY_USAGES,
} from "@/app/lib/real-estate/constants";

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+([.,]\d+)?$/, "Nombre invalide")
  .transform((v) => v.replace(",", "."));

const createSchema = z.object({
  platformId: z.string().min(1),
  name: z.string().trim().min(1, "Nom du bien requis").max(200),

  propertyType: z.enum(
    Object.keys(PROPERTY_TYPES) as [string, ...string[]]
  ),
  usage: z.enum(Object.keys(PROPERTY_USAGES) as [string, ...string[]]),

  /**
   * Quote-part détenue, en pourcentage côté client (plus naturel à saisir)
   * puis convertie en fraction — c'est cette fraction qui devient la quantité
   * de la position.
   */
  ownershipSharePct: z.coerce.number().gt(0).max(100).default(100),
  purchasePriceEur: decimalString,
  acquisitionFeesEur: decimalString.optional().nullable(),
  purchaseDate: z.string().min(1, "Date d'achat requise"),

  rooms: z.coerce.number().int().min(0).max(100).optional().nullable(),
  livingAreaM2: z.coerce.number().int().min(0).max(100_000).optional().nullable(),
  landAreaM2: z.coerce.number().int().min(0).max(10_000_000).optional().nullable(),

  addressLine: z.string().trim().max(300).optional().nullable(),
  postalCode: z.string().trim().max(10).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  /** Issus d'une sélection d'adresse (BAN), jamais saisis directement. */
  inseeCode: z.string().trim().max(10).optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),

  monthlyRentEur: decimalString.optional().nullable(),
  monthlyChargesEur: decimalString.optional().nullable(),
  annualPropertyTaxEur: decimalString.optional().nullable(),
  occupancyRatePct: decimalString.optional().nullable(),

  rentDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
  rentalStartDate: z.string().optional().nullable(),
  rentalEndDate: z.string().optional().nullable(),

  constructionYear: z.coerce.number().int().min(1000).max(2200).optional().nullable(),
  energyRating: z.enum(ENERGY_RATINGS).optional().nullable(),
  parkingSpots: z.coerce.number().int().min(0).max(1000).optional().nullable(),
  floor: z.coerce.number().int().min(-10).max(200).optional().nullable(),
  hasElevator: z.boolean().optional().nullable(),

  liabilityId: z.string().optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/** Liste des biens de l'utilisateur, avec leur dette rattachée. */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const rows = await prisma.realEstateDetail.findMany({
      where: { asset: { is: { userId } } },
      include: {
        asset: {
          select: {
            id: true,
            name: true,
            manualPrice: true,
            acquisitionDate: true,
            platform: { select: { id: true, name: true, subtype: true } },
            liabilities: {
              select: { id: true, name: true, remainingAmount: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      properties: rows.map((r) => ({
        assetId: r.assetId,
        name: r.asset.name,
        platform: r.asset.platform,
        propertyType: r.propertyType,
        usage: r.usage,
        rooms: r.rooms,
        livingAreaM2: r.livingAreaM2,
        landAreaM2: r.landAreaM2,
        addressLine: r.addressLine,
        postalCode: r.postalCode,
        city: r.city,
        latitude: r.latitude,
        longitude: r.longitude,
        valuationMode: r.valuationMode,
        lastValuedAt: r.lastValuedAt?.toISOString() ?? null,
        /** Valeur du bien **entier** — la position la pondère par la quote-part. */
        propertyValueEur: r.asset.manualPrice?.toString() ?? null,
        dvfEstimateEur: r.dvfEstimateEur?.toString() ?? null,
        dvfConfidence: r.dvfConfidence,
        dvfComparables: r.dvfComparables,
        monthlyRentEur: r.monthlyRentEur?.toString() ?? null,
        monthlyChargesEur: r.monthlyChargesEur?.toString() ?? null,
        annualPropertyTaxEur: r.annualPropertyTaxEur?.toString() ?? null,
        occupancyRatePct: r.occupancyRatePct?.toString() ?? null,
        constructionYear: r.constructionYear,
        energyRating: r.energyRating,
        parkingSpots: r.parkingSpots,
        floor: r.floor,
        hasElevator: r.hasElevator,
        totalFloors: r.totalFloors,
        orientation: r.orientation,
        viewType: r.viewType,
        hasBalcony: r.hasBalcony,
        balconyAreaM2: r.balconyAreaM2,
        hasGarden: r.hasGarden,
        gardenAreaM2: r.gardenAreaM2,
        hasCellar: r.hasCellar,
        dpeKwhM2Year: r.dpeKwhM2Year,
        gesRating: r.gesRating,
        heatingType: r.heatingType,
        windowQuality: r.windowQuality,
        isCopropriete: r.isCopropriete,
        annualCoproChargesEur: r.annualCoproChargesEur?.toString() ?? null,
        annualCoproProvisions: r.annualCoproProvisions?.toString() ?? null,
        annualHabitationTaxEur: r.annualHabitationTaxEur?.toString() ?? null,
        rentalRegime: r.rentalRegime,
        taxScheme: r.taxScheme,
        commitmentEndDate: r.commitmentEndDate?.toISOString() ?? null,
        isClassifiedTourism: r.isClassifiedTourism,
        schemeStartYear: r.schemeStartYear,
        schemeCommitmentYears: r.schemeCommitmentYears,
        schemeBaseEur: r.schemeBaseEur?.toString() ?? null,
        schemeRatePct: r.schemeRatePct?.toString() ?? null,
        loans: r.asset.liabilities.map((l) => ({
          id: l.id,
          name: l.name,
          remainingAmountEur: l.remainingAmount.toString(),
        })),
      })),
    });
  } catch (e) {
    console.error("[real-estate/properties GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de chargement des biens") },
      { status: clientErrorStatus(e) }
    );
  }
}

export async function POST(req: Request) {
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

  const parsed = createSchema.safeParse(body);
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

  const { ownershipSharePct, ...rest } = parsed.data;

  try {
    const result = await createProperty(userId, {
      ...rest,
      // Pourcentage saisi → fraction stockée en quantité de position.
      ownershipShare: String(ownershipSharePct / 100),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof RealEstateInputError || e instanceof AccountingError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[real-estate/properties POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Création du bien impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
