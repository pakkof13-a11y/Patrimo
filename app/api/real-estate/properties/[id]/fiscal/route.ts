import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import {
  RENTAL_REGIMES,
  TAX_SCHEMES,
  isRentalUsage,
  regimesForUsage,
} from "@/app/lib/real-estate/constants";
import { clientErrorMessage } from "@/app/lib/api/error-response";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  rentalRegime: z
    .enum(Object.keys(RENTAL_REGIMES) as [string, ...string[]])
    .nullable()
    .optional(),
  taxScheme: z
    .enum(Object.keys(TAX_SCHEMES) as [string, ...string[]])
    .nullable()
    .optional(),
  commitmentEndDate: z.string().nullable().optional(),
  isClassifiedTourism: z.boolean().optional(),

  schemeStartYear: z.coerce.number().int().min(1980).max(2100).nullable().optional(),
  schemeCommitmentYears: z.coerce.number().int().min(1).max(30).nullable().optional(),
  schemeBaseEur: z.string().nullable().optional(),
  schemeRatePct: z.coerce.number().min(0).max(100).nullable().optional(),
});

/**
 * PATCH /api/real-estate/properties/[id]/fiscal
 *
 * Régime d'imposition et dispositif de défiscalisation d'un bien. Séparé de la
 * création : ces choix se posent souvent après coup, et se révisent (passage
 * du micro au réel, prorogation d'un engagement Pinel).
 *
 * Deux cohérences sont vérifiées ici plutôt que laissées à l'interface, parce
 * qu'une déclaration fausse ne se rattrape pas :
 * - un régime locatif sur un bien non loué n'a pas de sens ;
 * - un régime foncier sur un meublé, ou l'inverse, est une erreur de
 *   déclaration — le mode de location commande les régimes ouverts.
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
      select: { id: true, usage: true },
    });
    if (!detail) {
      return NextResponse.json({ error: "Bien introuvable" }, { status: 404 });
    }

    if (input.rentalRegime) {
      if (!isRentalUsage(detail.usage)) {
        return NextResponse.json(
          {
            error:
              "Ce bien n'est pas loué : aucun régime d'imposition des loyers ne s'y applique.",
          },
          { status: 400 }
        );
      }
      const allowed = regimesForUsage(detail.usage);
      if (!(allowed as readonly string[]).includes(input.rentalRegime)) {
        return NextResponse.json(
          {
            error:
              "Régime incompatible avec le mode de location : le nu relève des revenus fonciers, le meublé des BIC.",
          },
          { status: 400 }
        );
      }
    }

    const commitmentEnd =
      input.commitmentEndDate === undefined
        ? undefined
        : input.commitmentEndDate
          ? new Date(input.commitmentEndDate)
          : null;

    if (commitmentEnd instanceof Date && Number.isNaN(commitmentEnd.getTime())) {
      return NextResponse.json(
        { error: "Date de fin d'engagement invalide" },
        { status: 400 }
      );
    }

    const updated = await prisma.realEstateDetail.update({
      where: { id: detail.id },
      data: {
        ...(input.rentalRegime !== undefined && { rentalRegime: input.rentalRegime }),
        ...(input.taxScheme !== undefined && { taxScheme: input.taxScheme }),
        ...(commitmentEnd !== undefined && { commitmentEndDate: commitmentEnd }),
        ...(input.isClassifiedTourism !== undefined && {
          isClassifiedTourism: input.isClassifiedTourism,
        }),
        ...(input.schemeStartYear !== undefined && {
          schemeStartYear: input.schemeStartYear,
        }),
        ...(input.schemeCommitmentYears !== undefined && {
          schemeCommitmentYears: input.schemeCommitmentYears,
        }),
        ...(input.schemeBaseEur !== undefined && {
          schemeBaseEur: input.schemeBaseEur,
        }),
        ...(input.schemeRatePct !== undefined && {
          schemeRatePct: input.schemeRatePct,
        }),
      },
      select: {
        assetId: true,
        rentalRegime: true,
        taxScheme: true,
        commitmentEndDate: true,
        isClassifiedTourism: true,
        schemeStartYear: true,
        schemeCommitmentYears: true,
        schemeBaseEur: true,
        schemeRatePct: true,
      },
    });

    return NextResponse.json({
      property: {
        ...updated,
        commitmentEndDate: updated.commitmentEndDate?.toISOString() ?? null,
        schemeBaseEur: updated.schemeBaseEur?.toString() ?? null,
        schemeRatePct: updated.schemeRatePct?.toString() ?? null,
      },
    });
  } catch (e) {
    console.error("[real-estate/properties/fiscal PATCH]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Mise à jour impossible") },
      { status: 500 }
    );
  }
}
