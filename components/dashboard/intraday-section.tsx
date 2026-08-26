"use client";

/**
 * Bloc intraday du panneau d'évolution : requête, états, en-tête, courbe.
 *
 * ## Ce qu'il ajoute au parcours
 *
 * Rien n'est remplacé. La courbe quotidienne reste l'historique de référence ;
 * l'intraday est une **échelle** que l'utilisateur choisit sur la fenêtre de
 * sept jours, là où l'heure a un sens. Les deux séries ne sont jamais mêlées
 * dans un même calcul ni sur un même axe.
 *
 * ## Quatre états, jamais confondus
 *
 * - **chargement** : la courbe se prépare ;
 * - **erreur** : la requête a échoué — dit comme tel, avec une reprise ;
 * - **vide** : la collecte n'a encore rien produit — ce n'est pas une erreur,
 *   et surtout pas une courbe plate à zéro ;
 * - **série** : le tracé.
 *
 * Confondre les deux derniers serait le défaut le plus coûteux : afficher
 * « 0 € » là où la réponse honnête est « pas encore de donnée » ferait croire à
 * un patrimoine nul.
 */

import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/app/lib/api-client";
import { formatCurrency, cn } from "@/app/lib/utils";
import { EmptyPlaceholder } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { IntradayChart } from "@/components/dashboard/intraday-chart";
import {
  drawdownSummary,
  formatIntradayStamp,
  hasEstimatedPoint,
  periodDelta,
  type IntradayApiResponse,
} from "@/app/lib/portfolio/intraday-view";

/** Fenêtre de l'itération. Le paramètre existe pour que d'autres suivent. */
export const INTRADAY_DAYS = 7;
export const INTRADAY_MAX_POINTS = 400;

export function IntradaySection({
  baseCurrency,
  days = INTRADAY_DAYS,
  enabled = true,
}: {
  baseCurrency: string;
  days?: number;
  enabled?: boolean;
}) {
  /*
    Une requête par fenêtre, et rien d'autre.

    `enabled` la retient tant que l'utilisateur n'a pas choisi l'échelle
    horaire : basculer un réglage purement visuel ne doit rien déclencher. La
    clé ne contient que ce qui change réellement la réponse.
  */
  const q = useQuery<IntradayApiResponse>({
    queryKey: ["portfolio-intraday", days, INTRADAY_MAX_POINTS],
    queryFn: () =>
      fetchJson<IntradayApiResponse>(
        `/api/portfolio/intraday?days=${days}&maxPoints=${INTRADAY_MAX_POINTS}`
      ),
    enabled,
    staleTime: 5 * 60_000,
  });

  if (q.isPending) {
    return (
      <div
        className="flex h-full flex-col gap-3 px-2 py-2"
        data-testid="intraday-loading"
        aria-busy="true"
      >
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="min-h-[10rem] w-full flex-1 rounded-[var(--radius-lg)]" />
      </div>
    );
  }

  if (q.isError) {
    /*
      Un échec réseau n'est pas une absence de donnée. Les confondre laisserait
      croire que la collecte n'a rien produit alors que la question n'a pas pu
      être posée.
    */
    return (
      <EmptyPlaceholder
        compact
        testId="intraday-error"
        emptyKind="error"
        title="Impossible de charger la série intraday"
        description="La requête n'a pas abouti. Le patrimoine affiché ailleurs reste valable."
        action={
          <button
            type="button"
            onClick={() => q.refetch()}
            data-testid="intraday-retry"
            className={cn(
              "rounded-[var(--radius-sm)] bg-[var(--muted)]/70 px-2.5 py-1 text-[11px] font-medium",
              "text-[var(--foreground)] transition hover:bg-[var(--muted)]",
              "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            )}
          >
            Réessayer
          </button>
        }
      />
    );
  }

  const series = q.data;
  const points = series?.points ?? [];

  if (points.length === 0) {
    return (
      <EmptyPlaceholder
        compact
        testId="intraday-empty"
        emptyKind="source"
        title="Aucune donnée intraday disponible"
        description="Les données apparaîtront après la prochaine collecte des historiques de marché."
      />
    );
  }

  const delta = periodDelta(points);
  const drawdown = drawdownSummary(series?.extremes ?? null);
  const estimated = hasEstimatedPoint(points);

  return (
    <div className="flex h-full flex-col" data-testid="intraday-section">
      {/* En-tête : variation de la fenêtre, repli, mention d'estimation. */}
      <div className="mb-1.5 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        {delta != null ? (
          <span
            className={cn(
              "text-[13px] font-semibold tabular-nums",
              delta >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"
            )}
            data-testid="intraday-delta"
          >
            {delta >= 0 ? "+" : ""}
            {formatCurrency(delta, baseCurrency)}
          </span>
        ) : null}

        {drawdown ? (
          <span
            className="text-[11px] font-medium text-[var(--muted-foreground)]"
            data-testid="intraday-drawdown"
            title={`Sommet ${formatIntradayStamp(drawdown.peakAt)} · creux ${formatIntradayStamp(drawdown.troughAt)}`}
          >
            {/*
              Repli depuis le sommet **courant**, mesuré par l'API sur la série
              complète. Le signe est explicite : un repli est toujours négatif,
              et le lire comme une baisse ne doit pas dépendre d'une couleur.
            */}
            Repli −{formatCurrency(drawdown.eur, baseCurrency)}
            {drawdown.pct > 0
              ? ` (−${drawdown.pct.toLocaleString("fr-FR", {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })} %)`
              : ""}
            {drawdown.recovered ? " · récupéré" : ""}
          </span>
        ) : null}

        {estimated ? (
          <span
            className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]"
            data-testid="intraday-estimated-note"
            title="Certains points reprennent la dernière valeur connue, faute d'observation à cet instant."
          >
            Contient des estimations
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        <IntradayChart
          points={points}
          extremes={series?.extremes ?? null}
          baseCurrency={baseCurrency}
        />
      </div>
    </div>
  );
}
