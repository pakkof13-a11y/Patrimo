import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage, clientErrorStatus } from "@/app/lib/api/error-response";
import { prisma } from "@/app/lib/prisma";
import { DefiInputError } from "@/app/lib/crypto/defi-manual-service";
import { getDefiPortfolio } from "@/app/lib/crypto/defi-portfolio-service";
import { recordEvent, replaceLegs } from "@/app/lib/crypto/defi-position-service";
import {
  ACCESS_MODE_KEYS,
  CUSTODY_MODEL_KEYS,
  LEG_TYPE_KEYS,
  POSITION_STATUS_KEYS,
  requiresBlockchain,
  requiresProtocol,
} from "@/app/lib/crypto/defi-taxonomy";

export const dynamic = "force-dynamic";

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+([.,]\d+)?$/, "Nombre invalide")
  .transform((v) => v.replace(",", "."));

/**
 * GET /api/crypto/defi/positions/[id]
 *
 * Détail d'une position, enrichi exactement comme dans la vue portefeuille — la
 * même valorisation, les mêmes jambes, le même diagnostic de conflit. Passer par
 * `getDefiPortfolio` plutôt que de requêter la position seule évite deux
 * chemins de valorisation divergents : un détail qui n'afficherait pas le même
 * chiffre que la liste serait un bug impossible à expliquer.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }
  const { id } = await ctx.params;

  try {
    // `includeInactive` : consulter le détail d'une position fermée est
    // légitime, c'est même le cas où l'historique importe le plus.
    const bundle = await getDefiPortfolio(userId, { includeInactive: true });
    const position = bundle.positions.find((p) => p.id === id);
    if (!position) {
      return NextResponse.json({ error: "Position introuvable" }, { status: 404 });
    }

    const events = await prisma.defiEvent.findMany({
      where: { defiPositionId: id },
      orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    });
    const valuations = await prisma.defiValuation.findMany({
      where: { defiPositionId: id },
      orderBy: { valuationDate: "desc" },
      take: 60,
    });

    return NextResponse.json({
      position,
      conflicts: bundle.conflicts.filter(
        (c) => c.duplicateId === id || c.keepId === id
      ),
      events: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        eventDate: e.eventDate.toISOString(),
        chainId: e.chainId,
        txHash: e.txHash,
        symbol: e.symbol,
        quantity: e.quantity?.toString() ?? null,
        amountEur: e.amountEur?.toString() ?? null,
        feesEur: e.feesEur?.toString() ?? null,
        relatedProtocol: e.relatedProtocol,
        ledgerTransactionId: e.ledgerTransactionId,
        sourceProvider: e.sourceProvider,
      })),
      valuations: valuations.map((v) => ({
        id: v.id,
        valuationDate: v.valuationDate.toISOString(),
        valuationMethod: v.valuationMethod,
        sourceProvider: v.sourceProvider,
        grossValueEur: v.grossValueEur?.toString() ?? null,
        netValueEur: v.netValueEur?.toString() ?? null,
        debtValueEur: v.debtValueEur?.toString() ?? null,
        retainedValueEur: v.retainedValueEur?.toString() ?? null,
        confidenceScore: v.confidenceScore,
        isManual: v.isManual,
        fallbackReason: v.fallbackReason,
      })),
    });
  } catch (e) {
    console.error("[crypto/defi/positions/[id] GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Chargement de la position impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}

const updateSchema = z.object({
  accessMode: z.enum(ACCESS_MODE_KEYS).optional(),
  custodyModel: z.enum(CUSTODY_MODEL_KEYS).optional(),
  ownerLabel: z.string().trim().max(120).nullable().optional(),
  ownershipPct: decimalString.nullable().optional(),

  protocol: z.string().trim().min(1).max(80).optional(),
  protocolVersion: z.string().trim().max(24).nullable().optional(),
  underlyingProtocol: z.string().trim().max(80).nullable().optional(),
  chain: z.string().trim().max(40).nullable().optional(),
  marketRef: z.string().trim().max(120).nullable().optional(),
  vaultRef: z.string().trim().max(120).nullable().optional(),
  poolRef: z.string().trim().max(120).nullable().optional(),
  validatorName: z.string().trim().max(120).nullable().optional(),
  nftPositionRef: z.string().trim().max(120).nullable().optional(),

  /**
   * `CLOSED` et `LIQUIDATED` sont refusés ici : les atteindre demande de
   * ramener la quantité à zéro au journal, ce que seul `DELETE
   * /api/crypto/defi/positions` sait faire. Les accepter laisserait une
   * position « fermée » portant encore des jetons.
   */
  status: z
    .enum(POSITION_STATUS_KEYS)
    .refine((s) => s !== "CLOSED" && s !== "LIQUIDATED", {
      message:
        "Utilisez le dénouement pour fermer ou liquider une position — le statut seul laisserait des jetons au journal",
    })
    .optional(),
  isHidden: z.boolean().optional(),
  isIgnoredInPortfolio: z.boolean().optional(),
  linkedPositionId: z.string().min(1).nullable().optional(),

  apyPct: decimalString.nullable().optional(),
  healthFactor: decimalString.nullable().optional(),
  ltvPct: decimalString.nullable().optional(),
  liqThresholdPct: decimalString.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),

  /** Remplacement complet des composantes — omis, elles restent inchangées. */
  legs: z
    .array(
      z.object({
        legType: z.enum(LEG_TYPE_KEYS),
        symbol: z.string().trim().min(1).max(24),
        quantity: decimalString,
        tokenRole: z.string().trim().max(40).nullable().optional(),
        unitCostEur: decimalString.nullable().optional(),
        isActive: z.boolean().optional(),
      })
    )
    .max(12)
    .optional(),
});

