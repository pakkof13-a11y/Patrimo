import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { applyDueInterestForUser } from "@/app/lib/money/savings-accrual";
import { prisma } from "@/app/lib/prisma";

/**
 * POST /api/savings/accrue
 * Credits due interest for the current user (or all users if CRON_SECRET matches).
 * Can be called by a daily cron / Vercel Cron / manual "Actualiser intérêts".
 */
export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization") || "";
  const isCron =
    cronSecret &&
    (authHeader === `Bearer ${cronSecret}` ||
      req.headers.get("x-cron-secret") === cronSecret);

  if (isCron) {
    const users = await prisma.user.findMany({ select: { id: true } });
    let totalPeriods = 0;
    for (const u of users) {
      const r = await applyDueInterestForUser(u.id);
      totalPeriods += r.periodsCredited;
    }
    return NextResponse.json({
      mode: "cron",
      users: users.length,
      periodsCredited: totalPeriods,
    });
  }

  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  const result = await applyDueInterestForUser(userId);
  return NextResponse.json({ mode: "user", ...result });
}
