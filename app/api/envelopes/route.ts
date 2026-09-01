import { NextResponse } from "next/server";
import { Prisma } from "@/app/lib/prisma-client/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { envelopeCashUpdateSchema } from "@/app/lib/schemas";
import { presentFields, validationErrorResponse } from "@/app/lib/api/validation";
import { listEnvelopeCash, getOrCreateEnvelopeCash } from "@/app/lib/cash/pockets";

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const envelopes = await listEnvelopeCash(userId);
  return NextResponse.json({ envelopes });
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const body = await req.json();

  const parsed = envelopeCashUpdateSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const envelope = parsed.data.envelope;
  const row = await getOrCreateEnvelopeCash(userId, envelope);
  const f = presentFields(body, parsed.data as Record<string, unknown>) as typeof parsed.data;

  let currency = f.currency ?? row.currency ?? "EUR";
  // PEA locked to EUR
  if (envelope === "PEA") currency = "EUR";

  const balance =
    f.balance !== undefined ? new Prisma.Decimal(f.balance || "0") : row.balance;

  /*
    Le solde et son constat sont écrits ensemble.

    L'historique de trésorerie s'ancrait sur `updatedAt`, que Prisma réécrit à
    chaque écriture de la ligne : chaque saisie déplaçait le point où
    l'enveloppe apparaît dans le passé et effaçait ce que l'on savait de l'état
    précédent. Un journal accumule au lieu d'écraser.

    L'écriture est atomique : un solde modifié sans son constat rouvrirait
    exactement le défaut corrigé, sur cette saisie-là.

    Le constat n'est posé que lorsqu'un solde est réellement affirmé. Changer la
    seule devise n'affirme rien sur le montant, et écrire un constat pour cela
    ferait passer une correction administrative pour une observation.
  */
  const affirmeUnSolde = f.balance !== undefined;
  const ecart = balance.minus(row.balance);

  const write = await prisma.$transaction(async (tx) => {
    const maj = await tx.envelopeCash.updateMany({
      where: { id: row.id, userId },
      data: { balance, currency },
    });
    if (maj.count > 0 && affirmeUnSolde) {
      await tx.envelopeCashEvent.create({
        data: {
          envelopeCashId: row.id,
          userId,
          // L'instant de la saisie : l'API n'en connaît aucun autre.
          occurredAt: new Date(),
          balanceAfter: balance,
          amount: ecart,
          currency,
        },
      });
    }
    return maj;
  });
  if (write.count === 0) {
    return NextResponse.json({ error: "Enveloppe introuvable" }, { status: 404 });
  }
  const updated = await prisma.envelopeCash.findFirst({
    where: { id: row.id, userId },
  });
  return NextResponse.json({ envelope: updated });
}
