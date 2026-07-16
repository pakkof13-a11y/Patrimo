import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { searchAssets } from "@/app/lib/assets/search";

export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";

  try {
    const results = await searchAssets(userId, q);
    return NextResponse.json({ results, query: q });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Recherche impossible", results: [] }, { status: 500 });
  }
}