/**
 * PUT /api/crypto/defi/positions/[id]
 *
 * Met à jour le contexte d'une position. N'écrit jamais de quantité ni de
 * valeur : celles-ci viennent du journal, et les rendre éditables ici
 * ouvrirait précisément le « mini-système parallèle de soldes » que
 * l'architecture interdit. Les composantes (`legs`) décrivent la répartition de
 * l'exposition, pas son montant total.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
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

  const parsed = updateSchema.safeParse(body);
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
    const existing = await prisma.defiPositionDetail.findFirst({
      where: { id, asset: { is: { userId } } },
      select: {
        id: true,
        accessMode: true,
        protocol: true,
        chain: true,
        positionType: true,
        // Trois champs qui changent ce que la position *pèse* au patrimoine —
        // relus pour n'historiser qu'un changement réel (cf. plus bas).
        status: true,
        isIgnoredInPortfolio: true,
        ownershipPct: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "Position introuvable" }, { status: 404 });
    }

    // Cohérence après fusion, et non sur le seul corps de la requête : passer
    // une position CEFI sans protocole en DEFI doit échouer même si la requête
    // ne mentionne que `accessMode`.
    const accessMode = input.accessMode ?? existing.accessMode;
    const protocol =
      input.protocol !== undefined ? input.protocol : existing.protocol;
    const chain = input.chain !== undefined ? input.chain : existing.chain;

    if (requiresProtocol(accessMode) && !protocol?.trim()) {
      return NextResponse.json(
        {
          error:
            "Une position DeFi doit préciser son protocole — utilisez le mode CEFI si la plateforme ne le divulgue pas",
        },
        { status: 400 }
      );
    }
    if (requiresBlockchain(accessMode) && !chain?.trim()) {
      return NextResponse.json(
        {
          error:
            "Une position DeFi doit préciser sa chaîne — utilisez le mode CEFI pour un produit custodial",
        },
        { status: 400 }
      );
    }

    if (input.ownershipPct != null) {
      const pct = Number(input.ownershipPct);
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) {
        return NextResponse.json(
          { error: "La quote-part doit être comprise dans ]0 ; 100]" },
          { status: 400 }
        );
      }
    }

    if (input.linkedPositionId) {
      if (input.linkedPositionId === id) {
        return NextResponse.json(
          { error: "Une position ne peut pas être liée à elle-même" },
          { status: 400 }
        );
      }
      const linked = await prisma.defiPositionDetail.findFirst({
        where: { id: input.linkedPositionId, asset: { is: { userId } } },
        select: { id: true },
      });
      if (!linked) {
        return NextResponse.json(
          { error: "Position liée introuvable" },
          { status: 400 }
        );
      }
    }

    // Une dette déclarée sur une position qui n'est ni un emprunt ni un CDP se
    // retrancherait du patrimoine sans qu'aucun libellé ne l'explique.
    if (input.legs?.some((l) => l.legType === "DEBT")) {
      if (existing.positionType !== "BORROWING" && existing.positionType !== "CDP") {
        return NextResponse.json(
          {
            error: `Une composante DEBT n'a pas de sens sur une position ${existing.positionType} — utilisez BORROWING ou CDP`,
          },
          { status: 400 }
        );
      }
    }
    if (existing.positionType === "BORROWING" && input.legs && input.legs.length > 0) {
      if (!input.legs.some((l) => l.legType === "DEBT")) {
        return NextResponse.json(
          {
            error:
              "Un emprunt doit conserver au moins une composante DEBT — sans elle, la dette ne serait pas retranchée du patrimoine",
          },
          { status: 400 }
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.defiPositionDetail.update({
        where: { id },
        data: {
          ...(input.accessMode !== undefined ? { accessMode: input.accessMode } : {}),
          ...(input.custodyModel !== undefined
            ? { custodyModel: input.custodyModel }
            : {}),
          ...(input.ownerLabel !== undefined
            ? { ownerLabel: input.ownerLabel?.trim() || null }
            : {}),
          ...(input.ownershipPct !== undefined
            ? { ownershipPct: input.ownershipPct }
            : {}),
          ...(input.protocol !== undefined ? { protocol: input.protocol } : {}),
          ...(input.protocolVersion !== undefined
            ? { protocolVersion: input.protocolVersion?.trim() || null }
            : {}),
          ...(input.underlyingProtocol !== undefined
            ? { underlyingProtocol: input.underlyingProtocol?.trim() || null }
            : {}),
          ...(input.chain !== undefined ? { chain: input.chain?.trim() || null } : {}),
          ...(input.marketRef !== undefined
            ? { marketRef: input.marketRef?.trim() || null }
            : {}),
          ...(input.vaultRef !== undefined
            ? { vaultRef: input.vaultRef?.trim() || null }
            : {}),
          ...(input.poolRef !== undefined
            ? { poolRef: input.poolRef?.trim() || null }
            : {}),
          ...(input.validatorName !== undefined
            ? { validatorName: input.validatorName?.trim() || null }
            : {}),
          ...(input.nftPositionRef !== undefined
            ? { nftPositionRef: input.nftPositionRef?.trim() || null }
            : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.isHidden !== undefined ? { isHidden: input.isHidden } : {}),
          ...(input.isIgnoredInPortfolio !== undefined
            ? { isIgnoredInPortfolio: input.isIgnoredInPortfolio }
            : {}),
          ...(input.linkedPositionId !== undefined
            ? { linkedPositionId: input.linkedPositionId }
            : {}),
          ...(input.apyPct !== undefined ? { apyPct: input.apyPct } : {}),
          ...(input.healthFactor !== undefined
            ? { healthFactor: input.healthFactor }
            : {}),
          ...(input.ltvPct !== undefined ? { ltvPct: input.ltvPct } : {}),
          ...(input.liqThresholdPct !== undefined
            ? { liqThresholdPct: input.liqThresholdPct }
            : {}),
          ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        },
      });

      if (input.legs) {
        await replaceLegs(
          id,
          input.legs.map((l) => ({
            legType: l.legType,
            symbol: l.symbol,
            quantity: l.quantity,
            tokenRole: l.tokenRole ?? null,
            unitCostEur: l.unitCostEur ?? null,
            isActive: l.isActive,
          })),
          tx as Parameters<typeof replaceLegs>[2]
        );
      }

      // Une édition qui change l'exclusion patrimoniale, le statut ou la
      // quote-part modifie ce que la position pèse : historisée au même titre
      // que via la route `flags`. Les autres champs (libellés, références
      // d'infrastructure, notes) sont descriptifs et ne le sont pas — sinon le
      // journal se remplirait de corrections de frappe.
      const ownershipChanged =
        input.ownershipPct !== undefined &&
        String(input.ownershipPct ?? "") !== String(existing.ownershipPct ?? "");
      const statusChanged = input.status !== undefined && input.status !== existing.status;
      const ignoreChanged =
        input.isIgnoredInPortfolio !== undefined &&
        input.isIgnoredInPortfolio !== existing.isIgnoredInPortfolio;

      if (ownershipChanged || statusChanged || ignoreChanged) {
        await recordEvent(
          id,
          {
            eventType: "MANUAL_OVERRIDE",
            eventDate: new Date(),
            sourceProvider: "MANUAL",
            rawPayload: {
              ...(ignoreChanged
                ? { isIgnoredInPortfolio: input.isIgnoredInPortfolio }
                : {}),
              ...(statusChanged
                ? { statusFrom: existing.status, statusTo: input.status }
                : {}),
              ...(ownershipChanged
                ? {
                    ownershipPctFrom: existing.ownershipPct?.toString() ?? null,
                    ownershipPctTo: input.ownershipPct ?? null,
                  }
                : {}),
            },
          },
          tx
        );
      }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof DefiInputError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[crypto/defi/positions/[id] PUT]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Mise à jour impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
