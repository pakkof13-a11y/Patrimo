import { NextResponse } from "next/server";
import { Prisma } from "@/app/lib/prisma-client/client";
import { requireUserId } from "@/app/lib/auth-helpers";
import { prisma } from "@/app/lib/prisma";
import { envelopeCashUpdateSchema } from "@/app/lib/schemas";
import { presentFields, validationErrorResponse } from "@/app/lib/api/validation";
import { listEnvelopeCash, getOrCreateEnvelopeCash } from "@/app/lib/cash/pockets";
import {
  convertFromEurSync,
  convertToEurSync,
  getEurRates,
  FxRateUnknownError,
} from "@/app/lib/market/fx";
import { d } from "@/app/lib/money/decimal";

/**
 * Une requête qui change la devise **et** affirme un autre solde.
 *
 * Elle n'est pas invalide au sens du schéma : chacun des deux champs est bon.
 * C'est leur conjonction que cette route ne sait pas honorer sans deviner
 * l'intention — voir le garde dans `PUT`.
 */
class SoldeEtDeviseError extends Error {
  constructor() {
    super(
      "Changez la devise, puis le solde : envoyés ensemble, le montant saisi " +
        "serait écrasé par la conversion."
    );
    this.name = "SoldeEtDeviseError";
  }
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  const envelopes = await listEnvelopeCash(userId);
  return NextResponse.json({ envelopes });
}

