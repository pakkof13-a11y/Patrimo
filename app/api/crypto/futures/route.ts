import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  clientErrorMessage,
  clientErrorStatus,
} from "@/app/lib/api/error-response";
import { d } from "@/app/lib/money/decimal";
import {
  closeFuturesPosition,
  createFuturesPosition,
  deleteFuturesPosition,
  FuturesInputError,
  listFuturesPositions,
  updateFuturesPosition,
} from "@/app/lib/crypto/futures-service";
import {
  summarizeFutures,
  toFuturesView,
  type FuturesPositionInput,
} from "@/app/lib/crypto/futures";
import {
  CRYPTO_EXCHANGES,
  CRYPTO_MARGIN_TYPES,
  FUTURES_CONTRACT_TYPES,
} from "@/app/lib/crypto/futures-constants";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+([.,]\d+)?$/, "Nombre invalide")
  .transform((v) => v.replace(",", "."));

/**
 * GET /api/crypto/futures
 *
 * Positions ouvertes et fermées. La marge, le P&L latent et la distance de
 * liquidation sont recalculés à la lecture — rien n'est stocké en agrégat.
 */
export async function GET() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const rows = await listFuturesPositions(userId);
    const open = rows.filter((r) => r.isOpen);
    const closed = rows.filter((r) => !r.isOpen);

    const openInputs: FuturesPositionInput[] = open.map((r) => ({
      id: r.id,
      exchange: r.exchange,
      pair: r.pair,
      direction: r.direction as "LONG" | "SHORT",
      leverage: d(r.leverage.toString()),
      sizeContracts: d(r.sizeContracts.toString()),
      entryPrice: d(r.entryPrice.toString()),
      markPrice: r.markPrice ? d(r.markPrice.toString()) : null,
      marginUsed: r.marginUsed ? d(r.marginUsed.toString()) : null,
      fundingPaid: r.fundingPaid ? d(r.fundingPaid.toString()) : null,
      commissionPaid: r.commissionPaid ? d(r.commissionPaid.toString()) : null,
    }));

    const summary = summarizeFutures(openInputs);
    const views = openInputs.map(toFuturesView);
    const viewById = new Map(views.map((v) => [v.id, v]));

    return NextResponse.json(
      {
        open: open.map((r) => {
          const v = viewById.get(r.id)!;
          return {
            id: r.id,
            exchange: r.exchange,
            subAccountLabel: r.subAccountLabel,
            pair: r.pair,
            contractType: r.contractType,
            marginType: r.marginType,
            direction: r.direction,
            leverage: r.leverage.toString(),
            sizeContracts: r.sizeContracts.toString(),
            notionalUsd: v.notionalUsd.toFixed(2),
            entryPrice: r.entryPrice.toString(),
            markPrice: r.markPrice?.toString() ?? null,
            marginUsed: v.marginUsed.toFixed(2),
            fundingPaid: r.fundingPaid?.toString() ?? null,
            commissionPaid: r.commissionPaid?.toString() ?? null,
            unrealizedPnlEur: v.unrealizedPnlEur.toFixed(2),
            liquidationPrice: v.liquidationPrice?.toFixed(2) ?? null,
            distanceToLiquidationPct: v.distanceToLiquidationPct,
            liquidationAlert: v.liquidationAlert,
            fundingAlert: v.fundingAlert,
            stopLoss: r.stopLoss?.toString() ?? null,
            takeProfit: r.takeProfit?.toString() ?? null,
            openedAt: r.openedAt?.toISOString() ?? null,
          };
        }),
        closed: closed.map((r) => ({
          id: r.id,
          exchange: r.exchange,
          pair: r.pair,
          direction: r.direction,
          leverage: r.leverage.toString(),
          entryPrice: r.entryPrice.toString(),
          exitPrice: r.markPrice?.toString() ?? null,
          sizeContracts: r.sizeContracts.toString(),
          realizedPnl: r.realizedPnl?.toString() ?? null,
          fundingPaid: r.fundingPaid?.toString() ?? null,
          commissionPaid: r.commissionPaid?.toString() ?? null,
          closedAt: r.closedAt?.toISOString() ?? null,
        })),
        summary: {
          totalMarginEur: summary.totalMarginEur.toFixed(2),
          netExposureEur: summary.netExposureEur.toFixed(2),
          unrealizedPnlEur: summary.unrealizedPnlEur.toFixed(2),
          positionCount: summary.positionCount,
          liquidationAlerts: summary.liquidationAlerts,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[crypto/futures GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de chargement des positions futures") },
      { status: 500 }
    );
  }
}

const createSchema = z.object({
  exchange: z.enum(Object.keys(CRYPTO_EXCHANGES) as [string, ...string[]]),
  subAccountLabel: z.string().trim().max(80).optional().nullable(),
  pair: z.string().trim().min(1).max(40),
  contractType: z
    .enum(Object.keys(FUTURES_CONTRACT_TYPES) as [string, ...string[]])
    .optional(),
  marginType: z.enum(Object.keys(CRYPTO_MARGIN_TYPES) as [string, ...string[]]),
  baseCurrency: z.string().trim().min(1).max(20),
  quoteCurrency: z.string().trim().min(1).max(20),
  direction: z.enum(["LONG", "SHORT"]),
  leverage: decimalString,
  sizeContracts: decimalString,
  entryPrice: decimalString,
  markPrice: decimalString.optional().nullable(),
  marginUsed: decimalString.optional().nullable(),
  stopLoss: decimalString.optional().nullable(),
  takeProfit: decimalString.optional().nullable(),
  openedAt: z.string().min(1),
  notes: z.string().trim().max(2000).optional().nullable(),
});

/** POST — ouvre une position (wizard 3 étapes côté UI). */
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
    const result = await createFuturesPosition(userId, parsed.data);
    return NextResponse.json({ position: result }, { status: 201 });
  } catch (e) {
    if (e instanceof FuturesInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/futures POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Création impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}

const updateSchema = z.object({
  id: z.string().min(1),
  markPrice: decimalString.optional().nullable(),
  stopLoss: decimalString.optional().nullable(),
  takeProfit: decimalString.optional().nullable(),
  fundingPaid: decimalString.optional().nullable(),
  commissionPaid: decimalString.optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  /** Présent = demande de clôture plutôt qu'une simple mise à jour. */
  close: z.boolean().optional(),
  exitPrice: decimalString.optional().nullable(),
});

/** PUT — met à jour le mark price / SL-TP, ou clôture si `close: true`. */
export async function PUT(req: Request) {
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

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    );
  }

  try {
    if (parsed.data.close) {
      const closed = await closeFuturesPosition(
        userId,
        parsed.data.id,
        parsed.data.exitPrice
      );
      return NextResponse.json({ position: closed });
    }
    const updated = await updateFuturesPosition(userId, parsed.data.id, parsed.data);
    return NextResponse.json({ position: updated });
  } catch (e) {
    if (e instanceof FuturesInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/futures PUT]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Mise à jour impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}

/** DELETE — retire une position (?id=...). */
export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const id = new URL(req.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Identifiant requis" }, { status: 400 });
  }

  try {
    await deleteFuturesPosition(userId, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof FuturesInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/futures DELETE]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Suppression impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
