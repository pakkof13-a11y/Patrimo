"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ArrowLeftRight,
  CalendarClock,
  FileText,
  Plus,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { Button } from "@/components/ui/button";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { AllocationCard } from "@/components/dashboard/terminal-panels";
import { PendingBackend } from "@/components/ui/pending-backend";
import { assetCategoryLabel } from "@/app/lib/assets/categories";
import {
  buildAccountView,
  computeAllocation,
  computeKeyIndicators,
  computeTotals,
  num,
  positionWeightPct,
  splitByEnvelope,
  type AccountView,
  type SecuritiesAccount,
  type SecuritiesPosition,
} from "@/app/lib/securities/overview";
import {
  formatCurrency,
  formatDate,
  getChangeColor,
  cn,
} from "@/app/lib/utils";

type SecuritiesResponse = {
  accounts: SecuritiesAccount[];
  positions: SecuritiesPosition[];
};

/** Prélèvements sociaux sur les gains — taux en vigueur, source unique. */
const SOCIAL_CHARGES_PCT = 17.2;

/**
 * Teintes des sous-catégories du camembert.
 *
 * Les libellés diffèrent de ceux du tableau de bord (« Actions » ici, « Actions
 * / ETF » là-bas) : sans table dédiée, le repli sur hachage donnait quatre
 * parts de la même couleur, donc un camembert illisible. Aucun rouge — il
 * porte la perte partout ailleurs dans l'application.
 */
const CATEGORY_TONES: Record<string, string> = {
  Actions: "var(--chart-gold)",
  ETF: "var(--chart-cyan)",
  Obligations: "var(--chart-positive)",
  Fonds: "var(--gold-deep)",
  Monétaire: "var(--chart-neutral)",
  Liquidités: "var(--chart-neutral)",
  "Liquidités et équivalents": "var(--chart-neutral)",
  SCPI: "var(--cyan-ink-light)",
  "Foncières cotées / REIT": "var(--cyan-ink-light)",
};

function categoryTone(label: string): string {
  return CATEGORY_TONES[label] ?? "var(--chart-neutral)";
}

function pct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toLocaleString("fr-FR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} %`;
}

