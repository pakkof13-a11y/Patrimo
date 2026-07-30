import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage, clientErrorStatus } from "@/app/lib/api/error-response";
import { prisma } from "@/app/lib/prisma";
import { DefiInputError } from "@/app/lib/crypto/defi-manual-service";
import {
  claimReward,
  listEvents,
  recordEvent,
} from "@/app/lib/crypto/defi-position-service";
import {
  EVENT_TYPE_KEYS,
  PROVIDER_KEYS,
  REWARD_TYPE_KEYS,
  isLedgerBackedEvent,
} from "@/app/lib/crypto/defi-taxonomy";

export const dynamic = "force-dynamic";

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+([.,]\d+)?$/, "Nombre invalide")
  .transform((v) => v.replace(",", "."));

/** GET — journal d'événements d'une position. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const eventType = url.searchParams.get("eventType");
  const limitRaw = url.searchParams.get("limit");
  const limit = limitRaw ? Number(limitRaw) : undefined;

  if (eventType && !(EVENT_TYPE_KEYS as readonly string[]).includes(eventType)) {
    return NextResponse.json({ error: "Type d'événement inconnu" }, { status: 400 });
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return NextResponse.json({ error: "Limite invalide" }, { status: 400 });
  }

  try {
    const events = await listEvents(userId, id, { limit, eventType });
    return NextResponse.json({
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        eventDate: e.eventDate.toISOString(),
        chainId: e.chainId,
        txHash: e.txHash,
        symbol: e.symbol,
        fromAddress: e.fromAddress,
        toAddress: e.toAddress,
        quantity: e.quantity?.toString() ?? null,
        amountEur: e.amountEur?.toString() ?? null,
        feesEur: e.feesEur?.toString() ?? null,
        relatedProtocol: e.relatedProtocol,
        ledgerTransactionId: e.ledgerTransactionId,
        sourceProvider: e.sourceProvider,
      })),
    });
  } catch (e) {
    if (e instanceof DefiInputError) {
      return NextResponse.json({ error: e.message }, { status: 404 });
    }
    console.error("[crypto/defi/positions/[id]/events GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Chargement des événements impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}

const eventSchema = z.object({
  eventType: z.enum(EVENT_TYPE_KEYS),
  eventDate: z.string().min(1, "Date d'événement requise"),
  chainId: z.string().trim().max(40).nullable().optional(),
  txHash: z.string().trim().max(120).nullable().optional(),
  symbol: z.string().trim().max(24).nullable().optional(),
  fromAddress: z.string().trim().max(120).nullable().optional(),
  toAddress: z.string().trim().max(120).nullable().optional(),
  quantity: decimalString.nullable().optional(),
  amountEur: decimalString.nullable().optional(),
  feesEur: decimalString.nullable().optional(),
  relatedProtocol: z.string().trim().max(80).nullable().optional(),
  sourceProvider: z.enum(PROVIDER_KEYS).optional(),
  /**
   * Réclamation de récompense : décrémente l'accru et incrémente le réclamé.
   * Sans ce couple, une récompense réclamée resterait comptée « en attente » en
   * plus d'être arrivée au portefeuille — comptée deux fois.
   */
  rewardType: z.enum(REWARD_TYPE_KEYS).optional(),
});

/**
 * POST — enregistre un événement de cycle de vie.
 *
 * Un événement n'écrit **jamais** de quantité au journal : il la qualifie. Une
 * quantité qui change de main relève d'une écriture (`/api/transactions`), et
 * laisser cette route en créer ferait d'elle un second ledger.
 *
 * Seule exception assumée : `CLAIM_REWARD` met à jour le compteur d'accru de
 * `DefiReward`, qui n'est pas une quantité valorisée du portefeuille mais un
 * suivi de créance envers le protocole.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await ctx.params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = eventSchema.safeParse(body);
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
  const input = parsed.data;

  try {
    const position = await prisma.defiPositionDetail.findFirst({
      where: { id, asset: { is: { userId } } },
      select: { id: true, status: true },
    });
    if (!position) {
      return NextResponse.json({ error: "Position introuvable" }, { status: 404 });
    }

    // Un événement de flux sur une position fermée est une incohérence : soit la
    // position n'était pas fermée, soit l'événement concerne autre chose.
    // L'accepter en silence produirait un historique qui contredit le statut.
    if (
      (position.status === "CLOSED" || position.status === "LIQUIDATED") &&
      isLedgerBackedEvent(input.eventType)
    ) {
      return NextResponse.json(
        {
          error: `Position ${position.status.toLowerCase()} — aucun flux ne peut plus s'y rattacher. Rouvrez-la ou corrigez son statut.`,
        },
        { status: 400 }
      );
    }

    if (input.eventType === "CLAIM_REWARD") {
      if (!input.symbol || !input.quantity) {
        return NextResponse.json(
          {
            error:
              "Une réclamation doit préciser le jeton et la quantité réclamée",
          },
          { status: 400 }
        );
      }
      await claimReward(id, input.symbol, input.quantity, {
        rewardType: input.rewardType,
      });
    }

    const event = await recordEvent(id, {
      eventType: input.eventType,
      eventDate: input.eventDate,
      chainId: input.chainId,
      txHash: input.txHash,
      symbol: input.symbol,
      fromAddress: input.fromAddress,
      toAddress: input.toAddress,
      quantity: input.quantity,
      amountEur: input.amountEur,
      feesEur: input.feesEur,
      relatedProtocol: input.relatedProtocol,
      sourceProvider: input.sourceProvider,
    });

    return NextResponse.json(event, { status: event.created ? 201 : 200 });
  } catch (e) {
    if (e instanceof DefiInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/defi/positions/[id]/events POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Enregistrement de l'événement impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
