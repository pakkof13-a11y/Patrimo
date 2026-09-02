import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import {
  getFiscalYearReport,
  getFiscalYearReports,
} from "@/app/lib/tax/fiscal-year-service";
import { clientErrorMessage } from "@/app/lib/api/error-response";

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const now = new Date();
  const yRaw = searchParams.get("year");
  const year = yRaw ? Number(yRaw) : now.getFullYear();
  if (!Number.isFinite(year) || year < 1990 || year > 2100) {
    return NextResponse.json({ error: "Année invalide" }, { status: 400 });
  }

  /*
    `history=N` renvoie en plus les N-1 années précédentes, dans un seul
    passage sur le journal. Sans ce paramètre, afficher une évolution
    pluriannuelle imposerait N appels, donc N scans complets des transactions
    pour un rejeu CUMP identique à chaque fois.
  */
  const hRaw = Number(searchParams.get("history"));
  const history =
    Number.isFinite(hRaw) && hRaw > 1 ? Math.min(Math.floor(hRaw), 10) : 1;

  try {
    if (history > 1) {
      const years = Array.from({ length: history }, (_, i) => year - i).reverse();
      const reports = await getFiscalYearReports(userId, years);
      const current = reports[reports.length - 1]!;
      return NextResponse.json({ ...current, history: reports });
    }
    const report = await getFiscalYearReport(userId, year);
    return NextResponse.json(report);
  } catch (e) {
    console.error("[fiscal-year]", e);
    return NextResponse.json(
      { error: clientErrorMessage(e, "Erreur fiscale") },
      { status: 500 }
    );
  }
}
