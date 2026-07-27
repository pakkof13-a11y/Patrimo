import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  clientErrorMessage,
  clientErrorStatus,
} from "@/app/lib/api/error-response";
import {
  closeDefiPosition,
  createDefiPosition,
  DefiInputError,
} from "@/app/lib/crypto/defi-manual-service";
import { AccountingError } from "@/app/lib/accounting";
import { DEFI_POSITION_TYPES } from "@/app/lib/crypto/constants";

export const dynamic = "force-dynamic";

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+([.,]\d+)?$/, "Nombre invalide")
  .transform((v) => v.replace(",", "."));

const createSchema = z.object({
  platformId: z.string().min(1),
  assetSymbol: z.string().trim().min(1, "Actif requis").max(24),
  protocol: z.string().trim().min(1, "Protocole requis").max(80),
  positionType: z.enum(
    Object.keys(DEFI_POSITION_TYPES) as [string, ...string[]]
  ),
  chain: z.string().trim().max(40).optional().nullable(),

  quantity: decimalString,
  unitPriceEur: decimalString,
  openedAt: z.string().min(1, "Date d'engagement requise"),

  apyPct: decimalString.optional().nullable(),
  rewardsSymbol: z.string().trim().max(24).optional().nullable(),
  rewardsAmount: decimalString.optional().nullable(),
  rewardsValueEur: decimalString.optional().nullable(),

  healthFactor: decimalString.optional().nullable(),
  ltvPct: decimalString.optional().nullable(),
  liqThresholdPct: decimalString.optional().nullable(),

  pairedSymbol: z.string().trim().max(24).optional().nullable(),
  pairedAmount: decimalString.optional().nullable(),
  pairedEntryPriceEur: decimalString.optional().nullable(),
  poolAddress: z.string().trim().max(120).optional().nullable(),

  extraLegs: z
    .array(
      z.object({
        symbol: z.string().trim().min(1).max(24),
        amount: decimalString,
        entryPriceEur: decimalString,
        allocationPct: decimalString.optional().nullable(),
      })
    )
    .max(3) // 3ᵉ à 5ᵉ jeton — primaire + pairedSymbol couvrent les 2 premiers
    .optional()
    .nullable(),

  isConcentrated: z.boolean().optional(),
  priceRangeMin: decimalString.optional().nullable(),
  priceRangeMax: decimalString.optional().nullable(),
  token1AllocationPct: decimalString.optional().nullable(),
  pairedAllocationPct: decimalString.optional().nullable(),

  notes: z.string().trim().max(2000).optional().nullable(),
});

/** POST — saisie manuelle d'une position DeFi. */
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

  try {
    const result = await createDefiPosition(userId, parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    if (e instanceof DefiInputError || e instanceof AccountingError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/defi/positions POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Création de la position impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}

const closeSchema = z.object({
  assetId: z.string().min(1),
  exitUnitPriceEur: decimalString.optional().nullable(),
  closedAt: z.string().optional().nullable(),
});

/**
 * DELETE — dénoue une position.
 *
 * La quantité est ramenée à zéro par une écriture de sortie ; l'actif et son
 * historique restent en base. Une suppression franche effacerait les
 * récompenses perçues, qui restent dues fiscalement.
 */
export async function DELETE(req: Request) {
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

  const parsed = closeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    const out = await closeDefiPosition(userId, parsed.data.assetId, {
      exitUnitPriceEur: parsed.data.exitUnitPriceEur,
      closedAt: parsed.data.closedAt,
    });
    return NextResponse.json(out);
  } catch (e) {
    if (e instanceof DefiInputError || e instanceof AccountingError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/defi/positions DELETE]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Dénouement impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