export async function PUT(req: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });

  /*
    Un corps vide ou malformé est une requête invalide, pas une panne.

    `await req.json()` jetait avant que zod n'entre en scène : la route rendait
    un 500 opaque là où elle rend soigneusement des 400 partout ailleurs. Le
    repli sur un objet vide laisse le schéma faire son travail et produire le
    message qui nomme le champ manquant.
  */
  const body = await req.json().catch(() => ({}));

  const parsed = envelopeCashUpdateSchema.safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  const envelope = parsed.data.envelope;

  /*
    L'ancre de la poche, lue avant **toute** écriture.

    `updatedAt` est la seule date que cette table possède : il n'y a pas de
    champ `knownAt` comme sur les comptes bancaires, et c'est pourtant sur lui
    que `buildCashSleeve` ancre la poche tant qu'aucun événement n'existe. Or
    l'`upsert` qui suit passe par sa branche `update` quand la ligne est déjà
    là, et Prisma réécrit `@updatedAt` à chaque mise à jour — un `update: {}`
    vide compris. Lire la date après lui, c'est la lire à l'instant présent :
    l'ouverture perdrait son ancre et toute l'histoire de la poche avec elle.

    Le comportement exact de Prisma sur un `update` vide n'a pas à être
    tranché ici : cette lecture est juste dans les deux cas.
  */
  const avantEcriture = await prisma.envelopeCash.findUnique({
    where: { userId_envelope: { userId, envelope } },
    select: { updatedAt: true },
  });
  const connuLe = avantEcriture?.updatedAt ?? null;

  /*
    Garantit l'existence de la ligne — et **seulement** si elle manque.

    L'appel était inconditionnel. Sur une ligne déjà là, son `upsert` passait
    par la branche `update: {}` : une écriture qui ne change rien, sur une
    table dont la seule date est un `@updatedAt`. Elle s'exécutait avant la
    transaction, donc avant les gardes — une requête refusée en 400 (solde et
    devise ensemble) l'avait déjà déclenchée.

    Reste à savoir si Prisma réécrit `@updatedAt` sur un `update` vide. La
    question ne se pose plus : on ne lui demande plus rien à vide. Le
    `findUnique` ci-dessus la tranche pour nous et l'appel disparaît sur le
    chemin courant — une requête de moins, pas une de plus.

    L'`upsert` reste pour la création : c'est lui qui ferme la course entre
    deux onglets sur le `@@unique([userId, envelope])` (cf. `pockets.ts`).
    Le cas où la ligne naît entre ce `findUnique` et lui est précisément
    celui qu'il sait absorber.

    Sa valeur de retour ne sert pas : l'état qui compte est celui relu *dans*
    la transaction.
  */
  if (!avantEcriture) await getOrCreateEnvelopeCash(userId, envelope);
  const f = presentFields(body, parsed.data as Record<string, unknown>) as typeof parsed.data;

  /*
    Taux courants, lus une seule fois avant la transaction.

    Une fois la table en main, convertir est un calcul pur : ça n'a rien à
    faire dans une transaction interactive Prisma, qui reste ouverte le temps
    d'un aller-retour réseau si on l'y met.
  */
  const rates = await getEurRates();

  let write: { count: number };
  try {
    write = await prisma.$transaction(async (tx) => {
      /*
        L'écart se lit DANS la transaction.

        La ligne était lue avant `$transaction`, puis l'écart s'en déduisait.
        Deux PUT concurrents partant de 1 000 € et écrivant 1 200 € puis
        1 500 € produisaient un solde final à 1 500 € mais des écarts de
        +700 € chacun — l'un des deux depuis un état qu'il n'a jamais vu. On
        relit ici, sous la même transaction que l'écriture qui suit, pour que
        l'écart parte toujours du dernier état réellement écrit.
      */
      const current = await tx.envelopeCash.findUnique({
        where: { userId_envelope: { userId, envelope } },
      });
      if (!current) return { count: 0 };

      let currency = f.currency ?? current.currency ?? "EUR";
      // PEA locked to EUR
      if (envelope === "PEA") currency = "EUR";

      const currencyChanged = currency !== current.currency;

      /*
        Changer de devise et affirmer un montant sont deux gestes distincts,
        et cette route ne peut pas les distinguer dans une seule requête : le
        solde y est reconstruit par conversion, donc un `balance` soumis en
        même temps qu'une devise nouvelle serait **silencieusement ignoré**.
        Refuser vaut mieux que perdre la saisie sans le dire.

        Le panneau ne déclenche pas ce cas — il renvoie le nominal stocké
        quand seule la devise bouge — et la comparaison est numérique pour
        que « 10000 » et « 10000.000000000000 » ne s'y opposent pas.
      */
      if (
        currencyChanged &&
        f.balance !== undefined &&
        !d(f.balance || "0").eq(d(current.balance.toString()))
      ) {
        throw new SoldeEtDeviseError();
      }

      /*
        La devise se convertit, elle ne se réétiquette pas.

        Le panneau renvoie systématiquement l'ancien solde nominal à chaque
        changement de devise (`components/tabs/envelope-cash-panel.tsx:84`) :
        l'API ne peut donc pas distinguer « je change la devise » de « j'ai
        saisi ce montant dans la nouvelle devise ». Écrire le nominal reçu tel
        quel changeait la valeur en euros du seul fait de relabelliser —
        10 000 USD devenaient 10 000 EUR en base, sans conversion. Reconstruire
        le solde par conversion, en préservant sa valeur en euros, est le seul
        choix qui ne fabrique ni ne détruit de patrimoine à cette étape.
      */
      const balance: Prisma.Decimal = currencyChanged
        ? new Prisma.Decimal(
            convertFromEurSync(
              convertToEurSync(current.balance.toString(), current.currency, rates),
              currency,
              rates
            )
          )
        : f.balance !== undefined
          ? new Prisma.Decimal(f.balance || "0")
          : current.balance;

      /*
        L'écart se juge en euros, jamais sur les nominaux bruts : comparer
        10 000 USD à 10 000 EUR n'a pas d'unité comparable. La tolérance
        reprend celle déjà en place pour les intérêts courus non versés
        (`historical/load.ts`) : sous ce seuil, l'écart n'est qu'un arrondi de
        conversion, pas un mouvement. Un changement de devise seul, dont le
        solde est reconstruit par conversion ci-dessus, retombe toujours sous
        ce seuil — il n'écrit donc plus aucun constat, ni à `amount 0` ni dans
        une autre unité.
      */
      const ecartEur = d(convertToEurSync(balance.toString(), currency, rates)).minus(
        d(convertToEurSync(current.balance.toString(), current.currency, rates))
      );
      const affirmeUnSolde = !ecartEur.abs().lte(d("0.005"));

      const maj = await tx.envelopeCash.updateMany({
        where: { id: current.id, userId },
        data: { balance, currency },
      });

      /*
        Dès que la ligne est écrite — pas seulement quand un solde est affirmé.

        Ce garde portait `&& affirmeUnSolde`, et l'ouverture était enfermée
        avec le constat. Un changement de devise seul passe pourtant par ici :
        le solde y est reconstruit par conversion, l'écart en euros est donc
        nul et `affirmeUnSolde` faux — mais l'`updateMany` ci-dessus a bien
        écrit la ligne, et réécrit son `@updatedAt` avec elle. La poche
        perdait alors sa seule ancre sans qu'aucun événement ne la remplace :
        `buildCashSleeve` la faisait démarrer aujourd'hui, et tout ce qu'elle
        valait avant disparaissait de la courbe.

        L'ouverture appartient donc à l'écriture de la ligne, pas à l'écart
        du jour. Le constat, lui, reste conditionné : il n'y a rien à
        constater quand rien n'a bougé.
      */
      if (maj.count > 0) {
        const priorEvents = await tx.envelopeCashEvent.count({
          where: { envelopeCashId: current.id },
        });

        /*
          Premier événement jamais écrit pour cette poche, avec un solde
          antérieur non nul : la ligne portait déjà une valeur (seed, saisie
          d'avant ce journal) qu'aucun événement ne relate. Une ouverture la
          pose au dernier instant où elle a été connue — `updatedAt` de la
          ligne, lu avant que l'écriture ci-dessus ne le réécrive, replié
          sur `createdAt` s'il manquait. C'est exactement l'ancre que
          `buildCashSleeve` utilise déjà pour cette poche tant qu'aucun
          événement n'existe (`historical/components.ts`, branche
          `evts.length === 0`, qui refuse explicitement d'appliquer la valeur
          en arrière) : l'ouverture rend donc explicite une valeur déjà
          affichée à cette date précise, elle ne la recule pas à un instant
          qu'elle n'a jamais eu — ni `createdAt`, qui ne dit rien de quand le
          solde est apparu, ni l'instant de la saisie, qui l'avancerait au
          présent.

          Elle porte le solde **d'avant**, dans la devise d'avant : c'est ce
          qui était su à cette date, et `load.ts` convertit chaque événement
          avec sa propre devise (`eur(e.amount, e.currency, rates)`). Une
          bascule de devise laisse donc l'ouverture en euros et la valeur en
          euros de la poche inchangée de part et d'autre — ce qu'une
          conversion ne fait ni gagner ni perdre.

          Sans elle, l'écart du jour — souvent minime, parfois nul — resterait
          seul événement, et tout ce que la poche valait avant deviendrait un
          apport du jour de cette première saisie.

          Un solde antérieur nul n'a rien à ouvrir : la ligne était neuve, et
          le constat écrit juste après porte alors le solde entier — c'est le
          cas que couvre déjà « un premier solde sur une enveloppe vide entre
          entièrement en flux ».
        */
        if (priorEvents === 0 && !current.balance.eq(0)) {
          await tx.envelopeCashEvent.create({
            data: {
              envelopeCashId: current.id,
              userId,
              occurredAt: connuLe ?? current.createdAt,
              balanceAfter: current.balance,
              amount: current.balance,
              currency: current.currency,
            },
          });
        }

        if (affirmeUnSolde) {
          await tx.envelopeCashEvent.create({
            data: {
              envelopeCashId: current.id,
              userId,
              // L'instant de la saisie : l'API n'en connaît aucun autre.
              occurredAt: new Date(),
              balanceAfter: balance,
              amount: balance.minus(current.balance),
              currency,
            },
          });
        }
      }

      return maj;
    });
  } catch (err) {
    if (err instanceof FxRateUnknownError || err instanceof SoldeEtDeviseError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  if (write.count === 0) {
    return NextResponse.json({ error: "Enveloppe introuvable" }, { status: 404 });
  }
  const updated = await prisma.envelopeCash.findFirst({
    where: { userId, envelope },
  });
  return NextResponse.json({ envelope: updated });
}
