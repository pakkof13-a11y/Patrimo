import { NextResponse } from "next/server";
import {
  getEurRates,
  convertAmount,
  fxRateToEurOnDate,
  fxRateToEur,
} from "@/app/lib/market/fx";
import { requireUserId } from "@/app/lib/auth-helpers";
import { clientErrorMessage } from "@/app/lib/api/error-response";

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const amount = searchParams.get("amount");
  const date = searchParams.get("date"); // YYYY-MM-DD historical

  if (amount !== null && !Number.isFinite(Number(amount))) {
    return NextResponse.json({ error: "amount invalide" }, { status: 400 });
  }
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date invalide (attendu YYYY-MM-DD)" }, { status: 400 });
  }

  try {
    if (date && from) {
      const rate =
        from.toUpperCase() === "EUR"
          ? "1"
          : await fxRateToEurOnDate(from, date);
      /*
        `source` disait « frankfurter-historical » quoi qu'il arrive, y compris
        quand la valeur venait en réalité du taux du jour. L'étiquette affirmait
        une provenance que la donnée n'avait pas.

        Un taux non démontré se rend désormais `null`, avec une source qui le
        dit. La réponse reste 200 : ne pas connaître un taux d'archive n'est pas
        une erreur de la requête.
      */
      return NextResponse.json({
        from: from.toUpperCase(),
        to: "EUR",
        date,
        fxRateToEur: rate,
        source: rate == null ? "unknown" : "frankfurter-historical",
      });
    }

    const rates = await getEurRates();

    if (from && to && amount) {
      const converted = await convertAmount(amount, from, to);
      return NextResponse.json({ rates, from, to, amount, converted });
    }

    if (from && !to) {
      const rate = await fxRateToEur(from);
      return NextResponse.json({ from: from.toUpperCase(), fxRateToEur: rate, rates });
    }

    return NextResponse.json({ rates, base: "EUR" });
  } catch (e) {
    console.error("GET /api/fx", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur de conversion FX") },
      { status: 500 }
    );
  }
}
