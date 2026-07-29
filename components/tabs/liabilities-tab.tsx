"use client";

import { fetchJson } from "@/app/lib/api-client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Banknote,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Download,
  Home,
  MoreHorizontal,
  PencilLine,
  Percent,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormActions } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { DateInput } from "@/components/ui/date-input";
import { FinanceTip } from "@/components/ui/finance-tooltip";
import { LiabilityCreateForm } from "@/components/modals/liability-create-form";
import type { LiabilityForm } from "@/app/lib/schemas";
import {
  LIABILITY_CATEGORIES,
  LIABILITY_CATEGORY_LABELS,
  LIABILITY_LENDER_OPTIONS,
} from "@/app/lib/constants";
import { loadSessionPref, saveSessionPref } from "@/app/lib/ui-preferences";
import { formatCurrency, formatDate, cn } from "@/app/lib/utils";
import {
  buildAmortizationSchedule,
  currentScheduleIndex,
  nextPaymentDueDate,
  repaymentProgressPct,
  simulateEarlyRepayment,
} from "@/app/lib/liabilities/amortization";
import {
  ModuleCallout,
  ModuleCard,
  ModuleCardHeader,
  ModuleGuidedEmpty,
  ModuleKpi,
  ModulePageHeader,
  moduleTableHeadClass,
  moduleTableRowClass,
} from "@/components/ui/module-shell";

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

const EVENT_LABELS: Record<string, string> = {
  MONTHLY_DEBIT: "Prélèvement mensuel",
  EARLY_REPAYMENT_PARTIAL: "Remb. anticipé partiel",
  EARLY_REPAYMENT_TOTAL: "Remb. anticipé total",
  PAYMENT_CHANGE: "Avenant mensualité",
  RATE_CHANGE: "Avenant taux d'intérêt",
};

type LiabilityCategory = (typeof LIABILITY_CATEGORIES)[number];

const CATEGORY_BADGE_STYLES: Record<LiabilityCategory, string> = {
  IMMOBILIER:
    "bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-200/80 dark:bg-teal-950/40 dark:text-teal-200 dark:ring-teal-800/50",
  AUTO: "bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200/80 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800/50",
  CONSOMMATION:
    "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200/80 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800/50",
  DETTE_PRIVEE:
    "bg-purple-50 text-purple-800 ring-1 ring-inset ring-purple-200/80 dark:bg-purple-950/40 dark:text-purple-200 dark:ring-purple-800/50",
  PROFESSIONNEL:
    "bg-indigo-50 text-indigo-800 ring-1 ring-inset ring-indigo-200/80 dark:bg-indigo-950/40 dark:text-indigo-200 dark:ring-indigo-800/50",
  AUTRE:
    "bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-200/80 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700",
};

function CategoryBadge({ category }: { category: string }) {
  const known = (LIABILITY_CATEGORIES as readonly string[]).includes(category)
    ? (category as LiabilityCategory)
    : "AUTRE";
  return (
    <span
      className={cn(
        "inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
        CATEGORY_BADGE_STYLES[known]
      )}
    >
      {LIABILITY_CATEGORY_LABELS[known]}
    </span>
  );
}

type LiabilitySortKey = "remaining" | "monthly" | "endDate" | "name";
type LiabilitySort = { key: LiabilitySortKey; dir: "asc" | "desc" };

const LIABILITY_SORT_SESSION_KEY = "liabilitiesActiveSort";
const DEFAULT_LIABILITY_SORT: LiabilitySort = {
  key: "remaining",
  dir: "desc",
};

const LIABILITY_SORT_OPTIONS: { key: LiabilitySortKey; label: string }[] = [
  { key: "remaining", label: "Capital restant" },
  { key: "monthly", label: "Mensualité" },
  { key: "endDate", label: "Date de fin" },
  { key: "name", label: "Nom" },
];

/** null-safe : les valeurs manquantes vont toujours en fin de liste, quel que soit le sens. */
function compareNullableNumbers(
  a: number | null,
  b: number | null,
  dirMul: number
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dirMul;
}

