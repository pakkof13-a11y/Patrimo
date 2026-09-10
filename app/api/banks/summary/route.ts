import { NextResponse } from "next/server";
import { requireUserId } from "@/app/lib/auth-helpers";
import { listBankAccounts, listSavingsAccounts } from "@/app/lib/cash/pockets";
import { listTermDeposits } from "@/app/lib/cash/term-deposits-list";
import { summarizeCash } from "@/app/lib/cash/summary";
import { FxRateUnknownError } from "@/app/lib/market/fx";
import {
  fxUnavailableResponse,
  requestedBase,
} from "@/app/lib/api/validation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/banks/summary
 *
 * KPI de tête de l'onglet Banques. Recalculé à chaque appel depuis les
 * mêmes listes que les sections Comptes courants / Livrets / CAT — jamais
 * un total stocké à part, qui pourrait diverger de ce que l'utilisateur voit
 * juste en dessous.
 *
 * Les trois totaux — comptes courants, livrets, dépôts à terme — portent le
 * **patrimoine personnel** : produits professionnels exclus, quote-part
 * appliquée. Les trois, sans exception : le dépôt à terme échappait à la
 * règle alors que cette phrase le comptait déjà dedans.
 *
 * Ce que la liste montre et que les totaux ne comptent pas sort dans
 * `excluded`, pour que l'écart soit nommé plutôt que subi — c'est la seule
 * façon de tenir la promesse ci-dessus tout en respectant `isPro`.
 */
export async function GET(req: Request) {
  const userId = await requireUserId();
  if (!userId) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 401 });
  }

  /*
    La devise de restitution est validée, pas seulement lue.

    Elle partait telle quelle du query string vers `convertFromEurSync`, qui
    lève `FxRateUnknownError` sur tout code sans taux. `?base=ZZZ` produisait
    donc une exception non attrapée — un 500 sans corps JSON — là où la
    demande est simplement invalide. Et comme c'est le bandeau de tête qui
    appelle, c'est tout le bandeau qui disparaissait.

    La liste est celle du sélecteur de devise de l'en-tête : ce que l'écran
    propose est exactement ce que la route accepte. Le garde vit dans
    `api/validation` depuis que quatre routes le portaient.
  */
  const demande = requestedBase(req);
  if ("error" in demande) return demande.error;
  const base = demande.base;

  try {
    const [checking, savings, termDeposits] = await Promise.all([
      listBankAccounts(userId, base),
      listSavingsAccounts(userId, base),
      listTermDeposits(userId, base),
    ]);

    const summary = summarizeCash(checking, savings, termDeposits);

    return NextResponse.json(
      {
        base,
        checkingTotalBase: summary.checkingTotalBase.toFixed(2),
        savingsTotalBase: summary.savingsTotalBase.toFixed(2),
        termDepositTotalBase: summary.termDepositTotalBase.toFixed(2),
        weightedApyPct: summary.weightedApyPct?.toFixed(3) ?? null,
        projectedAnnualInterestBase:
          summary.projectedAnnualInterestBase.toFixed(2),
        excluded: {
          proCount: summary.excluded.proCount,
          proTotalBase: summary.excluded.proTotalBase.toFixed(2),
          sharedCount: summary.excluded.sharedCount,
          sharedNotOwnedBase: summary.excluded.sharedNotOwnedBase.toFixed(2),
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    /*
      Une devise de compte sans taux n'est pas une faute de l'appelant : la
      base a été validée juste au-dessus, et c'est une ligne déjà en place qui
      ne peut pas être convertie — table de taux indisponible, ou devise
      stockée hors des cinq connues. 503 le dit, et nomme laquelle ; un 500 nu
      laissait le bandeau vide sans un mot.
    */
    if (e instanceof FxRateUnknownError) return fxUnavailableResponse(e.currency);
    throw e;
  }
}
