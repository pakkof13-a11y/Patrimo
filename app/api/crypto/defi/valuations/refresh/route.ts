import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage, clientErrorStatus } from "@/app/lib/api/error-response";
import { d } from "@/app/lib/money/decimal";
import { getDefiPortfolio } from "@/app/lib/crypto/defi-portfolio-service";
import {
  recordEvent,
  recordValuation,
} from "@/app/lib/crypto/defi-position-service";
import { duplicateIdsToExclude } from "@/app/lib/crypto/defi-dedup";
import { prisma } from "@/app/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * POST /api/crypto/defi/valuations/refresh
 *
 * Recalcule la valorisation de toutes les positions actives et en fige un
 * snapshot daté.
 *
 * Le snapshot ne devient **pas** la source de vérité : la valeur vivante
 * continue de venir du journal à chaque lecture. Ce que la route produit est une
 * trace — méthode retenue, score de confiance, raison d'un repli — pour qu'une
 * valeur affichée aujourd'hui reste explicable dans six mois, et pour qu'un
 * historique de valorisation existe même sur des positions dont le prix n'est
 * pas rétro-consultable.
 *
 * Repose les drapeaux de conflit au passage : la détection de double compte
 * dépend de l'ensemble des positions, elle n'a de sens qu'en lot.
 */
export async function POST() {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  try {
    const bundle = await getDefiPortfolio(userId);
    const valuationDate = new Date();

    let snapshots = 0;
    let skipped = 0;

    for (const position of bundle.positions) {
      // Une position non valorisable n'a pas de chiffre à figer : écrire un
      // zéro le rendrait indistinguable d'une position soldée.
      if (!position.valuation.isValuable) {
        skipped += 1;
        continue;
      }
      // Une valorisation manuelle est déjà figée par sa saisie : la réécrire à
      // chaque rafraîchissement en ferait perdre la date de décision.
      if (position.valuation.method === "MANUAL") {
        skipped += 1;
        continue;
      }

      await recordValuation(position.id, {
        valuationDate,
        valuationMethod: position.valuation.method,
        sourceProvider: position.dataOrigin === "MANUAL" ? "MANUAL" : "ZERION",
        grossValueEur: d(position.valuation.grossEur),
        netValueEur: d(position.valuation.netEur),
        debtValueEur: d(position.valuation.debtEur),
        collateralValueEur: d(position.valuation.collateralEur),
        rewardsValueEur: d(position.valuation.rewardsEur),
        retainedValueEur: d(position.valuation.retainedEur),
        lpUnderlyingValueEur: position.valuation.underlyingEur
          ? d(position.valuation.underlyingEur)
          : null,
        confidenceScore: position.valuation.confidenceScore,
        fallbackReason: position.valuation.fallbackReason,
      });
      snapshots += 1;
    }

    // ── Conflits de double compte ─────────────────────────────────────────────
    // Reposés à chaque rafraîchissement plutôt que maintenus au fil de l'eau :
    // un conflit dépend de l'ensemble des positions, et une position supprimée
    // doit pouvoir lever le drapeau de celle qui lui faisait doublon.
    //
    // Seules les positions réellement écartées des totaux sont marquées, et non
    // tous les `duplicateId` : dans une chaîne A→B→C, B est à la fois gardée et
    // doublon, et la marquer viderait la chaîne. `conflictFlag` signifie donc
    // exactement « exclue des totaux », ce qui permet aux agrégats crypto de
    // s'y fier sans rejouer la détection.
    const excludedIds = duplicateIdsToExclude(bundle.conflicts);
    const conflictReasons = new Map<string, string>();
    for (const c of bundle.conflicts) {
      if (!excludedIds.has(c.duplicateId)) continue;
      if (!conflictReasons.has(c.duplicateId)) {
        conflictReasons.set(c.duplicateId, c.reason);
      }
    }

    const allIds = bundle.positions.map((p) => p.id);
    if (allIds.length > 0) {
      await prisma.$transaction([
        prisma.defiPositionDetail.updateMany({
          where: { id: { in: allIds } },
          data: { conflictFlag: false, conflictReason: null },
        }),
        ...[...conflictReasons.entries()].map(([id, reason]) =>
          prisma.defiPositionDetail.update({
            where: { id },
            data: { conflictFlag: true, conflictReason: reason.slice(0, 500) },
          })
        ),
      ]);
    }

    // Trace du passage, pour distinguer « jamais valorisé » de « valorisé sans
    // qu'aucun prix ne soit disponible ».
    for (const position of bundle.positions) {
      if (position.valuation.isValuable) continue;
      await recordEvent(position.id, {
        eventType: "SYNC_REFRESH",
        eventDate: valuationDate,
        sourceProvider: "MANUAL",
        rawPayload: {
          outcome: "unvaluable",
          unpricedSymbols: position.valuation.unpricedSymbols,
          reason: position.valuation.fallbackReason,
        },
      });
    }

    return NextResponse.json({
      snapshots,
      skipped,
      conflictsFlagged: conflictReasons.size,
      totals: bundle.totals,
      valuationQuality: bundle.valuationQuality,
      valuationDate: valuationDate.toISOString(),
    });
  } catch (e) {
    console.error("[crypto/defi/valuations/refresh POST]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Rafraîchissement des valorisations impossible") },
      { status: clientErrorStatus(e) }
    );
  }
}
