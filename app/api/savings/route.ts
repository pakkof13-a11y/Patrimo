import { NextResponse } from "next/server";
import { Prisma } from "@/app/lib/prisma-client/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { savingsAccountSchema, savingsAccountUpdateSchema } from "@/app/lib/schemas";
import {
  presentFields,
  requireBodyId,
  validationErrorResponse,
} from "@/app/lib/api/validation";
import { listSavingsAccounts } from "@/app/lib/cash/pockets";
import { applyDueInterestForUser } from "@/app/lib/money/savings-accrual";
import { findOrCreatePlatform } from "@/app/lib/platforms/upsert";
import { findPreset, primaryType } from "@/app/lib/platforms/presets";
import {
  recordSavingsAccountBalanceChange,
  recordSavingsAccountOpening,
  recordSavingsAccountRedenomination,
} from "@/app/lib/cash/account-events";
import {
  REGULATED_PRODUCT_INFO,
  type RegulatedProductType,
} from "@/app/lib/cash/regulated-products";

/** Plafond suggéré pour un produit réglementé — undefined si non pré-rempli (CEL, AUTRE). */
function suggestedCeiling(productType: string): string | undefined {
  return REGULATED_PRODUCT_INFO[productType as RegulatedProductType]?.ceilingAmount;
}

async function ensureBankPlatform(userId: string, bankName: string | null | undefined) {
  const name = (bankName || "").trim();
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
    /* non bloquant */
  }
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const accounts = await listSavingsAccounts(userId);
  return NextResponse.json({ accounts });
}

