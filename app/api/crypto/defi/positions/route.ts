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
import { setPositionStrategy } from "@/app/lib/crypto/defi-strategy-service";
import { AccountingError } from "@/app/lib/accounting";
import { DEFI_POSITION_TYPES } from "@/app/lib/crypto/constants";
import {
  ACCESS_MODE_KEYS,
  CUSTODY_MODEL_KEYS,
  DATA_ORIGIN_KEYS,
  LEG_TYPE_KEYS,
  POSITION_STATUS_KEYS,
  REWARD_TYPE_KEYS,
} from "@/app/lib/crypto/defi-taxonomy";

export const dynamic = "force-dynamic";

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+([.,]\d+)?$/, "Nombre invalide")
  .transform((v) => v.replace(",", "."));

const createSchema = z.object({
  platformId: z.string().min(1),
  assetSymbol: z.string().trim().min(1, "Actif requis").max(24),
  /**
   * Vide accepté : `validateAccessContext` (couche service) est seule
   * responsable de l'obligation, qui ne s'applique qu'en DeFi directe — un
   * produit CeFi ou hybride ne divulgue pas toujours son protocole, et
   * l'exiger ici forcerait l'utilisateur à en inventer un.
   */
  protocol: z.string().trim().max(80).optional().default(""),
  positionType: z.enum(
    Object.keys(DEFI_POSITION_TYPES) as [string, ...string[]]
  ),
  chain: z.string().trim().max(40).optional().nullable(),
  strategyId: z.string().min(1).optional().nullable(),

  unlockAt: z.string().optional().nullable(),
  cliffAt: z.string().optional().nullable(),
  vestingSchedule: z
    .array(
      z.object({
        cliffAt: z.string().optional().nullable(),
        endAt: z.string().min(1),
        amount: decimalString,
      })
    )
    .max(24) // vesting mensuel sur 2 ans, plafond large mais pas illimité
    .optional()
    .nullable(),

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

  extraRewardLegs: z
    .array(
      z.object({
        symbol: z.string().trim().min(1).max(24),
        amount: decimalString,
        valueEur: decimalString,
        source: z.string().trim().max(80).optional().nullable(),
      })
    )
    .max(5)
    .optional()
    .nullable(),

  isConcentrated: z.boolean().optional(),
  priceRangeMin: decimalString.optional().nullable(),
  priceRangeMax: decimalString.optional().nullable(),
  token1AllocationPct: decimalString.optional().nullable(),
  pairedAllocationPct: decimalString.optional().nullable(),

  notes: z.string().trim().max(2000).optional().nullable(),

  // ── Contexte d'accès, cycle de vie et composantes (chantier F1) ──
  // Tous optionnels : les appelants existants continuent de fonctionner, la
  // position prend alors les défauts historiques (`DEFI`, `ACTIVE`, 100 %).
  accessMode: z.enum(ACCESS_MODE_KEYS).optional().nullable(),
  custodyModel: z.enum(CUSTODY_MODEL_KEYS).optional().nullable(),
  dataOrigin: z.enum(DATA_ORIGIN_KEYS).optional().nullable(),
  ownerLabel: z.string().trim().max(120).optional().nullable(),
  /** ]0 ; 100] — la borne haute est vérifiée ici *et* dans le service. */
  ownershipPct: decimalString.optional().nullable(),

  protocolVersion: z.string().trim().max(24).optional().nullable(),
  underlyingProtocol: z.string().trim().max(80).optional().nullable(),
  marketRef: z.string().trim().max(120).optional().nullable(),
  vaultRef: z.string().trim().max(120).optional().nullable(),
  poolRef: z.string().trim().max(120).optional().nullable(),
  validatorName: z.string().trim().max(120).optional().nullable(),
  nftPositionRef: z.string().trim().max(120).optional().nullable(),

  status: z.enum(POSITION_STATUS_KEYS).optional().nullable(),
  isHidden: z.boolean().optional(),
  isIgnoredInPortfolio: z.boolean().optional(),
  linkedPositionId: z.string().min(1).optional().nullable(),

  legs: z
    .array(
      z.object({
        legType: z.enum(LEG_TYPE_KEYS),
        symbol: z.string().trim().min(1).max(24),
        quantity: decimalString,
        tokenRole: z.string().trim().max(40).optional().nullable(),
        unitCostEur: decimalString.optional().nullable(),
        metadata: z.record(z.string(), z.unknown()).optional().nullable(),
      })
    )
    .max(12)
    .optional()
    .nullable(),

  rewards: z
    .array(
      z.object({
        symbol: z.string().trim().min(1).max(24),
        rewardType: z.enum(REWARD_TYPE_KEYS).optional(),
        accruedQuantity: decimalString.optional().nullable(),
        valueEur: decimalString.optional().nullable(),
        sourceLabel: z.string().trim().max(80).optional().nullable(),
      })
    )
    .max(8)
    .optional()
    .nullable(),
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
  /**
   * Sortie subie et non choisie. Les deux ramènent la quantité à zéro, mais
   * confondre l'une avec l'autre effacerait l'événement le plus important de
   * l'historique d'un emprunt.
   */
  liquidated: z.boolean().optional(),
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
      liquidated: parsed.data.liquidated,
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

const strategySchema = z.object({
  positionId: z.string().min(1),
  /** `null` détache la position de toute stratégie. */
  strategyId: z.string().min(1).nullable(),
});

/** PATCH — rattache ou détache une position d'une stratégie (`DefiStrategy`). */
export async function PATCH(req: Request) {
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

  const parsed = strategySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    await setPositionStrategy(
      userId,
      parsed.data.positionId,
      parsed.data.strategyId
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof DefiInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/defi/positions PATCH]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Rattachement impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
