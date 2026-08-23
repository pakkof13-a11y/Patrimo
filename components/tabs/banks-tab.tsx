"use client";

/**
 * Onglet Banques — vue de trésorerie patrimoniale.
 *
 * L'écran présentait trois listes indépendantes, chacune précédée de son
 * formulaire de création permanent : comptes courants, livrets, dépôts à
 * terme. C'était une console d'administration, pas une vue de patrimoine. On y
 * lisait des lignes, jamais une exposition.
 *
 * La hiérarchie est désormais celle par laquelle on lit réellement sa
 * trésorerie :
 *
 *     patrimoine bancaire → établissement → produit → détail
 *
 * L'établissement passe en premier parce que c'est lui qui porte le risque de
 * contrepartie et la garantie des dépôts ; les trois natures de produit
 * restent distinctes en base et dans les sous-onglets, mais cessent d'être
 * trois univers séparés à l'écran.
 *
 * Le détail — et toute l'édition avec lui — vit dans la colonne de droite,
 * exactement comme la fiche d'actif de la page Portefeuille et avec la même
 * classe `.asset-panel`. La liste reste visible, la sélection reste repérable,
 * et passer d'un compte à l'autre ne demande de refermer quoi que ce soit.
 *
 * Aucune route n'a changé : `/api/banks`, `/api/savings`, `/api/term-deposits`
 * et `/api/banks/summary` sont appelées comme avant, avec les mêmes charges
 * utiles.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { fetchJson } from "@/app/lib/api-client";
import { formatCurrency, cn } from "@/app/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { KpiBandTile } from "@/components/ui/kpi-tiles";
import {
  groupByInstitution,
  institutionCount,
  type BankProduct,
} from "@/app/lib/cash/bank-groups";
import {
  REGULATED_PRODUCT_LABELS,
  type RegulatedProductType,
} from "@/app/lib/cash/regulated-products";
import { InstitutionList, ProductTable } from "@/components/banks/bank-lists";
import {
  BankDetailPanel,
  type BankPanelTarget,
} from "@/components/banks/bank-detail-panel";
import {
  AddCheckingModal,
  AddSavingsModal,
  AddTermDepositModal,
  type AddKind,
  type CheckingPayload,
  type SavingsPayload,
  type TermDepositPayload,
} from "@/components/banks/add-account-modals";
import type {
  BankAccountRow,
  BanksSummary,
  BankSelection,
  SavingsRow,
  TermDepositRow,
} from "@/components/banks/bank-types";

const VIEWS = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "checking", label: "Comptes" },
  { id: "savings", label: "Livrets" },
  { id: "term", label: "Dépôts à terme" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

/**
 * KPI de tête.
 *
 * Grand chiffre, intitulé discret dessous, aucune carte colorée : c'est la
 * grammaire d'un terminal, et celle qu'emploient déjà le tableau de bord et
 * l'onglet Cryptos. Les valeurs viennent telles quelles de
 * `/api/banks/summary` — cet écran n'a pas de calcul propre à défendre.
 */
