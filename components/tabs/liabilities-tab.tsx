"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormActions } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { DateInput } from "@/components/ui/date-input";
import { LiabilityCreateForm } from "@/components/modals/liability-create-form";
import type { LiabilityForm } from "@/app/lib/schemas";
import {
  LIABILITY_CATEGORIES,
  LIABILITY_CATEGORY_LABELS,
  LIABILITY_LENDER_OPTIONS,
} from "@/app/lib/constants";
import { formatCurrency } from "@/app/lib/utils";

import {
  buildLiabilityViews,
  computeLiabilityTotals,
  debtToPatrimonyPct,
} from "@/app/lib/liabilities/overview";
import { LiabilityList } from "@/components/liabilities/liability-list";
import { LiabilityPanel } from "@/components/liabilities/liability-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiBandTile } from "@/components/ui/kpi-tiles";


type LiabilityRow = {
  id: string;
  name: string;
  initialAmount: string;
  remainingAmount: string;
  remainingEur: string;
  currency: string;
  interestRate: string | null;
  monthlyPayment: string | null;
  insuranceMonthly: string | null;
  startDate: string | null;
  endDate: string | null;
  paymentDay: number | null;
  lastPaymentAppliedAt: string | null;
  bankName: string | null;
  category: string;
  /** assetId brut (colonne Prisma) — voir linkedAssetId pour l'alias API/UI. */
  assetId: string | null;
  linkedAssetId: string | null;
  linkedAsset: {
    id: string;
    name: string;
    category: string;
    accountType: string;
    manualPrice: string | null;
  } | null;
  notes: string | null;
  monthsRemaining: number | null;
  estimatedInterestRemaining: string;
  events: Array<{
    id: string;
    type: string;
    amount: string | null;
    remainingAfter: string | null;
    eventDate: string;
    notes: string | null;
  }>;
};

/** Sous-ensemble d'Asset utilisé pour le sélecteur « Bien lié » — GET /api/assets réutilisé. */
type LinkableAsset = {
  id: string;
  name: string;
  ticker: string | null;
  category: string;
  accountType: string;
};

function isRealEstateAsset(a: LinkableAsset): boolean {
  return a.category === "REAL_ESTATE_DIRECT" || a.accountType === "IMMOBILIER";
}


type LiabilityCategory = (typeof LIABILITY_CATEGORIES)[number];

const LIABILITY_VIEWS = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "credits", label: "Crédits" },
  { id: "schedule", label: "Échéancier" },
  { id: "cost", label: "Coût de la dette" },
] as const;

type LiabilityViewId = (typeof LIABILITY_VIEWS)[number]["id"];