export function LiabilitiesTab({ baseCurrency }: { baseCurrency: string }) {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
  const [showHelp, setShowHelp] = useState(false);
  const [settledOpen, setSettledOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<
    "ALL" | LiabilityCategory
  >("ALL");
  const [actionsMenuId, setActionsMenuId] = useState<string | null>(null);
  const actionsMenuRefs = useRef(new Map<string, HTMLDivElement>());
  const [sort, setSort] = useState<LiabilitySort>(() =>
    loadSessionPref(LIABILITY_SORT_SESSION_KEY, DEFAULT_LIABILITY_SORT)
  );
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<LiabilityRow | null>(null);
  const [deleteConfirmChecked, setDeleteConfirmChecked] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const DELETE_CONFIRM_WORD = "SUPPRIMER";
  const canForceDelete =
    deleteConfirmChecked &&
    deleteConfirmText.trim().toUpperCase() === DELETE_CONFIRM_WORD;

  function toggleSort(key: LiabilitySortKey) {
    setSort((prev) => {
      const next: LiabilitySort =
        prev.key === key
          ? { key, dir: prev.dir === "asc" ? "desc" : "asc" }
          : { key, dir: key === "name" ? "asc" : "desc" };
      saveSessionPref(LIABILITY_SORT_SESSION_KEY, next);
      return next;
    });
  }

  // Menu d'actions mobile (⋯) : ferme au clic extérieur ou à l'échap.
  useEffect(() => {
    if (!actionsMenuId) return;
    function onDoc(e: MouseEvent) {
      const el = actionsMenuRefs.current.get(actionsMenuId!);
      if (!el?.contains(e.target as Node)) setActionsMenuId(null);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [actionsMenuId]);

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
  const totalRemaining = listQ.data?.totalRemainingEur || "0";

  const activeRows = useMemo(
    () => rows.filter((l) => Number(l.remainingAmount) > 0),
    [rows]
  );
  const settledRows = useMemo(
    () => rows.filter((l) => Number(l.remainingAmount) <= 0),
    [rows]
  );

  const searchedActiveRows = useMemo(() => {
    const base =
      categoryFilter === "ALL"
        ? activeRows
        : activeRows.filter((l) => l.category === categoryFilter);
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.bankName || "").toLowerCase().includes(q)
    );
  }, [activeRows, categoryFilter, search]);

  const visibleActiveRows = useMemo(() => {
    const dirMul = sort.dir === "asc" ? 1 : -1;
    return [...searchedActiveRows].sort((a, b) => {
      switch (sort.key) {
        case "monthly":
          return compareNullableNumbers(
            a.monthlyPayment ? Number(a.monthlyPayment) : null,
            b.monthlyPayment ? Number(b.monthlyPayment) : null,
            dirMul
          );
        case "endDate":
          return compareNullableNumbers(
            a.endDate ? new Date(a.endDate).getTime() : null,
            b.endDate ? new Date(b.endDate).getTime() : null,
            dirMul
          );
        case "name":
          return (
            a.name.localeCompare(b.name, "fr", { sensitivity: "base" }) *
            dirMul
          );
        case "remaining":
        default:
          return (
            (Number(a.remainingAmount) - Number(b.remainingAmount)) * dirMul
          );
      }
    });
  }, [searchedActiveRows, sort]);

  const visibleSettledRows = useMemo(
    () =>
      categoryFilter === "ALL"
        ? settledRows
        : settledRows.filter((l) => l.category === categoryFilter),
    [settledRows, categoryFilter]
  );

  const monthlyOutflow = useMemo(() => {
    return activeRows.reduce((acc, l) => {
      if (!l.monthlyPayment) return acc;
      const n = Number(l.monthlyPayment);
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
  }, [activeRows]);

  const activeCount = activeRows.length;

  const totalInterestRemaining = useMemo(() => {
    return activeRows.reduce((acc, l) => {
      const n = Number(l.estimatedInterestRemaining);
      return acc + (Number.isFinite(n) ? n : 0);
    }, 0);
  }, [activeRows]);

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

  const patchMut = useMutation({
    mutationFn: (body: Record<string, string | number | null>) =>
      fetchJson("/api/liabilities", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      toast.success("Passif mis à jour");
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

  const renderLiabilityRow = (l: LiabilityRow, settled: boolean) => {
    const expanded = expandedId === l.id;
    const pct = repaymentProgressPct(l.initialAmount, l.remainingAmount);
    const nextDue = !settled
      ? nextPaymentDueDate({
          paymentDay: l.paymentDay,
          startDate: l.startDate ? new Date(l.startDate) : null,
          endDate: l.endDate ? new Date(l.endDate) : null,
          lastPaymentAppliedAt: l.lastPaymentAppliedAt
            ? new Date(l.lastPaymentAppliedAt)
            : null,
        })
      : null;
    const nextAmount =
      !settled && l.monthlyPayment && Number(l.remainingAmount) > 0
        ? l.monthlyPayment
        : null;

    return (
      <Fragment key={l.id}>
        <tr
          className={cn(moduleTableRowClass, settled && "opacity-60")}
          data-testid={`liability-row-${l.id}`}
        >
          <td className="px-3 py-2.5">
            <button
              type="button"
              className="flex items-start gap-1.5 text-left"
              onClick={() =>
                setExpandedId((id) => (id === l.id ? null : l.id))
              }
              aria-expanded={expanded}
              data-testid={`liability-expand-${l.id}`}
            >
              {expanded ? (
                <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
              ) : (
                <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" />
              )}
              <span>
                <span className="flex items-center gap-1.5">
                  <span className="font-medium text-[var(--foreground)]">
                    {l.name}
                  </span>
                  <CategoryBadge category={l.category} />
                  {l.linkedAssetId && (
                    <span
                      className="inline-flex text-teal-600 dark:text-teal-400"
                      role="img"
                      aria-label={`Bien lié : ${l.linkedAsset?.name ?? "bien immobilier"}`}
                      title={`Bien lié : ${l.linkedAsset?.name ?? "bien immobilier"}`}
                      data-testid={`liability-linked-badge-${l.id}`}
                    >
                      <Home className="h-3 w-3 shrink-0" />
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-[11px] text-[var(--muted-foreground)]">
                  {l.bankName || "Prêteur non renseigné"}
                  {!settled && l.monthsRemaining != null
                    ? ` · ${l.monthsRemaining} mois restants`
                    : ""}
                  {settled ? " · soldé" : ""}
                </span>
              </span>
            </button>
          </td>
          <td className="px-3 py-2.5 text-right">
            <div
              className={cn(
                "tabular-nums font-semibold",
                settled
                  ? "text-[var(--muted-foreground)]"
                  : "text-[var(--danger)]"
              )}
            >
              {formatCurrency(l.remainingAmount, l.currency)}
            </div>
            <div className="text-[10px] tabular-nums text-[var(--muted-foreground)]">
              initial {formatCurrency(l.initialAmount, l.currency)}
            </div>
          </td>
          <td className="px-3 py-2.5 text-right">
            <div className="tabular-nums text-[var(--foreground)]">
              {l.interestRate != null && l.interestRate !== ""
                ? `${Number(l.interestRate).toLocaleString("fr-FR", { maximumFractionDigits: 3 })} %`
                : "—"}
            </div>
            <div className="text-[10px] text-[var(--muted-foreground)]">
              effectif / an
            </div>
          </td>
          <td className="px-3 py-2.5">
            {nextDue ? (
              <div>
                <div className="font-medium tabular-nums text-[var(--foreground)]">
                  {formatDate(nextDue.toISOString())}
                </div>
                <div className="text-[11px] tabular-nums text-teal-600 dark:text-teal-300">
                  {nextAmount ? formatCurrency(nextAmount, l.currency) : "—"}
                </div>
              </div>
            ) : (
              <span className="text-[var(--muted-foreground)]">—</span>
            )}
          </td>
          <td className="px-3 py-2.5">
            <div className="flex items-center gap-2">
              <div
                className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted)]"
                role="progressbar"
                aria-valuenow={Math.round(pct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Remboursé à ${Math.round(pct)} %`}
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-teal-600 to-teal-400 transition-[width]"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-[var(--muted-foreground)]">
                {Math.round(pct)} %
              </span>
            </div>
          </td>
          <td className="px-2 py-2 text-right">
            {/* Desktop (sm+) : boutons complets */}
            <div className="hidden flex-wrap items-center justify-end gap-1 sm:inline-flex">
              {!settled && (
                <Button
                  size="sm"
                  variant="outline"
                  className="!h-8 text-[11px]"
                  data-testid={`liability-repay-${l.id}`}
                  title="Enregistrer un remboursement (prérempli avec la prochaine mensualité)"
                  onClick={() => {
                    setEarlyId(l.id);
                    setEarlyKind("PARTIAL");
                    setEarlyAmount(
                      l.monthlyPayment && Number(l.monthlyPayment) > 0
                        ? String(l.monthlyPayment)
                        : ""
                    );
                    setEarlyDate(new Date().toISOString().slice(0, 10));
                  }}
                >
                  <Banknote className="h-3.5 w-3.5" />
                  Remboursement
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                className="!h-8 text-[11px]"
                data-testid={`liability-detail-${l.id}`}
                onClick={() =>
                  setExpandedId((id) => (id === l.id ? null : l.id))
                }
              >
                {expanded ? "Masquer" : "Détail"}
              </Button>
              {!settled && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="!h-7 !w-7 !px-0 text-slate-400 hover:text-slate-800"
                  title="Avenant mensualité"
                  aria-label="Avenant mensualité"
                  onClick={() => {
                    setAmendId(l.id);
                    setAmendPayment(l.monthlyPayment || "");
                    setAmendDate(new Date().toISOString().slice(0, 10));
                  }}
                >
                  <PencilLine className="h-3.5 w-3.5" />
                </Button>
              )}
              {!settled && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="!h-7 !w-7 !px-0 text-slate-400 hover:text-slate-800"
                  title="Avenant taux d'intérêt"
                  aria-label="Avenant taux d'intérêt"
                  data-testid={`liability-rate-open-${l.id}`}
                  onClick={() => {
                    setRateId(l.id);
                    setRateValue(l.interestRate || "");
                    setRateDate(new Date().toISOString().slice(0, 10));
                  }}
                >
                  <Percent className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="!h-7 !w-7 !px-0 text-slate-400 hover:text-red-600"
                aria-label="Supprimer le crédit"
                onClick={() => setDeleteTarget(l)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Mobile (< sm) : consolidé dans un menu ⋯ (chevron déjà seul contrôle d'expansion) */}
            <div className="inline-block sm:hidden">
              {!settled ? (
                <div
                  className="relative inline-block"
                  ref={(el) => {
                    if (el) actionsMenuRefs.current.set(l.id, el);
                    else actionsMenuRefs.current.delete(l.id);
                  }}
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    className="!h-8 !w-8 !px-0 text-slate-400 hover:text-slate-800"
                    aria-label={`Actions pour ${l.name}`}
                    aria-haspopup="menu"
                    aria-expanded={actionsMenuId === l.id}
                    data-testid={`liability-actions-${l.id}`}
                    onClick={() =>
                      setActionsMenuId((id) => (id === l.id ? null : l.id))
                    }
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                  {actionsMenuId === l.id && (
                    <div
                      className="absolute right-0 top-full z-20 mt-1 min-w-[11rem] rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg"
                      role="menu"
                      aria-label={`Actions pour ${l.name}`}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setActionsMenuId(null);
                        }
                      }}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-[var(--muted)]"
                        data-testid={`liability-menu-repay-${l.id}`}
                        onClick={() => {
                          setActionsMenuId(null);
                          setEarlyId(l.id);
                          setEarlyKind("PARTIAL");
                          setEarlyAmount(
                            l.monthlyPayment && Number(l.monthlyPayment) > 0
                              ? String(l.monthlyPayment)
                              : ""
                          );
                          setEarlyDate(new Date().toISOString().slice(0, 10));
                        }}
                      >
                        <Banknote className="h-3.5 w-3.5" />
                        Remboursement
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-[var(--muted)]"
                        data-testid={`liability-menu-amend-${l.id}`}
                        onClick={() => {
                          setActionsMenuId(null);
                          setAmendId(l.id);
                          setAmendPayment(l.monthlyPayment || "");
                          setAmendDate(new Date().toISOString().slice(0, 10));
                        }}
                      >
                        <PencilLine className="h-3.5 w-3.5" />
                        Avenant mensualité
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-[var(--muted)]"
                        data-testid={`liability-menu-rate-${l.id}`}
                        onClick={() => {
                          setActionsMenuId(null);
                          setRateId(l.id);
                          setRateValue(l.interestRate || "");
                          setRateDate(new Date().toISOString().slice(0, 10));
                        }}
                      >
                        <Percent className="h-3.5 w-3.5" />
                        Avenant taux
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-red-600 hover:bg-[var(--muted)]"
                        data-testid={`liability-menu-delete-${l.id}`}
                        onClick={() => {
                          setActionsMenuId(null);
                          setDeleteTarget(l);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Supprimer
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="!h-7 !w-7 !px-0 text-slate-400 hover:text-red-600"
                  aria-label="Supprimer le crédit"
                  onClick={() => setDeleteTarget(l)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </td>
        </tr>
        {expanded && (
          <tr className="border-t border-[var(--border)] bg-[var(--muted)]/20">
            <td colSpan={6} className="px-4 py-4">
              <LiabilityDetailPanel
                liability={l}
                onEditRate={(v) => {
                  // Ouvre la modale d'avenant plutôt que d'appeler
                  // l'API en direct : préremplie avec la valeur
                  // saisie, elle impose une date d'effet
                  // explicite et passe par rateMut (traçabilité).
                  setRateId(l.id);
                  setRateValue(v || "0");
                  setRateDate(new Date().toISOString().slice(0, 10));
                }}
                onEditRemaining={(v) => {
                  if (v !== l.remainingAmount)
                    patchMut.mutate({
                      id: l.id,
                      remainingAmount: v,
                    });
                }}
                onEditPaymentDay={(v) => {
                  const cur = l.paymentDay != null ? String(l.paymentDay) : "";
                  if (v !== cur)
                    patchMut.mutate({
                      id: l.id,
                      paymentDay: v === "" ? null : v,
                    });
                }}
                onEditBank={(v) => {
                  if (v !== (l.bankName || ""))
                    patchMut.mutate({
                      id: l.id,
                      bankName: v || null,
                    });
                }}
                onEditCategory={(v) => {
                  if (v !== l.category) patchMut.mutate({ id: l.id, category: v });
                }}
                onEditInsurance={(v) => {
                  if (v !== (l.insuranceMonthly ?? ""))
                    patchMut.mutate({
                      id: l.id,
                      insuranceMonthly: v === "" ? null : v,
                    });
                }}
                onEditAsset={(v) => {
                  if (v !== (l.linkedAssetId ?? ""))
                    patchMut.mutate({
                      id: l.id,
                      assetId: v === "" ? null : v,
                    });
                }}
                linkableAssets={realEstateAssets}
                onRepay={(amount) => {
                  setEarlyId(l.id);
                  setEarlyKind("PARTIAL");
                  setEarlyAmount(
                    amount ??
                      (l.monthlyPayment && Number(l.monthlyPayment) > 0
                        ? String(l.monthlyPayment)
                        : "")
                  );
                  setEarlyDate(new Date().toISOString().slice(0, 10));
                }}
              />
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  return (
    <div className="section-stack" data-testid="liabilities-tab">
      <datalist id="liability-lenders-datalist">
        {LIABILITY_LENDER_OPTIONS.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <ModulePageHeader
        title="Passifs / Crédits"
        subtitle={
          <>
            Crédits immobiliers, auto, conso ou dettes privées — capital restant
            dû, mensualités et{" "}
            <span className="inline-flex items-center gap-0.5">
              prélèvement automatique
              <FinanceTip term="Mensualité" />
            </span>
            .
          </>
        }
        actions={
          <Button
            size="sm"
            onClick={() => setShowCreate(true)}
            data-testid="liability-add"
          >
            <Plus className="h-3.5 w-3.5" />
            Nouveau crédit
          </Button>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ModuleKpi
          label="Capital restant dû"
          value={formatCurrency(totalRemaining, "EUR")}
          valueClassName="text-[var(--danger)]"
          hint={
            rows.length === 0
              ? "Somme des dettes une fois les crédits saisis"
              : baseCurrency !== "EUR"
                ? `Reporting aussi en ${baseCurrency}`
                : "Total consolidé en euros"
          }
        />
        <ModuleKpi
          label="Crédits actifs"
          value={
            <>
              {activeCount}
              {rows.length > 0 && activeCount !== rows.length ? (
                <span className="text-base font-normal text-[var(--muted-foreground)]">
                  {" "}
                  / {rows.length}
                </span>
              ) : null}
            </>
          }
          hint="Positions avec capital encore dû"
        />
        <ModuleKpi
          label="Charge mensuelle"
          tip={<FinanceTip term="Mensualité" />}
          value={formatCurrency(String(monthlyOutflow), "EUR")}
          hint="Somme des mensualités renseignées"
        />
        <div data-testid="liability-kpi-interest-remaining">
          <ModuleKpi
            label="Intérêts encore à payer"
            value={formatCurrency(String(totalInterestRemaining), "EUR")}
            valueClassName="text-[var(--muted-foreground)]"
            hint="Estimation sur la durée résiduelle · crédits actifs"
          />
        </div>
      </section>

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          className="text-[11px] font-medium text-[var(--primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          onClick={() => setShowHelp((v) => !v)}
          aria-expanded={showHelp}
        >
          {showHelp ? "Masquer l’aide" : "Comprendre le module"}
        </button>
      </div>

      {showHelp && (
        <ModuleCallout tone="info">
          <ul className="space-y-1.5">
            <li>
              <strong>Capital restant dû</strong> — solde encore à rembourser ;
              décrémenté automatiquement ou via remboursement anticipé.
            </li>
            <li>
              <strong>Jour de prélèvement</strong> — jour du mois (1–31) où la
              mensualité est appliquée. La date de début borne le premier
              prélèvement possible.
            </li>
            <li>
              <strong>Remboursement anticipé</strong> — partiel ou total, hors
              échéance mensuelle.
            </li>
            <li>
              <strong>Avenant</strong> — nouvelle mensualité ou taux : durée et
              intérêts restants sont réestimés.
            </li>
          </ul>
        </ModuleCallout>
      )}

      <ModuleCard>
        <ModuleCardHeader
          title="Crédits en cours"
          subtitle="Progression, prochaine échéance, amortissement prévisionnel et remboursements"
          actions={
            rows.length > 0 ? (
              <label className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted-foreground)]">
                Type
                <select
                  className="input !h-7 !py-0 text-[11px]"
                  value={categoryFilter}
                  onChange={(e) =>
                    setCategoryFilter(
                      e.target.value as "ALL" | LiabilityCategory
                    )
                  }
                  data-testid="liability-filter-category"
                >
                  <option value="ALL">Tous ({rows.length})</option>
                  {LIABILITY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {LIABILITY_CATEGORY_LABELS[c]} (
                      {rows.filter((l) => l.category === c).length})
                    </option>
                  ))}
                </select>
              </label>
            ) : undefined
          }
        />

        {activeRows.length > 0 && (
          <div
            className="flex flex-wrap items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 sm:px-5"
            data-testid="liability-toolbar"
          >
            <label className="relative flex items-center">
              <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-slate-400" />
              <input
                type="text"
                className="input !h-7 !py-0 pl-7 text-[11px]"
                placeholder="Rechercher (nom, prêteur)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="liability-search"
                aria-label="Rechercher un crédit par nom ou prêteur"
              />
            </label>
            <div
              className="flex flex-wrap items-center gap-1"
              role="group"
              aria-label="Trier les crédits actifs"
              data-testid="liability-sort"
            >
              {LIABILITY_SORT_OPTIONS.map((opt) => {
                const active = sort.key === opt.key;
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => toggleSort(opt.key)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition",
                      "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                      active
                        ? "bg-teal-700 text-white dark:bg-teal-500 dark:text-teal-950"
                        : "bg-transparent text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800/60"
                    )}
                    data-testid={`liability-sort-${opt.key}`}
                    aria-pressed={active}
                  >
                    {opt.label}
                    {active &&
                      (sort.dir === "asc" ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      ))}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {listQ.isLoading ? (
          <div
            className="space-y-2 px-4 py-4"
            aria-busy="true"
            data-testid="liabilities-loading"
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-14 skeleton-block rounded-lg border border-[var(--border)]"
              />
            ))}
          </div>
        ) : activeRows.length === 0 ? (
          <ModuleGuidedEmpty
            title="Aucun crédit pour l’instant"
            description="Enregistrez un crédit immobilier, auto, consommation ou une dette privée pour suivre le capital restant, la charge mensuelle et le calendrier."
            bullets={[
              "Montant initial et capital restant dû",
              "Mensualité + jour de prélèvement → décrément auto",
              "Tableau d’amortissement prévisionnel",
              "Remboursements anticipés en un clic",
            ]}
            primaryLabel="Créer mon premier crédit"
            onPrimary={() => setShowCreate(true)}
            primaryTestId="liability-empty-add"
          />
        ) : (
          <div className="table-container-responsive table-fluid-wrap">
            <table
              className="table-fluid text-sm"
              data-testid="liabilities-table"
            >
              <thead className={moduleTableHeadClass}>
                <tr>
                  <th className="px-3 py-2.5 text-left">Crédit</th>
                  <th className="px-3 py-2.5 text-right">Capital</th>
                  <th className="px-3 py-2.5 text-right">Taux</th>
                  <th className="px-3 py-2.5 text-left">Prochaine échéance</th>
                  <th className="min-w-[8rem] px-3 py-2.5 text-left">
                    Progression
                  </th>
                  <th className="px-3 py-2.5 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleActiveRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-10 text-center text-sm text-[var(--muted-foreground)]"
                      data-testid="liability-no-match"
                    >
                      Aucun crédit ne correspond au filtre.
                    </td>
                  </tr>
                ) : (
                  visibleActiveRows.map((l) => renderLiabilityRow(l, false))
                )}
              </tbody>
            </table>
          </div>
        )}
      </ModuleCard>

      {settledRows.length > 0 && (
        <ModuleCard testId="liability-settled-section">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-4 py-3.5 text-left sm:px-5"
            onClick={() => setSettledOpen((v) => !v)}
            aria-expanded={settledOpen}
            data-testid="liability-settled-toggle"
          >
            {settledOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
            )}
            <span className="text-title">
              Crédits soldés ({settledRows.length})
            </span>
          </button>

          {settledOpen && (
            <div className="table-container-responsive table-fluid-wrap border-t border-[var(--border)]">
              <table
                className="table-fluid text-sm"
                data-testid="liabilities-settled-table"
              >
                <thead className={moduleTableHeadClass}>
                  <tr>
                    <th className="px-3 py-2.5 text-left">Crédit</th>
                    <th className="px-3 py-2.5 text-right">Capital</th>
                    <th className="px-3 py-2.5 text-right">Taux</th>
                    <th className="px-3 py-2.5 text-left">
                      Prochaine échéance
                    </th>
                    <th className="min-w-[8rem] px-3 py-2.5 text-left">
                      Progression
                    </th>
                    <th className="px-3 py-2.5 text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSettledRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-10 text-center text-sm text-[var(--muted-foreground)]"
                      >
                        Aucun crédit soldé ne correspond au filtre.
                      </td>
                    </tr>
                  ) : (
                    visibleSettledRows.map((l) => renderLiabilityRow(l, true))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </ModuleCard>
      )}

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
                className="input"
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
                  className="input"
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
                className="input"
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
                className="input"
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
                className="input !border-red-200 !bg-white !py-1.5 text-sm dark:!border-red-900/50 dark:!bg-[var(--input-bg)]"
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

function slugifyFilename(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function generateAmortizationCsv(
  schedule: ReturnType<typeof buildAmortizationSchedule>
): string {
  const rows = [
    "﻿", // UTF-8 BOM
  ];

  const headers = ["#", "Échéance", "Capital remboursé", "Intérêts", "Assurance", "Mensualité", "Capital restant"];
  rows.push(headers.join(";"));

  for (const row of schedule) {
    const csvRow = [
      row.index.toString(),
      row.dueDate ? formatDate(row.dueDate) : "",
      row.principalPaid.replace(".", ","),
      row.interest.replace(".", ","),
      row.insurance.replace(".", ","),
      row.payment.replace(".", ","),
      row.remainingAfter.replace(".", ","),
    ];
    rows.push(csvRow.join(";"));
  }

  return rows.join("\n");
}

function downloadCsv(
  schedule: ReturnType<typeof buildAmortizationSchedule>,
  liabilityName: string
): void {
  const slug = slugifyFilename(liabilityName);
  const today = new Date();
  const dateStr = today
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
  const filename = `amortissement-${slug}-${dateStr}.csv`;

  const csv = generateAmortizationCsv(schedule);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Panneau détail : amortissement prévisionnel + historique + réglages rapides. */
function LiabilityDetailPanel({
  liability: l,
  onEditRate,
  onEditRemaining,
  onEditPaymentDay,
  onEditBank,
  onEditCategory,
  onEditInsurance,
  onEditAsset,
  linkableAssets,
  onRepay,
}: {
  liability: LiabilityRow;
  onEditRate: (v: string) => void;
  onEditRemaining: (v: string) => void;
  onEditPaymentDay: (v: string) => void;
  onEditBank: (v: string) => void;
  onEditCategory: (v: string) => void;
  onEditInsurance: (v: string) => void;
  onEditAsset: (v: string) => void;
  linkableAssets: LinkableAsset[];
  onRepay: (amount?: string) => void;
}) {
  const [rateInvalid, setRateInvalid] = useState(false);
  const [remainingInvalid, setRemainingInvalid] = useState(false);
  const [insuranceInvalid, setInsuranceInvalid] = useState(false);
  const [dayInvalid, setDayInvalid] = useState(false);
  const [simAmount, setSimAmount] = useState("");

  const scheduleResult = useMemo(() => {
    if (!l.monthlyPayment || Number(l.monthlyPayment) <= 0) {
      return { rows: [] as ReturnType<typeof buildAmortizationSchedule>, error: false };
    }
    if (!l.initialAmount || Number(l.initialAmount) <= 0) {
      return { rows: [] as ReturnType<typeof buildAmortizationSchedule>, error: false };
    }
    try {
      const rows = buildAmortizationSchedule({
        principal: l.initialAmount,
        annualPercent: l.interestRate || "0",
        monthlyPayment: l.monthlyPayment,
        startDate: l.startDate ? new Date(l.startDate) : new Date(),
        paymentDay: l.paymentDay ?? 1,
        maxMonths: 480,
        insuranceMonthly: l.insuranceMonthly || "0",
      });
      return { rows, error: false };
    } catch {
      return { rows: [] as ReturnType<typeof buildAmortizationSchedule>, error: true };
    }
  }, [l]);
  const schedule = scheduleResult.rows;
  const scheduleError = scheduleResult.error;

  const currentIdx = useMemo(
    () => currentScheduleIndex(schedule, l.remainingAmount),
    [schedule, l.remainingAmount]
  );

  const insuranceMonthlyNum = l.insuranceMonthly ? Number(l.insuranceMonthly) : 0;
  // N = mois restants estimés (moteur d'amortissement) ; à défaut, échéances
  // encore à venir dans le tableau généré ici (schedule.length si l'index
  // courant est introuvable).
  const insuranceMonthsRemaining =
    l.monthsRemaining ??
    (currentIdx >= 0 ? schedule.length - currentIdx : schedule.length);
  const estimatedInsuranceRemaining =
    insuranceMonthlyNum > 0 && insuranceMonthsRemaining > 0
      ? insuranceMonthlyNum * insuranceMonthsRemaining
      : null;

  // LTV = capital restant dû / valeur du bien lié. Valeur = Asset.manualPrice
  // (source de vérité pour l'immobilier, voir app/lib/real-estate/valuation.ts) ;
  // pas de pondération par quote-part, comme remainingAmount lui-même.
  const linkedAssetValue = l.linkedAsset?.manualPrice
    ? Number(l.linkedAsset.manualPrice)
    : null;
  const ltvPct =
    linkedAssetValue != null &&
    linkedAssetValue > 0 &&
    Number(l.remainingAmount) > 0
      ? (Number(l.remainingAmount) / linkedAssetValue) * 100
      : null;
  const ltvTone =
    ltvPct == null
      ? null
      : ltvPct < 50
        ? "text-teal-600 dark:text-teal-400"
        : ltvPct <= 80
          ? "text-amber-600 dark:text-amber-400"
          : "text-red-600 dark:text-red-400";

  // Simulateur de remboursement anticipé — projection pure, aucune écriture.
  // Actif uniquement sur un crédit en cours (mensualité + capital restant > 0).
  const canSimulate =
    !!l.monthlyPayment &&
    Number(l.monthlyPayment) > 0 &&
    Number(l.remainingAmount) > 0;
  const simExtra = simAmount.trim().replace(",", ".");
  const simExtraNum = Number(simExtra);
  const simulation = useMemo(() => {
    if (!canSimulate) return null;
    if (simExtra === "" || !Number.isFinite(simExtraNum) || simExtraNum <= 0)
      return null;
    return simulateEarlyRepayment({
      remaining: l.remainingAmount,
      monthlyPayment: l.monthlyPayment || "0",
      annualPercent: l.interestRate || "0",
      extraAmount: simExtra,
    });
  }, [canSimulate, simExtra, simExtraNum, l.remainingAmount, l.monthlyPayment, l.interestRate]);

  // Afficher une fenêtre autour de l’échéance courante (perf grands tableaux)
  const windowRows = useMemo(() => {
    if (schedule.length <= 36) return schedule.map((r, i) => ({ r, i }));
    const start = Math.max(0, currentIdx - 6);
    const end = Math.min(schedule.length, start + 24);
    return schedule.slice(start, end).map((r, j) => ({ r, i: start + j }));
  }, [schedule, currentIdx]);

  return (
    <div className="space-y-4" data-testid={`liability-detail-${l.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--foreground)]">
          <CalendarClock className="h-3.5 w-3.5 shrink-0 text-teal-500" />
          <span className="truncate">
            {l.name} — amortissement prévisionnel
          </span>
        </div>
        <Button
          size="sm"
          className="text-[11px]"
          onClick={() => onRepay()}
          data-testid={`liability-detail-repay-${l.id}`}
        >
          <Banknote className="h-3.5 w-3.5" />
          Enregistrer un remboursement
        </Button>
      </div>

      {/* Réglages compacts */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-[11px]">
          <span className="text-[var(--muted-foreground)]">Taux annuel %</span>
          <input
            className={cn(
              "input mt-0.5 !py-1 text-right text-xs",
              rateInvalid && "ring-2 ring-red-500 !border-red-500"
            )}
            type="number"
            min={0}
            max={30}
            step={0.001}
            defaultValue={l.interestRate ?? ""}
            key={`${l.id}-rate-${l.interestRate}`}
            onFocus={() => setRateInvalid(false)}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") {
                setRateInvalid(false);
                if ((l.interestRate ?? "") !== "") onEditRate("");
                return;
              }
              const num = Number(raw.replace(",", "."));
              if (!Number.isFinite(num) || num < 0 || num > 30) {
                setRateInvalid(true);
                e.target.value = l.interestRate ?? "";
                return;
              }
              setRateInvalid(false);
              if (raw !== (l.interestRate ?? "")) onEditRate(raw);
            }}
          />
          {rateInvalid && (
            <span className="mt-0.5 block text-[10px] text-red-600">
              Taux invalide (0–30 %)
            </span>
          )}
        </label>
        <label className="text-[11px]">
          <span className="text-[var(--muted-foreground)]">
            Capital restant dû
          </span>
          <input
            className={cn(
              "input mt-0.5 !py-1 text-right text-xs font-semibold",
              remainingInvalid && "ring-2 ring-red-500 !border-red-500"
            )}
            inputMode="decimal"
            min={0}
            defaultValue={l.remainingAmount}
            key={`${l.id}-rem-${l.remainingAmount}`}
            onFocus={() => setRemainingInvalid(false)}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const num = Number(raw.replace(",", "."));
              if (!Number.isFinite(num) || num < 0) {
                setRemainingInvalid(true);
                e.target.value = l.remainingAmount;
                return;
              }
              setRemainingInvalid(false);
              if (raw !== l.remainingAmount) onEditRemaining(raw);
            }}
          />
          {remainingInvalid && (
            <span className="mt-0.5 block text-[10px] text-red-600">
              Montant invalide (≥ 0)
            </span>
          )}
        </label>
        <label className="text-[11px]">
          <span className="text-[var(--muted-foreground)]">
            Jour de prélèvement
          </span>
          <input
            className={cn(
              "input mt-0.5 !py-1 text-center text-xs",
              dayInvalid && "ring-2 ring-red-500 !border-red-500"
            )}
            type="number"
            min={1}
            max={31}
            step={1}
            defaultValue={l.paymentDay ?? ""}
            key={`${l.id}-day-${l.paymentDay}`}
            onFocus={() => setDayInvalid(false)}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") {
                setDayInvalid(false);
                if ((l.paymentDay ?? "") !== "") onEditPaymentDay("");
                return;
              }
              const num = Number(raw);
              if (!Number.isInteger(num) || num < 1 || num > 31) {
                setDayInvalid(true);
                e.target.value = l.paymentDay != null ? String(l.paymentDay) : "";
                return;
              }
              setDayInvalid(false);
              if (String(num) !== String(l.paymentDay ?? ""))
                onEditPaymentDay(String(num));
            }}
          />
          {dayInvalid && (
            <span className="mt-0.5 block text-[10px] text-red-600">
              Jour invalide (1–31)
            </span>
          )}
        </label>
        <label className="text-[11px]">
          <span className="text-[var(--muted-foreground)]">Prêteur</span>
          <input
            type="text"
            list="liability-lenders-datalist"
            className="input mt-0.5 !py-1 text-xs"
            defaultValue={l.bankName || ""}
            key={`${l.id}-bank-${l.bankName}`}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (raw !== (l.bankName || "")) onEditBank(raw);
            }}
          />
        </label>
        <label className="text-[11px]">
          <span className="text-[var(--muted-foreground)]">Catégorie</span>
          <select
            className="input mt-0.5 !py-1 text-xs"
            value={l.category}
            onChange={(e) => onEditCategory(e.target.value)}
            data-testid={`liability-category-select-${l.id}`}
          >
            {LIABILITY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {LIABILITY_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[11px]">
          <span className="text-[var(--muted-foreground)]">
            Assurance mensuelle
          </span>
          <input
            className={cn(
              "input mt-0.5 !py-1 text-right text-xs",
              insuranceInvalid && "ring-2 ring-red-500 !border-red-500"
            )}
            inputMode="decimal"
            min={0}
            defaultValue={l.insuranceMonthly ?? ""}
            key={`${l.id}-insurance-${l.insuranceMonthly}`}
            onFocus={() => setInsuranceInvalid(false)}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (raw === "") {
                setInsuranceInvalid(false);
                if ((l.insuranceMonthly ?? "") !== "") onEditInsurance("");
                return;
              }
              const num = Number(raw.replace(",", "."));
              if (!Number.isFinite(num) || num < 0) {
                setInsuranceInvalid(true);
                e.target.value = l.insuranceMonthly ?? "";
                return;
              }
              setInsuranceInvalid(false);
              if (raw !== (l.insuranceMonthly ?? "")) onEditInsurance(raw);
            }}
            data-testid={`liability-insurance-input-${l.id}`}
          />
          {insuranceInvalid && (
            <span className="mt-0.5 block text-[10px] text-red-600">
              Montant invalide (≥ 0)
            </span>
          )}
        </label>
        <label className="text-[11px]">
          <span className="text-[var(--muted-foreground)]">
            Bien immobilier lié (optionnel)
          </span>
          <select
            className="input mt-0.5 !py-1 text-xs"
            value={l.linkedAssetId ?? ""}
            onChange={(e) => onEditAsset(e.target.value)}
            data-testid={`liability-asset-select-${l.id}`}
          >
            <option value="">— Aucun —</option>
            {l.linkedAsset &&
              !linkableAssets.some((a) => a.id === l.linkedAsset!.id) && (
                <option value={l.linkedAsset.id}>{l.linkedAsset.name}</option>
              )}
            {linkableAssets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {l.linkedAssetId && (
        <p
          className="text-[11px] text-[var(--muted-foreground)]"
          data-testid={`liability-ltv-${l.id}`}
        >
          Bien lié : <strong className="text-[var(--foreground)]">
            {l.linkedAsset?.name ?? "—"}
          </strong>
          {" · "}
          {ltvPct != null ? (
            <span className={cn("font-semibold", ltvTone)}>
              LTV ≈ {ltvPct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %
            </span>
          ) : (
            <span>LTV indisponible — renseigner la valeur du bien</span>
          )}
        </p>
      )}

      {estimatedInsuranceRemaining != null && (
        <p
          className="text-[11px] text-[var(--muted-foreground)]"
          data-testid={`liability-insurance-remaining-${l.id}`}
        >
          Assurance cumulée estimée (durée résiduelle) ≈{" "}
          <strong className="text-[var(--foreground)]">
            {formatCurrency(String(estimatedInsuranceRemaining), l.currency)}
          </strong>{" "}
          ({insuranceMonthsRemaining} ×{" "}
          {formatCurrency(l.insuranceMonthly || "0", l.currency)})
        </p>
      )}

      {/* Simulateur de remboursement anticipé — projection pure, aucune écriture */}
      {canSimulate && (
        <div
          className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-3"
          data-testid={`liability-simulate-${l.id}`}
        >
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Simulateur — remboursement anticipé
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[11px]">
              <span className="text-[var(--muted-foreground)]">
                Montant anticipé
              </span>
              <input
                className="input mt-0.5 !py-1 text-right text-xs"
                inputMode="decimal"
                placeholder="0"
                value={simAmount}
                onChange={(e) => setSimAmount(e.target.value)}
                data-testid={`liability-simulate-input-${l.id}`}
              />
            </label>
            {simulation && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-[11px]"
                onClick={() => onRepay(simExtra)}
                data-testid={`liability-simulate-save-${l.id}`}
              >
                <Banknote className="h-3.5 w-3.5" />
                Enregistrer ce remboursement
              </Button>
            )}
          </div>

          {simulation ? (
            <div
              className="mt-2.5 grid gap-1.5 text-[11px] sm:grid-cols-2"
              data-testid={`liability-simulate-summary-${l.id}`}
            >
              <p>
                Capital restant après :{" "}
                <strong className="text-[var(--foreground)]">
                  {formatCurrency(simulation.newRemaining, l.currency)}
                </strong>
              </p>
              <p>
                Durée :{" "}
                <span className="tabular-nums">
                  {simulation.monthsBefore != null
                    ? `${simulation.monthsBefore} mois`
                    : "indéterminée"}
                  {" → "}
                  {simulation.isFullRepayment
                    ? "soldé"
                    : simulation.monthsAfter != null
                      ? `${simulation.monthsAfter} mois`
                      : "indéterminée"}
                </span>
              </p>
              <p>
                Intérêts restants :{" "}
                <span className="tabular-nums">
                  {formatCurrency(simulation.interestBefore, l.currency)}
                  {" → "}
                  {formatCurrency(simulation.interestAfter, l.currency)}
                </span>
              </p>
              <p className="font-semibold text-teal-600 dark:text-teal-400">
                Économie d&rsquo;intérêts estimée ≈{" "}
                {formatCurrency(simulation.interestSaved, l.currency)}
              </p>
              {simulation.isFullRepayment && (
                <p className="text-amber-600 dark:text-amber-400 sm:col-span-2">
                  Ce montant solde le crédit en totalité.
                </p>
              )}
            </div>
          ) : (
            simAmount.trim() !== "" && (
              <p className="mt-2 text-[11px] text-red-600">
                Montant invalide (&gt; 0)
              </p>
            )
          )}
        </div>
      )}

      {/* Tableau d’amortissement */}
      {scheduleError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          Impossible de construire le tableau d&rsquo;amortissement (vérifiez
          mensualité et taux).
        </div>
      )}
      {schedule.length === 0 ? (
        !scheduleError && (
          <p className="text-xs text-[var(--muted-foreground)]">
            Renseignez une mensualité et un capital pour générer le tableau
            d’amortissement.
          </p>
        )
      ) : (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Tableau d’amortissement
              {schedule.length > 36 && windowRows.length > 0
                ? ` · échéances ${windowRows[0].i + 1}–${windowRows[windowRows.length - 1].i + 1} / ${schedule.length}`
                : schedule.length > 0
                  ? ` · ${schedule.length} échéances`
                  : ""}
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="text-[11px]"
              onClick={() => downloadCsv(schedule, l.name)}
              data-testid="liability-export-schedule"
              title="Exporter le tableau d’amortissement en CSV"
            >
              <Download className="h-3.5 w-3.5" />
              Exporter CSV
            </Button>
          </div>
          <div className="max-h-72 overflow-auto rounded-lg border border-[var(--border)]">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-[var(--table-head)] text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                <tr>
                  <th className="px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">Échéance</th>
                  <th className="px-2 py-1.5 text-right">Capital remboursé</th>
                  <th className="px-2 py-1.5 text-right">Intérêts</th>
                  <th className="px-2 py-1.5 text-right">Assurance</th>
                  <th className="px-2 py-1.5 text-right">Capital restant</th>
                </tr>
              </thead>
              <tbody>
                {windowRows.map(({ r, i }) => {
                  const isCurrent = i === currentIdx;
                  return (
                    <tr
                      key={r.index}
                      className={cn(
                        "border-t border-[var(--border)]/70",
                        isCurrent &&
                          "bg-teal-500/15 font-medium ring-1 ring-inset ring-teal-500/30"
                      )}
                      data-current={isCurrent ? "true" : undefined}
                    >
                      <td className="px-2 py-1 tabular-nums text-[var(--muted-foreground)]">
                        {r.index}
                        {isCurrent ? (
                          <span className="ml-1 text-[9px] font-semibold uppercase text-teal-500">
                            actuel
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-1 tabular-nums">
                        {r.dueDate ? formatDate(r.dueDate) : "—"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {formatCurrency(r.principalPaid, l.currency)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-amber-600/90 dark:text-amber-300/90">
                        {formatCurrency(r.interest, l.currency)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums text-[var(--muted-foreground)]">
                        {formatCurrency(r.insurance, l.currency)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {formatCurrency(r.remainingAfter, l.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">
            Calculs en Decimal.js
            {insuranceMonthlyNum > 0
              ? ""
              : " · Assurance non renseignée — colonne à 0 €"}{" "}
            · échéance courante mise en évidence.
          </p>
        </div>
      )}

      {/* Historique événements */}
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Historique des événements
        </div>
        {l.events.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">
            Aucun événement — les prélèvements et remboursements apparaîtront
            ici.
          </p>
        ) : (
          <ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
            {l.events.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--border)]/60 py-1.5 last:border-0"
              >
                <span>
                  <span className="font-medium">
                    {EVENT_LABELS[e.type] || e.type}
                  </span>
                  {e.notes ? (
                    <span className="text-[var(--muted-foreground)]">
                      {" "}
                      · {e.notes}
                    </span>
                  ) : null}
                </span>
                <span className="tabular-nums text-[var(--muted-foreground)]">
                  {formatDate(e.eventDate)}
                  {e.amount
                    ? ` · ${formatCurrency(e.amount, l.currency)}`
                    : ""}
                  {e.remainingAfter != null
                    ? ` → restant ${formatCurrency(e.remainingAfter, l.currency)}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
