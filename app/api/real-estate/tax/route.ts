import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { resolveMarginalRate } from "@/app/lib/tax/marginal-rate";
import { getRealEstateTaxBundle } from "@/app/lib/real-estate/tax/service";
import { clientErrorMessage } from "@/app/lib/api/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Les Decimal ne sont pas sérialisables : rendus en chaînes, précision intacte. */
function serializeRentalSection(
  s: Awaited<ReturnType<typeof getRealEstateTaxBundle>>["rental"]["bare"]
) {
  return {
    count: s.count,
    grossRentEur: s.grossRentEur,
    deductibleChargesEur: s.deductibleChargesEur,
    outcomes: s.comparison.outcomes.map((o) => ({
      regime: o.regime,
      eligible: o.eligible,
      ineligibilityReason: o.ineligibilityReason,
      deductionEur: o.deductionEur.toFixed(2),
      taxableIncomeEur: o.taxableIncomeEur.toFixed(2),
      deficitOffsetGlobalEur: o.deficitOffsetGlobalEur.toFixed(2),
      deficitCarriedForwardEur: o.deficitCarriedForwardEur.toFixed(2),
      incomeTaxEur: o.incomeTaxEur.toFixed(2),
      socialTaxEur: o.socialTaxEur.toFixed(2),
      totalTaxEur: o.totalTaxEur.toFixed(2),
      netAfterTaxEur: o.netAfterTaxEur.toFixed(2),
    })),
    bestRegime: s.comparison.best?.regime ?? null,
    savingVsNextEur: s.comparison.savingVsNextEur.toFixed(2),
  };
}

/**
 * GET /api/real-estate/tax
 *
 * Synthèse fiscale du parc : assiette IFI et arbitrage de régime locatif.
 * Tout est recalculé à la demande depuis le journal — aucun agrégat n'est
 * stocké, donc rien ne peut diverger de l'onglet Positions.
 *
 * Tranche marginale appliquée, par ordre de priorité :
 *
 *   1. `?tmi=` — simulation ponctuelle, sans écrire dans le profil ;
 *   2. `User.marginalTaxRatePct` — la tranche déclarée par l'utilisateur ;
 *   3. 30 % — défaut historique de cette route, conservé pour ne pas changer
 *      le résultat des comptes qui n'ont jamais rien déclaré.
 *
 * La réponse expose `marginalTaxRateSource` : sans elle, un appelant ne peut
 * pas distinguer une tranche déclarée d'un défaut, et présenterait les deux
 * avec la même assurance.
 *
 * Le nu et le meublé sont renvoyés en deux sections distinctes : ils relèvent
 * de fiscalités différentes et ne s'additionnent pas.
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const url = new URL(req.url);
  const tmiParam = url.searchParams.get("tmi");
  const tmiRaw = tmiParam != null && tmiParam !== "" ? Number(tmiParam) : null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { marginalTaxRatePct: true },
  });

  const resolved = resolveMarginalRate({
    query: tmiRaw,
    user: user?.marginalTaxRatePct ?? null,
  });
  const marginalTaxRatePct = resolved.pct;

  try {
    const bundle = await getRealEstateTaxBundle(userId, { marginalTaxRatePct });

    // Les Decimal ne sont pas sérialisables tels quels : on les rend en
    // chaînes pour préserver la précision jusqu'au navigateur.
    return NextResponse.json(
      {
        properties: bundle.properties,
        ifi: {
          lines: bundle.ifi.lines.map((l) => ({
            id: l.id,
            label: l.label,
            grossValueEur: l.grossValueEur.toFixed(2),
            allowanceEur: l.allowanceEur.toFixed(2),
            taxableValueEur: l.taxableValueEur.toFixed(2),
            deductibleDebtEur: l.deductibleDebtEur.toFixed(2),
            netValueEur: l.netValueEur.toFixed(2),
            excluded: l.excluded,
          })),
          grossTaxableEur: bundle.ifi.grossTaxableEur.toFixed(2),
          totalDeductibleDebtEur: bundle.ifi.totalDeductibleDebtEur.toFixed(2),
          netTaxableEur: bundle.ifi.netTaxableEur.toFixed(2),
          liable: bundle.ifi.liable,
          grossTaxEur: bundle.ifi.grossTaxEur.toFixed(2),
          discountEur: bundle.ifi.discountEur.toFixed(2),
          taxEur: bundle.ifi.taxEur.toFixed(2),
          effectiveRatePct: bundle.ifi.effectiveRatePct.toFixed(4),
        },
        schemes: {
          rows: bundle.schemes.rows.map((r) => ({
            assetId: r.assetId,
            label: r.label,
            scheme: r.scheme,
            eligibleBaseEur: r.eligibleBaseEur.toFixed(2),
            totalReductionEur: r.totalReductionEur.toFixed(2),
            annualReductionEur: r.annualReductionEur.toFixed(2),
            yearsElapsed: r.yearsElapsed,
            yearsRemaining: r.yearsRemaining,
            finished: r.finished,
            subjectToGlobalCap: r.subjectToGlobalCap,
            baseWasCapped: r.baseWasCapped,
            note: r.note,
          })),
          summary: {
            totalAnnualEur: bundle.schemes.summary.totalAnnualEur.toFixed(2),
            cappedAnnualEur: bundle.schemes.summary.cappedAnnualEur.toFixed(2),
            uncappedAnnualEur:
              bundle.schemes.summary.uncappedAnnualEur.toFixed(2),
            cappedAwayEur: bundle.schemes.summary.cappedAwayEur.toFixed(2),
            effectiveAnnualEur:
              bundle.schemes.summary.effectiveAnnualEur.toFixed(2),
          },
        },
        marginalTaxRatePct,
        marginalTaxRateSource: resolved.source,
        rental: {
          bare: serializeRentalSection(bundle.rental.bare),
          furnished: serializeRentalSection(bundle.rental.furnished),
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[real-estate/tax GET]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de calcul fiscal") },
      { status: 500 }
    );
  }
}
