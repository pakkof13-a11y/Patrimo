import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { getMacroCalendarToday } from "@/app/lib/news/service";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  return NextResponse.json({
    events: getMacroCalendarToday(),
    source: "mock",
    date: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
  });
}