export function LiabilitiesTab({
  grossAssetsEur,
  onOpenAsset,
}: {
  /**
   * Actifs bruts, pour rapporter la dette au patrimoine. Absent, le ratio
   * n'est pas affiché — un ratio sans dénominateur ne veut rien dire.
   */
  grossAssetsEur?: number | null;
  /** Ouvre le bien immobilier financé par un crédit. */
  onOpenAsset?: (assetId: string) => void;
}) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<LiabilityViewId>("overview");
  const [earlyId, setEarlyId] = useState<string | null>(null);
  const [earlyKind, setEarlyKind] = useState<"PARTIAL" | "TOTAL">("PARTIAL");
  const [earlyAmount, setEarlyAmount] = useState("");
  const [earlyDate, setEarlyDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [amendId, setAmendId] = useState<string | null>(null);
  const [amendPayment, setAmendPayment] = useState("");
  const [amendDate, setAmendDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [rateId, setRateId] = useState<string | null>(null);
  const [rateValue, setRateValue] = useState("");
  const [rateDate, setRateDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [deleteTarget, setDeleteTarget] = useState<LiabilityRow | null>(null);
  const [deleteConfirmChecked, setDeleteConfirmChecked] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const DELETE_CONFIRM_WORD = "SUPPRIMER";
  const canForceDelete =
    deleteConfirmChecked &&
    deleteConfirmText.trim().toUpperCase() === DELETE_CONFIRM_WORD;


  const listQ = useQuery({
    queryKey: ["liabilities"],
    queryFn: () =>
      fetchJson<{ liabilities: LiabilityRow[]; totalRemainingEur: string }>(
        "/api/liabilities"
      ),
  });

  // Réutilise la liste d'actifs déjà exposée par /api/assets (pas de route
  // dédiée) pour peupler le sélecteur de bien immobilier lié.
  const assetsQ = useQuery({
    queryKey: ["assets"],
    queryFn: () => fetchJson<{ assets: LinkableAsset[] }>("/api/assets"),
  });
  const realEstateAssets = useMemo(
    () => (assetsQ.data?.assets ?? []).filter(isRealEstateAsset),
    [assetsQ.data?.assets]
  );

  const rows = useMemo(
    () => listQ.data?.liabilities ?? [],
    [listQ.data?.liabilities]
  );

  // Échéance à venir : calculée une seule fois pour tous les crédits actifs
  // (pas de fausse alerte sur les crédits soldés — jamais dans activeRows).
  // Diff en jours calendaires UTC, cohérent avec nextPaymentDueDate /
  // startOfUtcDay déjà utilisés par le module d'amortissement.
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ["liabilities"] });
    await qc.invalidateQueries({ queryKey: ["holdings"] });
  };

  const createMut = useMutation({
    mutationFn: (body: LiabilityForm) =>
      fetchJson("/api/liabilities", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      toast.success("Crédit créé");
      setShowCreate(false);
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/liabilities?id=${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      toast.success("Passif supprimé");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const earlyMut = useMutation({
    mutationFn: () =>
      fetchJson("/api/liabilities", {
        method: "POST",
        body: JSON.stringify({
          action: "early_repayment",
          liabilityId: earlyId,
          kind: earlyKind,
          amount: earlyAmount,
          eventDate: earlyDate,
        }),
      }),
    onSuccess: async () => {
      toast.success(
        earlyKind === "TOTAL"
          ? "Remboursement total enregistré"
          : "Remboursement partiel — capital recalculé"
      );
      setEarlyId(null);
      setEarlyAmount("");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const amendMut = useMutation({
    mutationFn: () =>
      fetchJson("/api/liabilities", {
        method: "POST",
        body: JSON.stringify({
          action: "payment_change",
          liabilityId: amendId,
          monthlyPayment: amendPayment,
          eventDate: amendDate,
        }),
      }),
    onSuccess: async () => {
      toast.success("Avenant mensualité — durée et intérêts réestimés");
      setAmendId(null);
      setAmendPayment("");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rateMut = useMutation({
    mutationFn: () =>
      fetchJson("/api/liabilities", {
        method: "POST",
        body: JSON.stringify({
          action: "rate_change",
          liabilityId: rateId,
          interestRate: rateValue,
          eventDate: rateDate,
        }),
      }),
    onSuccess: async () => {
      toast.success("Taux mis à jour — projections recalculées");
      setRateId(null);
      setRateValue("");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const views = buildLiabilityViews(rows);
  const totals = computeLiabilityTotals(views);
  const selectedView = views.find((v) => v.id === selectedId) ?? null;
  const selectedRow = rows.find((l) => l.id === selectedId) ?? null;
  const debtRatioPct = debtToPatrimonyPct(totals.totalDebtEur, grossAssetsEur);

  const visibleViews =
    view === "credits" || view === "overview"
      ? views
      : views.filter((v) => v.status === "ACTIVE");

  /*
    Charge mensuelle consolidée — les trois prochaines échéances, tous crédits
    confondus. Elle répond à « combien cela me coûte chaque mois », qui est la
    deuxième des quatre questions du module.
  */
  const [clock] = useState(() => new Date());

  /*
    Charge mensuelle consolidée — les trois prochaines échéances, tous crédits
    confondus. Elle répond à « combien cela me coûte chaque mois », la deuxième
    des quatre questions du module.

    L'horloge est lue une fois, dans un initialiseur d'état : la lire à chaque
    rendu rendrait le composant impur et ferait bouger les dates sous le
    curseur.
  */
  const upcomingActive = views.filter(
    (v) => v.status === "ACTIVE" && v.totalMonthlyEur != null
  );
  const upcomingTotal = upcomingActive.reduce(
    (s, v) => s + (v.totalMonthlyEur ?? 0),
    0
  );
  const upcoming =
    upcomingActive.length === 0
      ? []
      : [1, 2, 3].map((i) => ({
          date: new Date(
            Date.UTC(clock.getUTCFullYear(), clock.getUTCMonth() + i, 1)
          ),
          amount: upcomingTotal,
        }));

  return (
    <div className="min-w-0 space-y-[var(--space-4)]" data-testid="liabilities-tab">
      <datalist id="liability-lenders-datalist">
        {LIABILITY_LENDER_OPTIONS.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>

      {/* ── En-tête ──────────────────────────────────────────────── */}
      <header className="module-page-header flex flex-wrap items-start justify-between gap-[var(--space-3)] px-0.5">
        <div className="min-w-0">
          <h1 className="text-title">Passifs / Crédits</h1>
          <p className="text-meta">
            Vue d&apos;ensemble de vos dettes et financements
            {totals.activeCount > 0 ? (
              <>
                <span className="mx-1 opacity-40">·</span>
                {totals.activeCount} crédit{totals.activeCount > 1 ? "s" : ""} en
                cours
                {totals.settledCount > 0 ? (
                  <>
                    <span className="mx-1 opacity-40">·</span>
                    {totals.settledCount} soldé
                    {totals.settledCount > 1 ? "s" : ""}
                  </>
                ) : null}
              </>
            ) : null}
          </p>
        </div>

        <div className="relative flex shrink-0 items-center gap-[var(--space-2)]">
          <Button onClick={() => setShowCreate(true)} data-testid="liability-add">
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Ajouter un crédit
          </Button>
        </div>
      </header>

      {/* ── KPI ──────────────────────────────────────────────────── */}
      <div
        className="card grid grid-cols-2 divide-x divide-y divide-[var(--border)] overflow-hidden sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5"
        data-testid="liability-kpi-strip"
      >
        <KpiBandTile
          testId="liability-kpi-debt"
          label="Dette totale"
          value={formatCurrency(String(totals.totalDebtEur), "EUR")}
          secondary="Capital restant dû"
          loading={listQ.isPending && !listQ.data}
        />
        <KpiBandTile
          testId="liability-kpi-monthly"
          label="Mensualités"
          value={
            totals.monthlyEur > 0
              ? formatCurrency(String(totals.monthlyEur), "EUR")
              : "—"
          }
          secondary={
            totals.monthlyInsuranceEur > 0
              ? `dont ${formatCurrency(String(totals.monthlyInsuranceEur), "EUR")} d'assurance`
              : "Total mensuel"
          }
          loading={listQ.isPending && !listQ.data}
        />
        <KpiBandTile
          testId="liability-kpi-rate"
          label="Taux moyen"
          value={
            totals.weightedRatePct != null
              ? `${totals.weightedRatePct.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`
              : "—"
          }
          secondary="Pondéré par l'encours"
          loading={listQ.isPending && !listQ.data}
        />
        <div data-testid="liability-kpi-interest-remaining">
          <KpiBandTile
            testId="liability-kpi-interest"
            label="Intérêts restants"
            value={formatCurrency(
              String(totals.estimatedInterestRemainingEur),
              "EUR"
            )}
            secondary="Estimation"
            loading={listQ.isPending && !listQ.data}
          />
        </div>
        <KpiBandTile
          testId="liability-kpi-count"
          label="Crédits actifs"
          value={String(totals.activeCount)}
          secondary={
            totals.lastEndDate
              ? `Fin ${totals.lastEndDateIsEstimated ? "env. " : ""}${new Date(
                  totals.lastEndDate
                ).toLocaleDateString("fr-FR", {
                  month: "short",
                  year: "numeric",
                })}`
              : "En cours"
          }
          loading={listQ.isPending && !listQ.data}
        />
      </div>

      {/*
        Poids de la dette dans le patrimoine.

        Affiché seulement quand les actifs bruts sont connus : un ratio sans
        dénominateur ne veut rien dire, et le montrer à 100 % serait pire que
        de ne rien montrer.
      */}
      {debtRatioPct != null && (
        <div
          className="card flex flex-wrap items-baseline justify-between gap-[var(--space-3)] px-[var(--space-4)] py-[var(--space-3)]"
          data-testid="liability-debt-ratio"
        >
          <div className="min-w-0">
            <p className="text-label">Dette / patrimoine</p>
            <p className="num text-[length:var(--text-lg)] font-semibold text-[var(--foreground)]">
              {formatCurrency(String(totals.totalDebtEur), "EUR")}
              <span className="mx-2 text-[var(--foreground-faint)]">·</span>
              <span className="text-[var(--primary-text)]">
                {debtRatioPct.toLocaleString("fr-FR", {
                  maximumFractionDigits: 1,
                })}{" "}
                %
              </span>
            </p>
          </div>
          <p className="text-meta shrink-0">
            Actifs bruts{" "}
            <span className="num">
              {formatCurrency(String(grossAssetsEur ?? 0), "EUR")}
            </span>
          </p>
        </div>
      )}

      {/* ── Navigation secondaire ────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)]">
        <div className="term-seg" role="tablist" aria-label="Vues des passifs">
          {LIABILITY_VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={view === v.id}
              data-active={view === v.id}
              className="term-seg-item"
              onClick={() => setView(v.id)}
              data-testid={`liability-view-${v.id}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Corps : liste + panneau ──────────────────────────────── */}
      <div className="grid min-w-0 gap-[var(--gap-card)] xl:grid-cols-[minmax(0,1fr)_var(--panel-width)] xl:items-start">
        <div className="flex min-w-0 flex-col gap-[var(--gap-card)]">
          {view === "schedule" && (
            <section
              className="card min-w-0 p-[var(--space-4)]"
              data-testid="liability-schedule-view"
            >
              <h2 className="text-label mb-[var(--space-3)]">
                Prochaines échéances
              </h2>
              {upcoming.length === 0 ? (
                <p className="text-meta">
                  Aucune mensualité renseignée — la charge mensuelle ne peut pas
                  être projetée.
                </p>
              ) : (
                <>
                  <ul className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
                    {upcoming.map((u) => (
                      <li
                        key={u.date.toISOString()}
                        className="flex items-baseline justify-between gap-[var(--space-3)] py-[var(--space-2)]"
                      >
                        <span className="text-[length:var(--text-xs)] text-[var(--foreground)]">
                          {u.date.toLocaleDateString("fr-FR", {
                            day: "2-digit",
                            month: "long",
                            year: "numeric",
                          })}
                        </span>
                        <span className="num text-[length:var(--text-xs)] font-medium">
                          {formatCurrency(String(u.amount), "EUR")}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-meta mt-[var(--space-3)]">
                    Somme des mensualités des crédits en cours, assurance
                    comprise. Le détail échéance par échéance se lit dans la
                    fiche d&apos;un crédit, onglet Amortissement.
                  </p>
                </>
              )}
            </section>
          )}

          {view === "cost" && (
            <section
              className="card min-w-0 p-[var(--space-4)]"
              data-testid="liability-cost-view"
            >
              <h2 className="text-label mb-[var(--space-3)]">Coût de la dette</h2>
              <dl className="grid grid-cols-2 gap-[var(--space-3)] sm:grid-cols-4">
                <div>
                  <dt className="text-label">Intérêts restants</dt>
                  <dd className="num text-[length:var(--text-sm)] font-semibold val-negative">
                    {formatCurrency(
                      String(totals.estimatedInterestRemainingEur),
                      "EUR"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-label">Assurance mensuelle</dt>
                  <dd className="num text-[length:var(--text-sm)] font-semibold">
                    {totals.monthlyInsuranceEur > 0
                      ? formatCurrency(
                          String(totals.monthlyInsuranceEur),
                          "EUR"
                        )
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-label">Taux moyen pondéré</dt>
                  <dd className="num text-[length:var(--text-sm)] font-semibold">
                    {totals.weightedRatePct != null
                      ? `${totals.weightedRatePct.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-label">Charge mensuelle</dt>
                  <dd className="num text-[length:var(--text-sm)] font-semibold">
                    {formatCurrency(String(totals.monthlyEur), "EUR")}
                  </dd>
                </div>
              </dl>

              {totals.byCategory.length > 0 && (
                <>
                  <h3 className="text-label mt-[var(--space-5)] mb-[var(--space-2)]">
                    Répartition par type
                  </h3>
                  <div
                    className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]"
                    role="img"
                    aria-label={totals.byCategory
                      .map(
                        (c) =>
                          `${LIABILITY_CATEGORY_LABELS[c.category as LiabilityCategory] ?? c.category} ${Math.round(c.sharePct ?? 0)} %`
                      )
                      .join(", ")}
                  >
                    {totals.byCategory.map((c, i) => (
                      <span
                        key={c.category}
                        style={{
                          width: `${c.sharePct ?? 0}%`,
                          background: `var(--chart-${(i % 5) + 1})`,
                        }}
                      />
                    ))}
                  </div>
                  <ul className="mt-[var(--space-3)] grid gap-[var(--space-1)] sm:grid-cols-2">
                    {totals.byCategory.map((c, i) => (
                      <li
                        key={c.category}
                        className="flex items-baseline justify-between gap-[var(--space-3)]"
                      >
                        <span className="flex min-w-0 items-center gap-[var(--space-2)] text-[length:var(--text-xs)] text-[var(--foreground-secondary)]">
                          <span
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ background: `var(--chart-${(i % 5) + 1})` }}
                            aria-hidden
                          />
                          {LIABILITY_CATEGORY_LABELS[
                            c.category as LiabilityCategory
                          ] ?? c.category}
                        </span>
                        <span className="num shrink-0 text-[length:var(--text-xs)]">
                          {formatCurrency(String(c.remainingEur), "EUR")}
                          <span className="text-meta ml-[var(--space-2)]">
                            {c.sharePct != null
                              ? `${c.sharePct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`
                              : ""}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <p className="text-meta mt-[var(--space-4)]">
                Les intérêts restants sont une estimation calculée sur la durée
                résiduelle, à taux constant. Un remboursement anticipé les
                réduit.
              </p>
            </section>
          )}

          {/* Liste des crédits — présente sous chaque vue. */}
          <section className="card min-w-0 overflow-hidden" data-testid="liability-list">
            <div className="flex flex-wrap items-baseline justify-between gap-[var(--space-2)] border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
              <h2 className="text-label">Crédits</h2>
              <span className="text-meta num">
                {formatCurrency(String(totals.totalDebtEur), "EUR")}
              </span>
            </div>

            {listQ.isPending && !listQ.data ? (
              <div
                className="space-y-[var(--space-2)] p-[var(--space-4)]"
                data-testid="liabilities-loading"
              >
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : views.length === 0 ? (
              /*
                État vide **local** : l'utilisateur peut posséder tout un
                patrimoine et n'avoir aucun crédit. Ce n'est pas un compte
                vierge, et le cockpit global n'a rien à faire ici.
              */
              <div className="p-[var(--space-6)] text-center" data-testid="liability-empty">
                <p className="text-[length:var(--text-sm)] font-medium text-[var(--foreground)]">
                  Aucun passif
                </p>
                <p className="text-meta mx-auto mt-[var(--space-1)] max-w-prose">
                  Aucune dette n&apos;est actuellement renseignée. Un crédit
                  immobilier, auto ou à la consommation vient en déduction de
                  votre patrimoine net.
                </p>
                <Button
                  className="mt-[var(--space-4)]"
                  onClick={() => setShowCreate(true)}
                  data-testid="liability-empty-add"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Ajouter un crédit
                </Button>
              </div>
            ) : (
              <LiabilityList
                views={visibleViews}
                selectedId={selectedId}
                onSelect={setSelectedId}
              />
            )}
          </section>
        </div>

        <LiabilityPanel
          view={selectedView}
          events={selectedRow?.events ?? []}
          onClose={() => setSelectedId(null)}
          onEdit={(target) => {
            if (!selectedRow) return;
            if (target === "payment") {
              setAmendId(selectedRow.id);
              setAmendPayment(selectedRow.monthlyPayment ?? "");
            } else {
              setRateId(selectedRow.id);
              setRateValue(selectedRow.interestRate ?? "");
            }
          }}
          onRepay={() => {
            if (!selectedRow) return;
            setEarlyId(selectedRow.id);
            setEarlyKind("PARTIAL");
            setEarlyAmount("");
          }}
          onDelete={() => {
            if (selectedRow) setDeleteTarget(selectedRow);
          }}
          onOpenLinkedAsset={
            onOpenAsset ? (assetId) => onOpenAsset(assetId) : undefined
          }
        />
      </div>
      {showCreate && (
        <Modal
          title="Nouveau crédit / passif"
          onClose={() => setShowCreate(false)}
          wide
        >
          <LiabilityCreateForm
            pending={createMut.isPending}
            onCancel={() => setShowCreate(false)}
            onSubmit={(values) => createMut.mutate(values)}
            linkableAssets={realEstateAssets}
          />
        </Modal>
      )}

      {earlyId && (
        <Modal
          title="Enregistrer un remboursement"
          onClose={() => setEarlyId(null)}
        >
          <div className="space-y-3" data-testid="liability-repay-modal">
            <p className="text-meta leading-snug">
              Le montant est prérempli avec la prochaine mensualité lorsque
              disponible. Partiel : réduit le capital restant. Total : solde le
              crédit.
            </p>
            {(() => {
              const row = rows.find((r) => r.id === earlyId);
              if (!row) return null;
              return (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/25 px-3 py-2 text-[11px]">
                  <span className="font-medium">{row.name}</span>
                  <span className="text-[var(--muted-foreground)]">
                    {" "}
                    · restant{" "}
                    {formatCurrency(row.remainingAmount, row.currency)}
                    {row.monthlyPayment
                      ? ` · mensualité ${formatCurrency(row.monthlyPayment, row.currency)}`
                      : ""}
                  </span>
                </div>
              );
            })()}
            <Field label="Type">
              <select
                className="input w-full"
                value={earlyKind}
                onChange={(e) =>
                  setEarlyKind(e.target.value as "PARTIAL" | "TOTAL")
                }
                data-testid="liability-repay-kind"
              >
                <option value="PARTIAL">Partiel (échéance / anticipé)</option>
                <option value="TOTAL">Total (solde le crédit)</option>
              </select>
            </Field>
            {earlyKind === "PARTIAL" && (
              <Field label="Montant remboursé">
                <input
                  className="input w-full"
                  value={earlyAmount}
                  onChange={(e) => setEarlyAmount(e.target.value)}
                  placeholder="Montant"
                  inputMode="decimal"
                  data-testid="liability-repay-amount"
                />
              </Field>
            )}
            <Field label="Date de l’opération">
              <DateInput
                value={earlyDate}
                onChange={(e) => setEarlyDate(e.target.value)}
              />
            </Field>
            <FormActions>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEarlyId(null)}
              >
                Annuler
              </Button>
              <Button
                onClick={() => earlyMut.mutate()}
                disabled={
                  earlyMut.isPending ||
                  (earlyKind === "PARTIAL" && !earlyAmount)
                }
                data-testid="liability-repay-submit"
              >
                Enregistrer
              </Button>
            </FormActions>
          </div>
        </Modal>
      )}

      {amendId && (
        <Modal
          title="Avenant — nouvelle mensualité"
          onClose={() => setAmendId(null)}
        >
          <div className="space-y-3">
            <p className="text-[11px] leading-snug text-slate-500">
              Nouvelle mensualité à effet donné. La durée résiduelle et les
              intérêts restants estimés sont recalculés sur le capital restant
              dû.
            </p>
            <Field label="Nouvelle mensualité">
              <input
                className="input w-full"
                value={amendPayment}
                onChange={(e) => setAmendPayment(e.target.value)}
                inputMode="decimal"
              />
            </Field>
            <Field label="Date d’effet">
              <DateInput
                value={amendDate}
                onChange={(e) => setAmendDate(e.target.value)}
              />
            </Field>
            <FormActions>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAmendId(null)}
              >
                Annuler
              </Button>
              <Button
                onClick={() => amendMut.mutate()}
                disabled={amendMut.isPending || !amendPayment}
              >
                Appliquer l’avenant
              </Button>
            </FormActions>
          </div>
        </Modal>
      )}

      {rateId && (
        <Modal
          title="Avenant — nouveau taux"
          onClose={() => setRateId(null)}
        >
          <div className="space-y-3" data-testid="liability-rate-modal">
            <p className="text-[11px] leading-snug text-slate-500">
              Nouveau taux annuel à effet donné. La durée résiduelle et les
              intérêts restants estimés sont recalculés sur le capital restant
              dû.
            </p>
            <Field label="Nouveau taux annuel (%)">
              <input
                className="input w-full"
                value={rateValue}
                onChange={(e) => setRateValue(e.target.value)}
                inputMode="decimal"
                data-testid="liability-rate-value"
              />
            </Field>
            <Field label="Date d’effet">
              <DateInput
                value={rateDate}
                onChange={(e) => setRateDate(e.target.value)}
                data-testid="liability-rate-date"
              />
            </Field>
            <FormActions>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRateId(null)}
              >
                Annuler
              </Button>
              <Button
                onClick={() => rateMut.mutate()}
                disabled={rateMut.isPending || !rateValue}
                data-testid="liability-rate-submit"
              >
                Appliquer l’avenant
              </Button>
            </FormActions>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Modal
          title={`Supprimer « ${deleteTarget.name} »`}
          onClose={() => {
            setDeleteTarget(null);
            setDeleteConfirmChecked(false);
            setDeleteConfirmText("");
          }}
          panelClassName="max-w-md"
        >
          <div className="space-y-3" data-testid="liability-delete-modal">
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] leading-relaxed text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-50">
              <p className="font-semibold">Action irréversible</p>
              <p className="mt-1">
                Cette action supprimera définitivement le crédit{" "}
                <strong>{deleteTarget.name}</strong>, son{" "}
                <strong>historique d’événements</strong> (prélèvements,
                avenants, remboursements) et les{" "}
                <strong>projections associées</strong>. Aucune récupération
                possible.
              </p>
            </div>

            <label className="flex cursor-pointer items-start gap-2 text-[12px] text-[var(--foreground)]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={deleteConfirmChecked}
                onChange={(e) => setDeleteConfirmChecked(e.target.checked)}
                data-testid="liability-delete-confirm-check"
              />
              <span>
                Je comprends que cette action est définitive et que
                l’historique de ce crédit sera effacé.
              </span>
            </label>

            <label className="block text-[11px] text-red-900/90 dark:text-red-100/85">
              <span className="mb-1 block font-medium">
                Pour confirmer, saisissez{" "}
                <kbd className="rounded bg-red-100 px-1 font-mono text-[10px] dark:bg-red-950">
                  {DELETE_CONFIRM_WORD}
                </kbd>
              </span>
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                className="input w-full border-red-200 bg-white py-1.5 dark:border-red-900/50 dark:bg-[var(--input-bg)]"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder={DELETE_CONFIRM_WORD}
                data-testid="liability-delete-confirm-input"
                aria-label={`Saisir ${DELETE_CONFIRM_WORD} pour confirmer`}
              />
            </label>

            <div className="flex flex-col gap-1.5 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteConfirmChecked(false);
                  setDeleteConfirmText("");
                }}
                data-testid="liability-delete-cancel"
              >
                Annuler
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={!canForceDelete || deleteMut.isPending}
                data-testid="liability-delete-confirm"
                onClick={() => {
                  if (!canForceDelete) return;
                  deleteMut.mutate(deleteTarget.id);
                  setDeleteTarget(null);
                  setDeleteConfirmChecked(false);
                  setDeleteConfirmText("");
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deleteMut.isPending ? "Suppression…" : "SUPPRIMER"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