function signedPct(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : "−"}${pct(Math.abs(v), digits)}`;
}

function signedCurrency(v: number, currency: string): string {
  return `${v >= 0 ? "+" : "−"}${formatCurrency(Math.abs(v), currency)}`;
}

/* ── Primitives locales ───────────────────────────────────────────── */

function Metric({
  label,
  value,
  tone,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-label truncate">{label}</div>
      <div
        className={cn(
          "num mt-[var(--space-1)] text-[length:var(--text-lg)] font-medium",
          tone ?? "text-[var(--foreground)]"
        )}
      >
        {value}
      </div>
      {hint && <div className="text-meta mt-[var(--space-px)]">{hint}</div>}
    </div>
  );
}

/** Jauge d'une part — la barre dit d'un coup d'œil ce que le chiffre chiffre. */
function ShareBar({ value }: { value: number | null }) {
  const w = value == null ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div
      className="mt-[var(--space-3)] h-[3px] w-full overflow-hidden rounded-full bg-[var(--surface-sunken)]"
      aria-hidden
    >
      <div
        className="h-full rounded-full bg-[var(--primary)] transition-[width] duration-[var(--duration-normal)] ease-[var(--ease-out)]"
        style={{ width: `${w}%` }}
      />
    </div>
  );
}

function KpiCard({
  label,
  value,
  children,
  testId,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
  testId: string;
}) {
  return (
    <article
      className="panel flex flex-col p-[var(--pad-card)]"
      data-testid={testId}
    >
      <h3 className="text-label truncate" title={label}>
        {label}
      </h3>
      <p className="num mt-[var(--space-2)] truncate text-[length:var(--text-xl)] font-semibold text-[var(--foreground)]">
        {value}
      </p>
      {/* Zone secondaire de hauteur réservée : sans elle, les cinq cartes
          cessent d'avoir la même hauteur dès qu'une mesure manque. */}
      <div className="mt-auto min-h-[2.25rem] pt-[var(--space-2)]">
        {children}
      </div>
    </article>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */

/**
 * Vue d'ensemble PEA & CTO.
 *
 * Un seul écran, un seul onglet : l'utilisateur doit comprendre l'état de ses
 * comptes titres en quelques secondes. La densité reste modérée — c'est une
 * page de patrimoine, pas une salle de marché.
 *
 * Deux mesures du mockup n'ont pas de source côté serveur et ne sont donc pas
 * inventées : l'historique de valeur **par enveloppe** (courbes des cartes KPI
 * et performance cumulée) et les agrégats de marché par ligne (PER, rendement
 * et bêta moyens). Leur emplacement est tenu, leur absence est dite.
 */
export function SecuritiesOverview({
  className,
  onOpenPositions,
  onManageAccounts,
}: {
  className?: string;
  /** Ouvre le portefeuille filtré sur une enveloppe. */
  onOpenPositions?: (envelopeType: string) => void;
  /** Déplie la gestion des comptes (ouverture, versements, rattachements). */
  onManageAccounts?: () => void;
}) {
  const q = useQuery({
    queryKey: ["securities"],
    queryFn: () => fetchJson<SecuritiesResponse>("/api/securities"),
  });

  const accounts = useMemo(() => q.data?.accounts ?? [], [q.data]);
  const positions = useMemo(() => q.data?.positions ?? [], [q.data]);

  const totals = useMemo(() => computeTotals(accounts), [accounts]);
  const envelopes = useMemo(() => splitByEnvelope(accounts), [accounts]);
  /**
   * Cartes de compte, PEA en tête : l'enveloppe fiscale se lit avant le
   * compte ordinaire, et l'ordre doit être le même à chaque chargement.
   */
  const views = useMemo(
    () =>
      accounts
        .map((a) => buildAccountView(a, positions))
        .sort((x, y) => {
          const rank = (t: string) => (t === "PEA" ? 0 : 1);
          const d = rank(x.account.envelopeType) - rank(y.account.envelopeType);
          return d !== 0 ? d : x.title.localeCompare(y.title, "fr");
        }),
    [accounts, positions]
  );
  const allocation = useMemo(
    () => computeAllocation(positions, totals, assetCategoryLabel),
    [positions, totals]
  );
  const indicators = useMemo(
    () => computeKeyIndicators(positions, totals),
    [positions, totals]
  );

  /** Le PEA le plus ancien porte le compteur d'antériorité fiscale. */
  const peaMaturity = useMemo(() => {
    const withMaturity = accounts
      .filter((a) => a.maturity)
      .sort(
        (a, b) =>
          new Date(a.openDate).getTime() - new Date(b.openDate).getTime()
      );
    return withMaturity[0] ?? null;
  }, [accounts]);

  if (q.isPending) {
    return (
      <div
        className={cn("space-y-[var(--gap-card)]", className)}
        aria-busy="true"
        data-testid="securities-overview-loading"
      >
        <div className="grid gap-[var(--gap-card)] sm:grid-cols-3 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-[var(--radius-lg)] bg-[var(--surface-sunken)]"
            />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-[var(--radius-lg)] bg-[var(--surface-sunken)]" />
      </div>
    );
  }

  if (q.isError) {
    return (
      <p className="text-meta" data-testid="securities-overview-error">
        Impossible de charger les comptes titres.
      </p>
    );
  }

  if (accounts.length === 0) {
    return (
      <section
        className="panel p-[var(--pad-card)]"
        data-testid="securities-overview-empty"
      >
        <h2 className="text-title">Aucun compte titres</h2>
        <p className="text-meta mt-[var(--space-2)]">
          Déclarez un PEA ou un compte-titres pour suivre sa valeur, son
          antériorité fiscale et ses positions.
        </p>
        {onManageAccounts && (
          <Button
            type="button"
            className="mt-[var(--space-4)]"
            onClick={onManageAccounts}
            data-testid="securities-overview-open-manage"
          >
            <Plus className="h-3.5 w-3.5" />
            Ouvrir un compte
          </Button>
        )}
      </section>
    );
  }

  return (
    <div
      className={cn("space-y-[var(--gap-card)]", className)}
      data-testid="securities-overview"
    >
      {/* ── Cinq indicateurs ─────────────────────────────────────── */}
      <div
        className="grid gap-[var(--gap-card)] grid-cols-2 sm:grid-cols-3 xl:grid-cols-5"
        data-testid="securities-kpis"
      >
        <KpiCard
          testId="skpi-total"
          label="Valeur totale"
          value={formatCurrency(totals.totalValueEur, "EUR")}
        >
          <p className="text-meta">
            Titres {formatCurrency(totals.positionsValueEur, "EUR")} ·
            liquidités {formatCurrency(totals.cashEur, "EUR")}
          </p>
        </KpiCard>

        <KpiCard
          testId="skpi-invested"
          label="Investi"
          value={formatCurrency(totals.costBasisEur, "EUR")}
        >
          <dl className="text-meta num space-y-[var(--space-px)]">
            <div className="flex justify-between gap-[var(--space-2)]">
              <dt>+ Versements</dt>
              <dd>{formatCurrency(totals.contributionsEur, "EUR")}</dd>
            </div>
            <div className="flex justify-between gap-[var(--space-2)]">
              <dt>− Retraits</dt>
              <dd>{formatCurrency(totals.withdrawalsEur, "EUR")}</dd>
            </div>
          </dl>
        </KpiCard>

        <KpiCard
          testId="skpi-pnl"
          label="P&L global"
          value={signedCurrency(totals.unrealizedPnlEur, "EUR")}
        >
          <p
            className={cn(
              "num text-[length:var(--text-xs)]",
              getChangeColor(totals.unrealizedPnlEur)
            )}
          >
            {signedPct(totals.unrealizedPnlPct)}
          </p>
        </KpiCard>

        {envelopes.slice(0, 2).map((e) => (
          <KpiCard
            key={e.envelopeType}
            testId={`skpi-envelope-${e.envelopeType.toLowerCase()}`}
            /* Sigle en tête de carte : « PEA » et « CTO » se lisent d'un
               coup d'œil là où « Compte-Titres Ordinaire » remplit la ligne. */
            label={e.envelopeType}
            value={formatCurrency(e.valueEur, "EUR")}
          >
            <p className="text-meta">
              {e.sharePct != null ? `${pct(e.sharePct, 1)} du total` : "—"}
              {e.accountCount > 1 ? ` · ${e.accountCount} comptes` : ""}
            </p>
            <ShareBar value={e.sharePct} />
          </KpiCard>
        ))}
      </div>

      {/* ── Corps : comptes + analyses | colonne contextuelle ────── */}
      <div className="grid gap-[var(--gap-card)] xl:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0 space-y-[var(--gap-card)]">
          {/* Cartes de compte — la grille accepte N comptes, pas deux. */}
          <div
            className="grid gap-[var(--gap-card)] lg:grid-cols-2"
            data-testid="securities-account-cards"
          >
            {views.map((v) => (
              <AccountCard
                key={v.account.id}
                view={v}
                onOpenPositions={onOpenPositions}
              />
            ))}
          </div>

          {/* Analyses */}
          {/* Proportions du mockup : la performance occupe le centre large,
              la répartition et les indicateurs l'encadrent. */}
          <div className="grid gap-[var(--gap-card)] lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.05fr)_minmax(0,1fr)]">
            <AllocationCard
              data={allocation.map((s) => ({
                name: s.label,
                value: s.valueEur,
              }))}
              baseCurrency="EUR"
              title="Répartition globale"
              subtitle="Par classe d'actifs, liquidités comprises"
              showValues
              compact
              toneOf={categoryTone}
              testId="securities-allocation"
              emptyHint="La répartition apparaîtra dès la première position."
            />

            <CumulativePerformance />

            <KeyIndicatorsCard
              indicators={indicators}
              accountCount={totals.accountCount}
            />
          </div>
        </div>

        {/* ── Colonne contextuelle ───────────────────────────────── */}
        <aside
          className="min-w-0 space-y-[var(--gap-card)]"
          data-testid="securities-sidecol"
        >
          <section className="panel p-[var(--pad-card)]">
            <h3 className="text-label">Résumé global</h3>
            <dl className="mt-[var(--space-3)] space-y-[var(--space-2)] text-[length:var(--text-sm)]">
              <SummaryRow
                label="Valeur totale"
                value={formatCurrency(totals.totalValueEur, "EUR")}
              />
              <SummaryRow
                label="Plus-value latente"
                tone={getChangeColor(totals.unrealizedPnlEur)}
                value={signedCurrency(totals.unrealizedPnlEur, "EUR")}
              />
              <SummaryRow
                label="Plus-value latente %"
                tone={getChangeColor(totals.unrealizedPnlEur)}
                value={signedPct(totals.unrealizedPnlPct)}
              />
              <SummaryRow
                label="Investi"
                value={formatCurrency(totals.costBasisEur, "EUR")}
              />
              <SummaryRow
                label="Liquidités"
                value={formatCurrency(totals.cashEur, "EUR")}
              />
              <SummaryRow
                label="Lignes détenues"
                value={String(totals.positionCount)}
              />
            </dl>
            {totals.hasUnattributedCash && (
              <p
                className="text-meta mt-[var(--space-3)]"
                data-testid="securities-cash-warning"
              >
                Une partie des liquidités n&apos;a pas pu être rattachée à un
                compte précis : elle compte dans le total, pas dans le détail.
              </p>
            )}
          </section>

          <FiscalStatusCard account={peaMaturity} />

          <section className="panel p-[var(--pad-card)]">
            <h3 className="text-label">Actions rapides</h3>
            <ul className="mt-[var(--space-3)] space-y-[var(--space-px)]">
              <QuickAction
                icon={Wallet}
                label="Voir toutes les positions"
                onClick={() => onOpenPositions?.("")}
              />
              <QuickAction
                icon={Plus}
                label="Ouvrir un compte"
                onClick={onManageAccounts}
              />
              <QuickAction
                icon={ArrowLeftRight}
                label="Enregistrer un versement"
                onClick={onManageAccounts}
              />
              <QuickAction
                icon={FileText}
                label="Rattacher des positions"
                onClick={onManageAccounts}
              />
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ── Carte d'un compte ────────────────────────────────────────────── */

function AccountCard({
  view,
  onOpenPositions,
}: {
  view: AccountView;
  onOpenPositions?: (envelopeType: string) => void;
}) {
  const a = view.account;

  return (
    <section
      className="panel flex flex-col"
      data-testid="securities-overview-card"
      data-envelope={a.envelopeType}
    >
      <header className="flex min-w-0 items-center gap-[var(--space-3)] p-[var(--pad-card)] pb-[var(--space-3)]">
        <PlatformLogo src={a.platformLogoUrl} name={view.title} size={32} />
        <div className="min-w-0">
          {/* Le nom de l'établissement porte la carte ; l'enveloppe le
              qualifie. Deux PEA chez deux courtiers restent distincts. */}
          <h3
            className="truncate text-[length:var(--text-base)] font-medium text-[var(--foreground)]"
            data-testid="securities-account-title"
          >
            {view.title}
          </h3>
          <p className="text-label truncate">{view.subtitle}</p>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-[var(--space-3)] px-[var(--pad-card)]">
        <Metric
          label="Valeur totale"
          value={formatCurrency(view.valueEur, "EUR")}
        />
        <Metric
          label="Investi"
          value={formatCurrency(view.costBasisEur, "EUR")}
        />
        <Metric
          label="P&L"
          tone={getChangeColor(view.unrealizedPnlEur)}
          value={signedCurrency(view.unrealizedPnlEur, "EUR")}
          hint={
            <span className={getChangeColor(view.unrealizedPnlEur)}>
              {signedPct(view.unrealizedPnlPct)}
            </span>
          }
        />
      </div>

      <div className="mt-[var(--space-4)] grid grid-cols-2 gap-[var(--space-3)] border-t border-[var(--border-subtle)] px-[var(--pad-card)] pt-[var(--space-3)]">
        <Metric
          label="Liquidités"
          value={formatCurrency(view.cashEur, "EUR")}
          hint={
            a.cashAttributed
              ? view.cashSharePct != null
                ? `${pct(view.cashSharePct, 1)} du compte`
                : undefined
              : "Poche non rattachée à ce compte"
          }
        />
        <Metric
          label={view.investableLabel}
          value={formatCurrency(view.investableEur, "EUR")}
          hint={
            view.investableIsCapped
              ? "Marge restante sous le plafond réglementaire"
              : undefined
          }
        />
      </div>

      <div className="mt-[var(--space-4)] min-w-0 flex-1 px-[var(--pad-card)]">
        <h4 className="text-label">Principales positions</h4>
        {view.positions.length === 0 ? (
          <p className="text-meta mt-[var(--space-2)]">
            Aucune position rattachée à ce compte.
          </p>
        ) : (
          <table className="mt-[var(--space-2)] w-full text-[length:var(--text-sm)]">
            <thead>
              <tr className="text-label">
                <th className="py-[var(--space-1)] text-left font-medium">
                  Actif
                </th>
                <th className="py-[var(--space-1)] text-right font-medium">
                  Valeur
                </th>
                <th className="py-[var(--space-1)] text-right font-medium">
                  P&L
                </th>
                <th className="py-[var(--space-1)] text-right font-medium">
                  Poids
                </th>
              </tr>
            </thead>
            <tbody>
              {view.positions.map((p) => {
                const pnl = num(p.unrealizedPnlEur);
                const weight = positionWeightPct(p, a);
                return (
                  <tr
                    key={p.assetId}
                    className="border-t border-[var(--border-subtle)]"
                    data-testid="securities-top-position"
                  >
                    <td className="min-w-0 py-[var(--space-2)]">
                      <div className="flex min-w-0 items-center gap-[var(--space-2)]">
                        <PlatformLogo
                          src={p.logoUrl ?? null}
                          name={p.name}
                          size={20}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-[var(--foreground)]">
                            {p.name}
                          </span>
                          {p.ticker && (
                            <span className="num block truncate text-[length:var(--text-2xs)] text-[var(--foreground-faint)]">
                              {p.ticker}
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="num py-[var(--space-2)] text-right">
                      {formatCurrency(num(p.marketValueEur), "EUR")}
                    </td>
                    <td
                      className={cn(
                        "num py-[var(--space-2)] text-right",
                        getChangeColor(pnl)
                      )}
                    >
                      {signedPct(
                        p.unrealizedPnlPct != null ? num(p.unrealizedPnlPct) : null
                      )}
                    </td>
                    <td className="num py-[var(--space-2)] text-right text-[var(--foreground-secondary)]">
                      {pct(weight, 1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="p-[var(--pad-card)] pt-[var(--space-4)]">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => onOpenPositions?.(a.envelopeType)}
          data-testid="securities-see-all"
        >
          Voir toutes les positions ({a.positionCount})
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </section>
  );
}

/* ── Blocs annexes ────────────────────────────────────────────────── */

function SummaryRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-[var(--space-3)]">
      <dt className="text-meta min-w-0 truncate">{label}</dt>
      <dd className={cn("num shrink-0", tone ?? "text-[var(--foreground)]")}>
        {value}
      </dd>
    </div>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Wallet;
  label: string;
  onClick?: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-[var(--space-2)] rounded-[var(--radius-sm)]",
          "px-[var(--space-2)] py-[var(--space-2)] text-left text-[length:var(--text-sm)]",
          "text-[var(--foreground-secondary)] transition-colors duration-[var(--duration-fast)]",
          "hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]",
          "disabled:opacity-50"
        )}
        onClick={onClick}
        disabled={!onClick}
      >
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
      </button>
    </li>
  );
}

/**
 * Antériorité fiscale du PEA. Le compteur des cinq ans est la seule
 * information fiscale que l'application calcule réellement aujourd'hui ; le
 * reste du traitement par ligne relève du chantier fiscal.
 */
function FiscalStatusCard({
  account,
}: {
  account: SecuritiesAccount | null;
}) {
  if (!account?.maturity) {
    return (
      <section className="panel p-[var(--pad-card)]" data-testid="securities-fiscal">
        <h3 className="text-label">Statut fiscal</h3>
        <p className="text-meta mt-[var(--space-2)]">
          Aucun PEA déclaré : pas d&apos;antériorité fiscale à suivre. Les
          gains d&apos;un compte-titres sont imposables à chaque cession.
        </p>
      </section>
    );
  }

  const m = account.maturity;
  const months = Math.max(0, Math.round(m.daysToMaturity / 30.44));

  return (
    <section className="panel p-[var(--pad-card)]" data-testid="securities-fiscal">
      <h3 className="text-label">Statut fiscal</h3>

      <p className="mt-[var(--space-3)] flex items-center gap-[var(--space-2)] text-[length:var(--text-sm)]">
        <ShieldCheck
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            m.isMatured ? "text-[var(--positive)]" : "text-[var(--primary-text)]"
          )}
          aria-hidden
        />
        <span className="min-w-0 text-[var(--foreground-secondary)]">
          {account.envelopeLabel} ouvert le{" "}
          <span className="num">{formatDate(account.openDate)}</span>
        </span>
      </p>

      {m.isMatured ? (
        <p className="text-meta mt-[var(--space-3)]">
          Antériorité de cinq ans acquise : les plus-values sont exonérées
          d&apos;impôt sur le revenu. Les prélèvements sociaux restent dus.
        </p>
      ) : (
        <>
          <p className="text-meta mt-[var(--space-3)]">
            Exonération d&apos;impôt sur les plus-values acquise dans
          </p>
          <p
            className="num mt-[var(--space-1)] text-[length:var(--text-2xl)] font-semibold text-[var(--foreground)]"
            data-testid="securities-maturity-countdown"
          >
            {months} mois
          </p>
          <p className="text-meta mt-[var(--space-1)] flex items-center gap-[var(--space-2)]">
            <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
            <span className="num">Soit le {formatDate(m.maturityDate)}</span>
          </p>
        </>
      )}

      <dl className="mt-[var(--space-4)] space-y-[var(--space-2)] border-t border-[var(--border-subtle)] pt-[var(--space-3)] text-[length:var(--text-sm)]">
        <SummaryRow
          label="Régime"
          value={m.isMatured ? "Exonéré après 5 ans" : "Exonération à 5 ans"}
        />
        <SummaryRow
          label="Acquise le"
          value={formatDate(m.maturityDate)}
        />
        <SummaryRow
          label="Prélèvements sociaux"
          value={pct(SOCIAL_CHARGES_PCT, 1)}
        />
      </dl>
    </section>
  );
}

/**
 * Performance cumulée depuis l'ouverture.
 *
 * L'application n'historise pas la valeur **par enveloppe** : la courbe
 * patrimoniale globale mélange immobilier, crypto et comptes titres, et la
 * tracer ici reviendrait à présenter la performance d'autre chose. L'emplacement
 * est donc tenu, vide et annoncé, plutôt que rempli d'une courbe qui ne
 * répondrait pas à la question posée.
 */
function CumulativePerformance() {
  return (
    <PendingBackend
      testId="securities-performance-pending"
      title="Performance cumulée"
      what="Courbe de valeur des enveloppes titres depuis leur ouverture, comparable à un indice, avec sélecteur de période."
      missing="L'historique de valeur est calculé pour le patrimoine entier, pas par enveloppe. Il manque une série quotidienne restreinte aux comptes titres — le reste de l'écran est déjà servi par des données réelles."
    />
  );
}

function KeyIndicatorsCard({
  indicators,
  accountCount,
}: {
  indicators: ReturnType<typeof computeKeyIndicators>;
  accountCount: number;
}) {
  return (
    <section
      className="panel p-[var(--pad-card)]"
      data-testid="securities-indicators"
    >
      <h3 className="text-title">Indicateurs clés</h3>

      <div className="mt-[var(--space-4)] grid grid-cols-2 gap-x-[var(--space-4)] gap-y-[var(--space-4)]">
        <div className="min-w-0">
          <div className="text-label">Exposition actions</div>
          <div className="num mt-[var(--space-1)] text-[length:var(--text-lg)] font-medium text-[var(--foreground)]">
            {pct(indicators.equityExposurePct, 1)}
          </div>
          <ShareBar value={indicators.equityExposurePct} />
        </div>

        <Metric
          label="Nombre de lignes"
          value={String(indicators.positionCount)}
          hint={`Sur ${accountCount} compte${accountCount > 1 ? "s" : ""}`}
        />

        <Metric
          label="Poids moyen"
          value={pct(indicators.averageWeightPct, 2)}
        />

        <Metric
          label="Plus grosse ligne"
          value={pct(indicators.largestPositionPct, 1)}
          hint={indicators.largestPositionName ?? undefined}
        />
      </div>

      {/* Le mockup montre aussi PER, rendement et bêta moyens. Ces mesures
          demandent des données de marché par ligne que l'application ne
          collecte pas : mieux vaut quatre chiffres exacts que six dont deux
          inventés. */}
      <p className="text-meta mt-[var(--space-4)] border-t border-[var(--border-subtle)] pt-[var(--space-3)]">
        PER, rendement et bêta moyens demandent des données fondamentales par
        ligne, que l&apos;application ne collecte pas encore.
      </p>
    </section>
  );
}