export async function POST(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  /*
    Un corps illisible est une requête invalide, pas une panne. Même remède
    qu'`app/api/envelopes` (D32) et qu'`app/api/banks` (D39).
  */
  const body = await req.json().catch(() => ({}));
  const parsed = savingsAccountSchema.safeParse(body);
  if (!parsed.success) {
    return validationErrorResponse(parsed.error);
  }
  const d = parsed.data;
  const now = new Date();
  const bankName = d.bankName?.trim() || null;
  const productType = d.productType || "AUTRE";
  /*
    Le plafond : `|| null` avant le repli, jamais `??`.

    `decimalString` accepte explicitement la chaîne vide, et `??` ne la
    rattrape pas. Un `ceilingAmount: ""` faisait donc deux dégâts d'un coup :
    il court-circuitait le plafond réglementaire d'un Livret A, et partait tel
    quel vers une colonne `Decimal?`. La branche du PUT écrivait déjà
    `f.ceilingAmount || null` ; c'est ce champ-ci qui avait manqué le motif,
    alors que `balance` et `apyPercent` le suivent juste en dessous.
  */
  const ceilingSaisi = d.ceilingAmount || null;
  const ceilingAmount = ceilingSaisi ?? suggestedCeiling(productType) ?? null;
  const account = await prisma.$transaction(async (tx) => {
    const created = await tx.savingsAccount.create({
      data: {
        userId,
        name: d.name,
        bankName,
        productType,
        ceilingAmount,
        balance: new Prisma.Decimal(d.balance || "0"),
        apyPercent: new Prisma.Decimal(d.apyPercent || "0"),
        rateType: d.rateType || "APY",
        payoutFrequency: d.payoutFrequency || "DAILY",
        payoutDayOfWeek: d.payoutDayOfWeek ?? null,
        payoutDayOfMonth: d.payoutDayOfMonth ?? null,
        payoutMonth: d.payoutMonth ?? null,
        lastPayoutAt: now,
        lastAccruedAt: now,
        currency: (d.currency || "EUR").toUpperCase(),
        isPro: d.isPro,
        ownershipPct: d.ownershipPct ?? null,
        notes: d.notes || null,
      },
    });
    await recordSavingsAccountOpening(
      tx,
      created.id,
      created.balance.toString(),
      created.currency
    );
    return created;
  });
  await ensureBankPlatform(userId, bankName);
  return NextResponse.json({ account }, { status: 201 });
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  // Cf. POST : un corps illisible se refuse en 400.
  const body = await req.json().catch(() => ({}));
  const id = requireBodyId(body);
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });

  const parsed = savingsAccountUpdateSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  /*
    L'ancre, lue avant **toute** écriture — y compris celle des intérêts.

    Deux grandeurs distinctes se lisent ici, et à deux instants différents :

    - l'**ancre** et le solde qui la porte, pour une ouverture de rattrapage :
      ils décrivent l'état d'avant tout ce que cette requête déclenche, donc
      ils se lisent maintenant. L'accrual, juste après, réécrit `updatedAt` et
      le solde dès qu'il crédite quelque chose ;
    - le **solde de départ de l'écart**, qui doit au contraire tenir compte
      des intérêts crédités : il se lit dans la transaction, plus bas.

    Le décompte d'événements se prend ici pour la même raison : l'accrual peut
    en écrire un (`INTEREST`), et un livret sans journal cesserait de le
    paraître avant qu'on ait pu l'ouvrir.
  */
  const avant = await prisma.savingsAccount.findFirst({
    where: { id, userId },
    select: {
      balance: true,
      currency: true,
      ceilingAmount: true,
      updatedAt: true,
      createdAt: true,
    },
  });
  if (!avant) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  const dejaJournalise = await prisma.savingsAccountEvent.count({
    where: { savingsAccountId: id },
  });

  /*
    Les intérêts dus sont crédités avant que le solde saisi ne s'écrive, pour
    que l'écart parte de l'état réel du livret et non d'un état déjà périmé.

    Son compte rendu n'est plus jeté : `applyDueInterestForUser` isole chaque
    livret en défaut et les rapporte, et cette route les avalait tous —
    l'écran répondait 200 en promettant une reprise d'intérêts qui n'avait pas
    eu lieu.
  */
  const accrual = await applyDueInterestForUser(userId);
  if (accrual.errors.length > 0) {
    console.error("[savings PUT] intérêts non crédités", accrual.errors);
  }

  // Le plafond deja saisi, s il y en a un : l accrual n y touche pas.
  const ceilingActuel = avant.ceilingAmount;

  const f = presentFields(body, parsed.data as Record<string, unknown>) as typeof parsed.data;
  const data: Prisma.SavingsAccountUpdateInput = {};
  if (f.name !== undefined) data.name = f.name;
  if (f.bankName !== undefined) {
    data.bankName =
      f.bankName == null || String(f.bankName).trim() === ""
        ? null
        : String(f.bankName).trim();
  }
  if (f.balance !== undefined) {
    data.balance = new Prisma.Decimal(f.balance || "0");
    data.lastAccruedAt = new Date();
    data.lastPayoutAt = new Date();
  }
  if (f.apyPercent !== undefined) {
    data.apyPercent = new Prisma.Decimal(f.apyPercent || "0");
  }
  if (f.rateType !== undefined) data.rateType = f.rateType;
  if (f.payoutFrequency !== undefined) data.payoutFrequency = f.payoutFrequency;
  if (f.payoutDayOfWeek !== undefined) data.payoutDayOfWeek = f.payoutDayOfWeek;
  if (f.payoutDayOfMonth !== undefined) data.payoutDayOfMonth = f.payoutDayOfMonth;
  if (f.payoutMonth !== undefined) data.payoutMonth = f.payoutMonth;
  if (f.currency !== undefined) data.currency = f.currency;
  if (f.isPro !== undefined) data.isPro = f.isPro;
  if (f.ownershipPct !== undefined) data.ownershipPct = f.ownershipPct ?? null;
  if (f.productType !== undefined) {
    data.productType = f.productType;
    // Ceiling suggéré seulement si l'utilisateur n'en a jamais renseigné un
    // et n'en fournit pas non plus dans cette requête — ne jamais écraser
    // une valeur déjà saisie à la main.
    if (f.ceilingAmount === undefined && ceilingActuel == null) {
      const suggestion = suggestedCeiling(f.productType);
      if (suggestion) data.ceilingAmount = suggestion;
    }
  }
  if (f.ceilingAmount !== undefined) {
    data.ceilingAmount = f.ceilingAmount || null;
  }
  if (f.notes !== undefined) data.notes = f.notes || null;

  /*
    Vrai quand la ligne a bougé entre la lecture et l'écriture — cf. le verrou
    plus bas. Distinct d'« introuvable » : le livret existe, c'est l'état de
    départ qui n'est plus celui qu'on croyait.
  */
  let conflit = false;

  const account = await prisma.$transaction(async (tx) => {
    /*
      L'état de départ se lit ici, **après** les intérêts, et l'écriture s'y
      verrouille.

      Il était lu tout en haut de la route, avant l'accrual. Sur un livret à
      10 000 € portant 100 € d'intérêts dus, un PUT à 10 500 € journalisait
      donc un dépôt de 500 € depuis 10 000 — alors que l'accrual venait
      d'amener le livret à 10 100 et d'inscrire ces 100 € en `INTEREST`. Le
      compartiment de trésorerie écarte les `INTEREST` des flux : la page
      comptait 500 € d'apport pour une valeur qui n'avait monté que de 500,
      donc zéro performance là où il y avait 100 € d'intérêts. Un défaut
      systématique, pas une course.

      Le solde lu est ensuite épinglé dans le `where` : deux écritures
      concurrentes — un second PUT, ou un accrual qui se glisse ici — ne
      peuvent plus écrire chacune son écart depuis un état que l'autre a déjà
      remplacé. C'est le verrou que `applyDueInterestForSavings` pose déjà sur
      ce même modèle.
    */
    const current = await tx.savingsAccount.findFirst({ where: { id, userId } });
    if (!current) return null;

    const deviseAvant = current.currency;
    const deviseApres = f.currency ?? deviseAvant;
    const changeDeDevise = deviseApres !== deviseAvant;

    const write = await tx.savingsAccount.updateMany({
      where: { id, userId, balance: current.balance },
      data,
    });
    if (write.count === 0) {
      conflit = true;
      return null;
    }

    /*
      L'ouverture appartient à l'écriture de la ligne, pas au changement de
      solde — même correction qu'en D38 (poches) et D39 (comptes).

      Un livret antérieur au journal s'ancre sur `updatedAt`, que toute
      écriture ramène au présent : un simple changement de nom effaçait donc
      tout son passé de la courbe. Le décompte et l'ancre viennent d'avant
      l'accrual, sans quoi un `INTEREST` fraîchement écrit ferait croire que
      le livret a déjà une histoire.
    */
    if (dejaJournalise === 0 && !avant.balance.eq(0)) {
      await recordSavingsAccountOpening(
        tx,
        id,
        avant.balance.toString(),
        avant.currency,
        avant.updatedAt
      );
    }

    /*
      Puis les faits du jour, dans l'ordre où ils se lisent : le changement
      d'unité, puis celui du solde. La redénomination ne fait rien entrer ni
      sortir — `amount` nul — mais la valeur en euros du livret bouge, et la
      chronologie la comptera en performance, ce qu'est un effet de change.
      Le livret n'est pas converti : son nominal est conservé, comme sur un
      compte courant.
    */
    if (changeDeDevise) {
      await recordSavingsAccountRedenomination(
        tx,
        id,
        current.balance.toString(),
        deviseAvant,
        deviseApres
      );
    }
    if (f.balance !== undefined) {
      await recordSavingsAccountBalanceChange(
        tx,
        id,
        current.balance.toString(),
        f.balance || "0",
        deviseApres
      );
    }

    return tx.savingsAccount.findFirst({ where: { id, userId } });
  });

  if (conflit) {
    return NextResponse.json(
      {
        error:
          "Le livret a été modifié entre-temps. Rechargez la page avant de réessayer.",
      },
      { status: 409 }
    );
  }
  if (!account) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }

  /*
    La plateforme homonyme n'est créée qu'une fois l'écriture acquise.

    L'appel vivait dans la construction de `data`, donc avant la transaction :
    un PUT qui finissait en 404 ou en conflit laissait quand même une
    plateforme derrière lui. Il ne peut pas entrer dans la transaction — il
    écrit par le client global, et l'y appeler ne le rendrait pas atomique
    tout en risquant un verrou croisé. Après le succès est le seul endroit qui
    tienne la promesse.
  */
  if (typeof data.bankName === "string" && data.bankName) {
    await ensureBankPlatform(userId, data.bankName);
  }

  /*
    Les livrets que l'accrual n'a pas pu créditer sont dits, pas avalés : la
    saisie a bien eu lieu, mais l'histoire n'est pas complète et l'écran doit
    pouvoir le montrer.
  */
  return NextResponse.json({
    account,
    ...(accrual.errors.length > 0 ? { interestErrors: accrual.errors } : {}),
  });
}

export async function DELETE(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  /*
    Cf. `app/api/banks` : le compte du `deleteMany` était jeté et la route
    répondait toujours 200. Supprimer un identifiant inexistant — ou celui
    d'un autre utilisateur — rendait « c'est fait », et l'écran rafraîchissait
    en annonçant une suppression qui n'avait pas eu lieu.
  */
  const { count } = await prisma.savingsAccount.deleteMany({ where: { id, userId } });
  if (count === 0) {
    return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
