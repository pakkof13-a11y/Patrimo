import { NextResponse } from "next/server";
import { adminGateJson, gateAdmin } from "@/app/lib/auth-helpers";
import {
  COLLECT_INTRADAY_JOB,
  getCollectionStatus,
} from "@/app/lib/ops/collection-status";

/**
 * Dernier état connu de la collecte planifiée (NOTIF-01) — ADMIN only.
 *
 * Contrat minimal : `never` (aucun passage n'a encore écrit), ou `ok`/`ko`
 * avec l'horodatage du dernier passage (et le message d'erreur pour `ko`).
 * Aucun historique, aucun envoi — juste la trace consultable dont l'absence
 * rendait un échec de cron silencieux.
 */
export async function GET() {
  const gate = await gateAdmin();
  if (!gate.ok) return adminGateJson(gate);

  const collectIntraday = await getCollectionStatus(COLLECT_INTRADAY_JOB);

  return NextResponse.json(
    { collectIntraday },
    { headers: { "Cache-Control": "no-store" } }
  );
}
