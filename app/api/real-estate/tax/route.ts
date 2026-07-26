import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { getRealEstateTaxBundle } from "@/app/lib/real-estate/tax/service";
import { clientErrorMessage } from "@/app/lib/api/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/real-estate/tax
 *
 * Synthèse fiscale du parc : assiette IFI et arbitrage de régime locatif.
 * Tout est recalculé à la demande depuis le journal — aucun agrégat n'est
 * stocké, donc rien ne peut diverger de l'onglet Positions.
 *
 * Paramètres :
 * - `tmi` : tranche marginale d'imposition (0 · 11 · 30 · 41 · 45), défaut 30
 * - `furnished` : compare les régimes meublés au lieu des régimes nus
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const url = new URL(req.url);
  const tmiRaw = Number(url.searchParams.get("tmi"));
  const marginalTaxRatePct = Number.isFinite(tmiRaw) && tmiRaw >= 0 && tmiRaw <= 100
    ? tmiRaw
    : 30;
  const furnished = url.searchParams.get("furnished") === "true";

  try {
    const bundle = await getRealEstateTaxBundle(userId, {
      marginalTaxRatePct,
      furnished,
    });

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
        rental: {
          grossRentEur: bundle.rental.grossRentEur,
          deductibleChargesEur: bundle.rental.deductibleChargesEur,
          marginalTaxRatePct,
          furnished,
          outcomes: bundle.rental.comparison.outcomes.map((o) => ({
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
          bestRegime: bundle.rental.comparison.best?.regime ?? null,
          savingVsNextEur: bundle.rental.comparison.savingVsNextEur.toFixed(2),
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
