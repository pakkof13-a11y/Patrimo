import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { safeParseBody } from "@/app/lib/api/validation";
import {
  buildMoneroSnapshot,
  fetchMoneroMetaFromCoinGecko,
  writeMoneroBalanceToLedger,
} from "@/app/lib/zerion";

/**
 * POST /api/wallets/monero/sync
 * Monero : solde local + méta CoinGecko (pas Zerion).
 */

const bodySchema = z.object({
  platformId: z.string().min(1),
  amount: z.union([z.number(), z.string()]),
  writeLedger: z.boolean().optional(),
});

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON invalide" }, { status: 400 });
  }

  const parsed = safeParseBody(bodySchema, json);
  if (!parsed.success) return parsed.response;

  const amount = Number(parsed.data.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return NextResponse.json(
      { error: "Montant XMR invalide", code: "INVALID_AMOUNT" },
      { status: 400 }
    );
  }

  const platform = await prisma.platform.findFirst({
    where: { id: parsed.data.platformId, userId },
    select: { id: true, name: true },
  });
  if (!platform) {
    return NextResponse.json(
      { error: "Plateforme introuvable" },
      { status: 404 }
    );
  }

  try {
    const meta = await fetchMoneroMetaFromCoinGecko();
    const snapshot = buildMoneroSnapshot(amount, meta);

    let ledger = null;
    let ledgerError: string | null = null;
    if (parsed.data.writeLedger !== false) {
      try {
        ledger = await writeMoneroBalanceToLedger(
          userId,
          platform.id,
          snapshot
        );
        await prisma.platform.update({
          where: { id: platform.id },
          data: { lastSyncedAt: new Date() },
        });
      } catch (e) {
        ledgerError =
          e instanceof Error ? e.message : "Échec écriture ledger";
      }
    }

    return NextResponse.json({
      ok: true,
      source: "coingecko-monero",
      platformId: platform.id,
      platformName: platform.name,
      snapshot,
      ledgerWritten: Boolean(ledger),
      ledger,
      ledgerError,
    });
  } catch (e) {
    console.error("[monero-sync]", e instanceof Error ? e.message : e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Échec récupération métadonnées Monero",
        code: "MONERO_UNAVAILABLE",
      },
      { status: 502 }
    );
  }
}
