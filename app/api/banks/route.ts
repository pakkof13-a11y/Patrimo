import { NextResponse } from "next/server";
import { Prisma } from "@/app/lib/prisma-client/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { bankAccountSchema, bankAccountUpdateSchema } from "@/app/lib/schemas";
import {
  presentFields,
  requireBodyId,
  validationErrorResponse,
} from "@/app/lib/api/validation";
import { listBankAccounts } from "@/app/lib/cash/pockets";
import { findOrCreatePlatform } from "@/app/lib/platforms/upsert";
import { findPreset, primaryType } from "@/app/lib/platforms/presets";
import {
  recordBankAccountBalanceChange,
  recordBankAccountOpening,
  recordBankAccountRedenomination,
} from "@/app/lib/cash/account-events";

/** Assure une plateforme homonyme pour afficher le cash en Sources → Plateformes. */
async function ensureBankPlatform(userId: string, bankName: string) {
  const name = bankName.trim();
  if (name.length < 2) return;
  const preset = findPreset(name);
  try {
    await findOrCreatePlatform(userId, {
      name: preset?.name || name,
      type: preset ? primaryType(preset) : "BANQUE",
      logoKey: preset?.key || null,
      logoUrl: preset?.logoUrl || null,
    });
  } catch {
    // Ne bloque pas la création du compte si la plateforme échoue
  }
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const accounts = await listBankAccounts(userId);
  return NextResponse.json({ accounts });
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  /*
    Un corps illisible est une requête invalide, pas une panne.

    `req.json()` levait avant que `safeParse` n'ait rien à dire : la réponse
    était un 500 sans forme JSON, et `fetchJson` affichait un échec générique
    là où `validationErrorResponse` existe pour dire ce qui manque. Même
    remède qu'`app/api/envelopes` (D32, point 7).
  */
  const body = await req.json().catch(() => ({}));
  const parsed = bankAccountSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }
  const account = await prisma.$transaction(async (tx) => {
    const created = await tx.bankAccount.create({
      data: {
        userId,
        bankName: parsed.data.bankName,
        balance: new Prisma.Decimal(parsed.data.balance || "0"),
        currency: (parsed.data.currency || "EUR").toUpperCase(),
        isPro: parsed.data.isPro,
        ownershipPct: parsed.data.ownershipPct ?? null,
        notes: parsed.data.notes || null,
      },
    });
    await recordBankAccountOpening(
      tx,
      created.id,
      created.balance.toString(),
      created.currency
    );
    return created;
  });
  await ensureBankPlatform(userId, parsed.data.bankName);
  return NextResponse.json({ account }, { status: 201 });
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  // Cf. POST : un corps illisible se refuse en 400.
  const body = await req.json().catch(() => ({}));
  const id = requireBodyId(body);
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const parsed = bankAccountUpdateSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const f = presentFields(body, parsed.data as Record<string, unknown>) as typeof parsed.data;

  /*
    Vrai quand la ligne a bougé entre la lecture et l'écriture — voir le
    verrou optimiste plus bas. Distinct de « introuvable » : le compte existe,
    c'est l'état de départ qui n'est plus celui qu'on croyait.
  */
  let conflit = false;

  const account = await prisma.$transaction(async (tx) => {
    /*
      L'état de départ se lit DANS la transaction, et l'écriture s'y verrouille.

      Il était lu avant `$transaction`, puis servait de `previousBalance` à
      l'événement. Deux PUT concurrents lisaient donc 1 000 tous les deux :
      l'un écrivait 1 200 et journalisait « +200, solde après 1 200 », l'autre
      800 et « −200, solde après 800 ». La ligne finissait à l'un des deux et
      la chaîne d'événements ne s'y rapprochait plus — silencieusement.

      La lecture ici, plus le solde épinglé dans le `where` du `updateMany`,
      ferment les deux moitiés : l'écart part du dernier état réellement écrit,
      et l'écriture n'aboutit que si cet état tient encore. C'est le verrou que
      `applyDueInterestForSavings` pose déjà sur le même modèle de données.

      `current.updatedAt` est ici la date d'avant écriture, sans précaution
      particulière : rien n'écrit avant cette lecture. C'est l'ancre de
      l'ouverture, plus bas.
    */
    const current = await tx.bankAccount.findFirst({ where: { id, userId } });
    if (!current) return null;

    const data: Prisma.BankAccountUpdateInput = {};
    if (f.bankName !== undefined) data.bankName = f.bankName;
    if (f.balance !== undefined) data.balance = new Prisma.Decimal(f.balance || "0");
    if (f.currency !== undefined) data.currency = f.currency;
    if (f.isPro !== undefined) data.isPro = f.isPro;
    if (f.ownershipPct !== undefined) data.ownershipPct = f.ownershipPct ?? null;
    if (f.notes !== undefined) data.notes = f.notes || null;

    const deviseAvant = current.currency;
    const deviseApres = f.currency ?? deviseAvant;
    const changeDeDevise = deviseApres !== deviseAvant;

    const write = await tx.bankAccount.updateMany({
      where: { id, userId, balance: current.balance },
      data,
    });
    if (write.count === 0) {
      conflit = true;
      return null;
    }

    /*
      L'ouverture appartient à l'écriture de la ligne, pas au seul changement
      de solde — même correction qu'en D38 sur les poches d'enveloppe.

      Un compte sans aucun événement s'ancre sur `updatedAt`, que toute
      écriture ramène au présent. Un simple changement de devise suffisait
      donc à effacer tout son passé de la courbe. L'ouverture le pose au
      dernier instant où il a été connu, dans la devise qu'il avait alors.

      Ce sont les lignes antérieures au journal, et elles seules : le jeu de
      démonstration écrit bien une ouverture et quatorze mouvements par
      compte (`prisma/seed-portfolio.ts`). D39 le laissait entendre, à tort.
    */
    const dejaJournalise = await tx.bankAccountEvent.count({
      where: { bankAccountId: id },
    });
    if (dejaJournalise === 0 && !current.balance.eq(0)) {
      await recordBankAccountOpening(
        tx,
        id,
        current.balance.toString(),
        deviseAvant,
        current.updatedAt
      );
    }

    /*
      Puis les faits du jour, dans l'ordre où ils se lisent.

      La redénomination d'abord : elle change l'unité sans toucher au nominal,
      donc `amount` nul et aucun flux. La valeur en euros du compte bouge
      pourtant — c'est l'effet de change, et la chronologie le comptera comme
      de la performance, ce qu'il est. Le changement de solde ensuite, libellé
      dans la devise que le compte porte désormais : chaque `balanceAfter`
      rejoint le suivant, et le dernier rejoint la ligne.
    */
    if (changeDeDevise) {
      await recordBankAccountRedenomination(
        tx,
        id,
        current.balance.toString(),
        deviseAvant,
        deviseApres
      );
    }
    if (f.balance !== undefined) {
      await recordBankAccountBalanceChange(
        tx,
        id,
        current.balance.toString(),
        f.balance || "0",
        deviseApres
      );
    }

    return tx.bankAccount.findFirst({ where: { id, userId } });
  });

  if (conflit) {
    return NextResponse.json(
      {
        error:
          "Le compte a été modifié entre-temps. Rechargez la page avant de réessayer.",
      },
      { status: 409 }
    );
  }
  if (!account) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  if (f.bankName) {
    await ensureBankPlatform(userId, f.bankName);
  }
  return NextResponse.json({ account });
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  /*
    Le compte du `deleteMany` était jeté et la route répondait toujours 200.
    Supprimer un identifiant inexistant — ou celui d'un autre utilisateur —
    rendait donc « c'est fait », et l'écran rafraîchissait en annonçant une
    suppression qui n'avait pas eu lieu. Le PUT répond déjà 404 dans ce cas.
  */
  const { count } = await prisma.bankAccount.deleteMany({ where: { id, userId } });
  if (count === 0) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
