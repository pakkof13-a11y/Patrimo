import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { timingSafeEqualSecret } from "@/app/lib/env/runtime";
import { applyDueInterestForUser } from "@/app/lib/money/savings-accrual";
import { prisma } from "@/app/lib/prisma";
import { readCronCredential } from "@/app/lib/auth/cron-credential";

/**
 * POST /api/savings/accrue
 * Credits due interest for the current user (or all users if CRON_SECRET matches).
 * Cron mode : Authorization: Bearer $CRON_SECRET ou header x-cron-secret.
 */
export async function POST(req: Request) {
  // Le proxy laisse passer une requête qui *présente* une créance de cron ;
  // c'est ici qu'elle est vérifiée, en temps constant.
  const isCron = timingSafeEqualSecret(
    readCronCredential(req),
    "CRON_SECRET"
  );

  if (isCron) {
    const users = await prisma.user.findMany({ select: { id: true } });
    let totalPeriods = 0;
    const errors: Array<{ userId: string; message: string }> = [];

    for (const u of users) {
      /*
        Chaque utilisateur est isolé, pour la même raison que les livrets le
        sont à l'intérieur : sans cela, la première exception interrompait le
        job et privait d'intérêts tous les utilisateurs situés après elle dans
        l'ordre de lecture, à chaque passage.

        Les échecs sont rapportés dans la réponse : un job qui n'a traité qu'une
        partie de ses utilisateurs doit le dire.
      */
      try {
        const r = await applyDueInterestForUser(u.id);
        totalPeriods += r.periodsCredited;
        for (const e of r.errors) {
          errors.push({ userId: u.id, message: `livret ${e.savingsId} : ${e.message}` });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erreur inconnue";
        console.error("[savings/accrue] utilisateur", u.id, message);
        errors.push({ userId: u.id, message });
      }
    }

    return NextResponse.json({
      mode: "cron",
      users: users.length,
      periodsCredited: totalPeriods,
      errors,
    });
  }

  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const result = await applyDueInterestForUser(userId);
  return NextResponse.json({ mode: "user", ...result });
}