export function BanksTab({ baseCurrency }: { baseCurrency: string }) {
  const qc = useQueryClient();

  const banksQ = useQuery({
    queryKey: ["banks"],
    queryFn: () => fetchJson<{ accounts: BankAccountRow[] }>("/api/banks"),
  });
  const savingsQ = useQuery({
    queryKey: ["savings"],
    queryFn: () => fetchJson<{ accounts: SavingsRow[] }>("/api/savings"),
    refetchInterval: 60_000,
  });
  const summaryQ = useQuery({
    queryKey: ["banks-summary"],
    queryFn: () => fetchJson<BanksSummary>("/api/banks/summary"),
  });
  const termDepositsQ = useQuery({
    queryKey: ["term-deposits"],
    queryFn: () =>
      fetchJson<{ termDeposits: TermDepositRow[] }>("/api/term-deposits"),
  });

  const banks = useMemo(() => banksQ.data?.accounts ?? [], [banksQ.data]);
  const savings = useMemo(() => savingsQ.data?.accounts ?? [], [savingsQ.data]);
  const termDeposits = useMemo(
    () => termDepositsQ.data?.termDeposits ?? [],
    [termDepositsQ.data]
  );

  const [view, setView] = useState<ViewId>("overview");
  const [selection, setSelection] = useState<BankSelection | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addKind, setAddKind] = useState<AddKind | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BankPanelTarget | null>(null);

  /** Invalide banques + KPI cash + plateformes (cash rattaché par nom). */
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["banks"] }),
      qc.invalidateQueries({ queryKey: ["savings"] }),
      qc.invalidateQueries({ queryKey: ["banks-summary"] }),
      qc.invalidateQueries({ queryKey: ["term-deposits"] }),
      qc.invalidateQueries({ queryKey: ["holdings"] }),
      qc.invalidateQueries({ queryKey: ["platforms"] }),
      qc.invalidateQueries({ queryKey: ["portfolio-history"] }),
    ]);
  };

  const addBank = useMutation({
    mutationFn: (body: CheckingPayload) =>
      fetchJson("/api/banks", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async () => {
      toast.success("Compte courant ajouté");
      setAddKind(null);
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addSavings = useMutation({
    mutationFn: (body: SavingsPayload) =>
      fetchJson("/api/savings", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: async () => {
      toast.success("Livret ajouté");
      setAddKind(null);
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addTermDeposit = useMutation({
    mutationFn: (body: TermDepositPayload) =>
      fetchJson("/api/term-deposits", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      toast.success("Dépôt à terme ajouté");
      setAddKind(null);
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const patchBank = useMutation({
    mutationFn: (body: Record<string, string | boolean>) =>
      fetchJson("/api/banks", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const patchSavings = useMutation({
    mutationFn: (body: Record<string, string | boolean>) =>
      fetchJson("/api/savings", { method: "PUT", body: JSON.stringify(body) }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteBank = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/banks?id=${id}`, { method: "DELETE" }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteSavings = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/savings?id=${id}`, { method: "DELETE" }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });
  const deleteTermDeposit = useMutation({
    mutationFn: (id: string) =>
      fetchJson(`/api/term-deposits/${id}`, { method: "DELETE" }),
    onSuccess: () => refresh(),
    onError: (e: Error) => toast.error(e.message),
  });

  const accrueMut = useMutation({
    mutationFn: () =>
      fetchJson<{ periodsCredited?: number }>("/api/savings/accrue", {
        method: "POST",
      }),
    onSuccess: async (data) => {
      toast.success(
        data.periodsCredited
          ? `Intérêts crédités : ${data.periodsCredited} période(s)`
          : "Aucun versement dû pour le moment"
      );
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /*
    Les trois listes deviennent une seule collection de produits.

    C'est la seule transformation que fait cet écran sur les données : elle
    n'invente aucun montant, elle ne fait qu'aplatir trois formes en une pour
    que le regroupement par établissement puisse opérer.
  */
  const products = useMemo<BankProduct[]>(() => {
    const out: BankProduct[] = [];
    for (const b of banks) {
      out.push({
        id: b.id,
        kind: "CHECKING",
        name: "Compte courant",
        bankName: b.bankName,
        balance: b.balance,
        balanceBase: b.balanceBase ?? b.balance,
        currency: b.currency,
        ratePercent: null,
        countsInNetWorth: b.countsInNetWorth,
        isPro: b.isPro,
        ownershipPct: b.ownershipPct,
      });
    }
    for (const s of savings) {
      out.push({
        id: s.id,
        kind: "SAVINGS",
        name: s.name,
        bankName: s.bankName,
        // Le solde d'affichage inclut les intérêts courus : c'est ce que le
        // livret vaut aujourd'hui, donc ce que la liste doit montrer.
        balance: s.displayBalance,
        balanceBase: s.displayBalanceBase ?? s.displayBalance,
        currency: s.currency,
        ratePercent: s.apyPercent,
        countsInNetWorth: s.countsInNetWorth,
        isPro: s.isPro,
        ownershipPct: s.ownershipPct,
      });
    }
    for (const t of termDeposits) {
      out.push({
        id: t.id,
        kind: "TERM_DEPOSIT",
        name: `Dépôt à terme${t.maturityDate ? ` · ${new Date(t.maturityDate).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" })}` : ""}`,
        bankName: t.bankName,
        balance: t.principal,
        balanceBase: t.principalBase,
        currency: t.currency,
        ratePercent: t.ratePercent,
        countsInNetWorth: true,
        isPro: t.isPro,
        ownershipPct: t.ownershipPct,
      });
    }
    return out;
  }, [banks, savings, termDeposits]);

  const institutions = useMemo(
    () => groupByInstitution(products),
    [products]
  );

  /** Résout la sélection en cible du panneau, ou `null` si la ligne a disparu. */
  const panelTarget = useMemo<BankPanelTarget | null>(() => {
    if (!selection) return null;
    if (selection.kind === "INSTITUTION") {
      const inst = institutions.find((i) => i.key === selection.id);
      return inst ? { kind: "INSTITUTION", institution: inst } : null;
    }
    if (selection.kind === "CHECKING") {
      const row = banks.find((b) => b.id === selection.id);
      return row ? { kind: "CHECKING", row } : null;
    }
    if (selection.kind === "SAVINGS") {
      const row = savings.find((s) => s.id === selection.id);
      return row ? { kind: "SAVINGS", row } : null;
    }
    const row = termDeposits.find((t) => t.id === selection.id);
    return row ? { kind: "TERM_DEPOSIT", row } : null;
  }, [selection, institutions, banks, savings, termDeposits]);

  const summary = summaryQ.data;
  const summaryLoading = summaryQ.isPending && !summaryQ.data;
  const nbInstitutions = institutionCount(products);
  const accountCount = products.length;

  const visibleProducts = useMemo(() => {
    if (view === "checking") return products.filter((p) => p.kind === "CHECKING");
    if (view === "savings") return products.filter((p) => p.kind === "SAVINGS");
    if (view === "term")
      return products.filter((p) => p.kind === "TERM_DEPOSIT");
    return products;
  }, [products, view]);

  const confirmDelete = () => {
    if (!deleteTarget || deleteTarget.kind === "INSTITUTION") return;
    const id = deleteTarget.row.id;
    if (deleteTarget.kind === "CHECKING") deleteBank.mutate(id);
    else if (deleteTarget.kind === "SAVINGS") deleteSavings.mutate(id);
    else deleteTermDeposit.mutate(id);
    setSelection(null);
    setDeleteTarget(null);
  };

  return (
    <div className="section-stack space-y-[var(--space-4)]" data-testid="banks-tab">
      <header className="module-page-header flex flex-wrap items-start justify-between gap-[var(--space-3)] px-0.5">
        <div className="min-w-0">
          <h1 className="text-title">Banques</h1>
          <p className="text-meta">
            Trésorerie, épargne et liquidités
            {accountCount > 0 ? (
              <>
                <span className="mx-1 opacity-40">·</span>
                {nbInstitutions} établissement{nbInstitutions > 1 ? "s" : ""}
                <span className="mx-1 opacity-40">·</span>
                {accountCount} compte{accountCount > 1 ? "s" : ""}
              </>
            ) : null}
          </p>
        </div>

        <div className="relative flex shrink-0 items-center gap-[var(--space-2)]">
          <Button
            variant="ghost"
            onClick={() => accrueMut.mutate()}
            disabled={accrueMut.isPending}
            title="Créditer les intérêts dus sur les livrets"
            data-testid="banks-accrue"
          >
            <RefreshCw
              className={cn(
                "mr-1.5 h-3.5 w-3.5",
                accrueMut.isPending && "animate-spin"
              )}
              aria-hidden
            />
            Créditer les intérêts
          </Button>

          <Button
            onClick={() => setAddOpen((o) => !o)}
            data-testid="banks-add-open"
            aria-expanded={addOpen}
            aria-haspopup="menu"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            Ajouter
            <ChevronDown className="ml-1 h-3.5 w-3.5" aria-hidden />
          </Button>

          {addOpen ? (
            <>
              {/*
                Fond transparent plein écran : cliquer ailleurs referme le menu.
                Moins coûteux qu'un écouteur global, et le focus reste piégé
                dans le menu tant qu'il est ouvert.
              */}
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                aria-label="Fermer le menu"
                onClick={() => setAddOpen(false)}
              />
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-[var(--space-1)] min-w-[12rem] overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] py-[var(--space-1)] shadow-[var(--shadow-lg)]"
                data-testid="banks-add-menu"
              >
                {(
                  [
                    ["CHECKING", "Compte courant"],
                    ["SAVINGS", "Livret"],
                    ["TERM_DEPOSIT", "Dépôt à terme"],
                  ] as const
                ).map(([kind, label]) => (
                  <button
                    key={kind}
                    type="button"
                    role="menuitem"
                    className="block w-full px-[var(--space-3)] py-[var(--space-2)] text-left text-[length:var(--text-xs)] text-[var(--foreground)] transition-[background-color] hover:bg-[var(--surface-hover)]"
                    onClick={() => {
                      setAddKind(kind);
                      setAddOpen(false);
                    }}
                    data-testid={`banks-add-${kind.toLowerCase()}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </header>

      {/* KPI — mêmes chiffres que /api/banks/summary, présentation terminal. */}
      <div
        className="card grid grid-cols-2 divide-x divide-y divide-[var(--border)] overflow-hidden sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5"
        data-testid="banks-summary-strip"
      >
        <KpiBandTile
          label="Liquidités"
          value={formatCurrency(summary?.checkingTotalBase ?? "0", baseCurrency)}
          secondary="Comptes courants"
          loading={summaryLoading}
        />
        <KpiBandTile
          label="Épargne"
          value={formatCurrency(summary?.savingsTotalBase ?? "0", baseCurrency)}
          secondary="Livrets + intérêts courus"
          loading={summaryLoading}
        />
        <KpiBandTile
          label="Rendement"
          value={
            summary?.weightedApyPct
              ? `${Number(summary.weightedApyPct).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`
              : "—"
          }
          secondary="Moyen pondéré, livrets"
          loading={summaryLoading}
        />
        <KpiBandTile
          label="Intérêts projetés"
          value={formatCurrency(
            summary?.projectedAnnualInterestBase ?? "0",
            baseCurrency
          )}
          secondary="Projection 12 mois"
          loading={summaryLoading}
        />
        <KpiBandTile
          label="Établissements"
          value={String(nbInstitutions)}
          secondary={`${accountCount} compte${accountCount > 1 ? "s" : ""}`}
        />
      </div>

      {/* Liste + détail côte à côte — même grille que la page Portefeuille. */}
      <div className="grid min-w-0 gap-[var(--gap-card)] xl:grid-cols-[minmax(0,1fr)_var(--panel-width)] xl:items-start">
        <section className="card min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-[var(--space-2)] border-b border-[var(--border)] px-[var(--space-4)] py-[var(--space-3)]">
            <div
              className="term-seg"
              role="tablist"
              aria-label="Vue des produits bancaires"
            >
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  role="tab"
                  aria-selected={view === v.id}
                  data-active={view === v.id}
                  className="term-seg-item"
                  onClick={() => setView(v.id)}
                  data-testid={`banks-view-${v.id}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <span className="text-meta num">
              Total{" "}
              {formatCurrency(
                String(
                  institutions.reduce((acc, i) => acc + i.totalBase, 0)
                ),
                baseCurrency
              )}
            </span>
          </div>

          {banksQ.isPending || savingsQ.isPending || termDepositsQ.isPending ? (
            <div className="space-y-[var(--space-2)] p-[var(--space-4)]">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : view === "overview" ? (
            <InstitutionList
              institutions={institutions}
              baseCurrency={baseCurrency}
              selection={selection}
              onSelect={setSelection}
            />
          ) : (
            <ProductTable
              products={visibleProducts}
              selection={selection}
              onSelect={setSelection}
              emptyLabel={
                view === "checking"
                  ? "Aucun compte courant."
                  : view === "savings"
                    ? "Aucun livret."
                    : "Aucun dépôt à terme."
              }
            />
          )}
        </section>

        <BankDetailPanel
          target={panelTarget}
          baseCurrency={baseCurrency}
          onClose={() => setSelection(null)}
          onPatchBank={(body) => patchBank.mutate(body)}
          onPatchSavings={(body) => patchSavings.mutate(body)}
          onDelete={setDeleteTarget}
          onSelectProduct={(kind, id) =>
            setSelection({ kind, id } as BankSelection)
          }
        />
      </div>

      {addKind === "CHECKING" && (
        <AddCheckingModal
          onClose={() => setAddKind(null)}
          onSubmit={(p) => addBank.mutate(p)}
          pending={addBank.isPending}
        />
      )}
      {addKind === "SAVINGS" && (
        <AddSavingsModal
          onClose={() => setAddKind(null)}
          onSubmit={(p) => addSavings.mutate(p)}
          pending={addSavings.isPending}
        />
      )}
      {addKind === "TERM_DEPOSIT" && (
        <AddTermDepositModal
          onClose={() => setAddKind(null)}
          onSubmit={(p) => addTermDeposit.mutate(p)}
          pending={addTermDeposit.isPending}
        />
      )}

      {deleteTarget && deleteTarget.kind !== "INSTITUTION" && (
        <ConfirmDialog
          open
          danger
          title="Supprimer ce produit ?"
          message={
            deleteTarget.kind === "CHECKING"
              ? `Le compte courant ${deleteTarget.row.bankName} et son historique seront supprimés.`
              : deleteTarget.kind === "SAVINGS"
                ? `Le livret ${deleteTarget.row.name} (${
                    REGULATED_PRODUCT_LABELS[
                      deleteTarget.row.productType as RegulatedProductType
                    ] ?? deleteTarget.row.productType
                  }) et son historique seront supprimés.`
                : `Le dépôt à terme ${deleteTarget.row.bankName ?? ""} sera supprimé.`
          }
          confirmLabel="Supprimer"
          testId="banks-delete-confirm"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
