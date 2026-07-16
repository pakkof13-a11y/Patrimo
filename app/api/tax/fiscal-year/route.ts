import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { getFiscalYearReport } from "@/app/lib/tax/fiscal-year-service";

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

  try {
    const report = await getFiscalYearReport(userId, year);
    return NextResponse.json(report);
  } catch (e) {
    console.error("[fiscal-year]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erreur fiscale" },
      { status: 500 }
    );
  }
}
