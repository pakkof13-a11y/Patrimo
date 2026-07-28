"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  HelpCircle,
  History,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BANK_OPTIONS } from "@/app/lib/constants";
import {
  ACCOUNT_CURRENCY_OPTIONS,
  currencyLabel,
} from "@/app/lib/money/currencies";
import { formatCurrency, cn } from "@/app/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal } from "@/components/ui/modal";
import { ModuleKpiStrip } from "@/components/ui/module-shell";
import { AltMiniKpi } from "@/components/tabs/alternatives-shell";
import { d } from "@/app/lib/money/decimal";
import {
  REGULATED_PRODUCT_INFO,
  REGULATED_PRODUCT_LABELS,
  CEILING_ALERT_THRESHOLD_PCT,
  ceilingProgressPct,
  isRateSuspicious,
  type RegulatedProductType,
} from "@/app/lib/cash/regulated-products";

/* ─── Shared atoms ─────────────────────────────────────────────────── */

/** Deux écritures décimales représentent-elles la même valeur ? "1000" ≡ "1000.00". */
function decimalEquals(a: string, b: string): boolean {
  try {
    return d(a).eq(d(b));
  } catch {
    return a === b;
  }
}

/**
 * Input contrôlé avec état local propre — remplace le pattern
 * `defaultValue` + `key` dépendante de la valeur serveur.
 *
 * Ce dernier remonte le champ dès que le serveur renvoie une valeur
 * différente en formatage (ex. "1000" → "1000.000000000000" une fois
 * persisté en Decimal) : si le refetch résout pendant que l'utilisateur
 * tape déjà le champ suivant, la saisie en cours est perdue. Ici, la `key`
 * du composant à l'usage doit rester l'identifiant stable de la ligne
 * (`a.id`), jamais une valeur qui change après sauvegarde — c'est ce qui
 * garantit qu'aucun remount ne survient après un `refresh()`.
 */
function EditableField({
  initialValue,
  onCommit,
  isEqual = (a, b) => a === b,
  className,
  testId,
  type,
  min,
  max,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  isEqual?: (a: string, b: string) => boolean;
  className?: string;
  testId?: string;
  type?: string;
  min?: number;
  max?: number;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <input
      type={type}
      min={min}
      max={max}
      className={className}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (!isEqual(value, initialValue)) onCommit(value);
      }}
      data-testid={testId}
    />
  );
}

function CurrencySelect({
  value,
  onChange,
  className,
  title,
}: {
  value: string;
  onChange: (code: string) => void;
  className?: string;
  title?: string;
}) {
  const codes = ACCOUNT_CURRENCY_OPTIONS as readonly string[];
  const options = codes.includes(value) ? codes : [value, ...codes];
  return (
    <select
      className={cn("input !py-1.5", className)}
      value={value}
      title={title}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((c) => (
        <option key={c} value={c}>
          {currencyLabel(c)}
        </option>
      ))}
    </select>
  );
}

/** Combobox banque — liste en portal (fixed) pour passer au-dessus des cartes sœurs. */
function BankNameCombobox({
  value,
  onChange,
  className,
  testId,
  placeholder = "Rechercher une banque…",
}: {
  value: string;
  onChange: (name: string) => void;
  className?: string;
  testId?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  const [menuBox, setMenuBox] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  // Sync query au prop value (adjust state while rendering)
  if (value !== prevValue) {
    setPrevValue(value);
    setQuery(value);
  }

  const updateMenuPosition = () => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setMenuBox({
      top: r.bottom + 4,
      left: r.left,
      width: Math.max(r.width, 220),
    });
  };

  useLayoutEffect(() => {
    // Pas de reset au close : le menu n'est rendu (JSX) que si `open` est vrai
    if (!open) return;
    updateMenuPosition();
    const onScrollOrResize = () => updateMenuPosition();
    window.addEventListener("resize", onScrollOrResize);
    // capture scroll on any ancestor
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = [...BANK_OPTIONS];
    if (!q) return list;
    return list.filter((b) => b.toLowerCase().includes(q));
  }, [query]);

  const listboxId = `${testId || "bank-combobox"}-listbox`;

  const menu =
    open &&
    menuBox &&
    typeof document !== "undefined" &&
    createPortal(
      <ul
        ref={menuRef}
        id={listboxId}
        role="listbox"
        data-testid={testId ? `${testId}-listbox` : "bank-combobox-listbox"}
        className="fixed z-[200] max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-xl"
        style={{
          top: menuBox.top,
          left: menuBox.left,
          width: menuBox.width,
        }}
      >
        {filtered.length === 0 ? (
          <li className="px-3 py-2 text-xs text-[var(--muted-foreground)]">
            Aucune banque — validez pour garder « {query.trim()} »
          </li>
        ) : (
          filtered.map((b) => (
            <li key={b}>
              <button
                type="button"
                role="option"
                aria-selected={b === value}
                className={cn(
                  "block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--muted)]",
                  b === value &&
                    "bg-teal-700/10 font-medium text-teal-900 dark:text-teal-100"
                )}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(b);
                  setQuery(b);
                  setOpen(false);
                }}
              >
                {b}
              </button>
            </li>
          ))
        )}
      </ul>,
      document.body
    );

  return (
    <div
      ref={rootRef}
      className={cn("relative min-w-0", open && "z-[60]", className)}
    >
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]"
          aria-hidden
        />
        <input
          ref={inputRef}
          role="combobox"
          className="input w-full !py-1.5 !pl-8 !pr-8 text-sm"
          value={query}
          data-testid={testId}
          placeholder={placeholder}
          aria-label="Banque"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onBlur={() => {
            if (query.trim() && query.trim() !== value) {
              onChange(query.trim());
            }
          }}
        />
        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]"
          aria-hidden
        />
      </div>
      {menu}
    </div>
  );
}

function NetWorthBadge({
  included,
  compact,
}: {
  included: boolean;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        included
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
      )}
      title={
        included
          ? "Solde > 0 : ce compte entre dans le patrimoine net"
          : "Solde à 0 : ignoré du patrimoine net (évite le bruit)"
      }
    >
      {included ? "Dans le patrimoine" : "Hors patrimoine (0)"}
      {!compact && (
        <HelpCircle className="h-2.5 w-2.5 opacity-60" aria-hidden />
      )}
    </span>
  );
}

/** Badge compact : compte professionnel et/ou joint, avec la part détenue. */
function OwnershipBadge({
  isPro,
  ownershipPct,
}: {
  isPro?: boolean;
  ownershipPct?: string | null;
}) {
  const isJoint = ownershipPct != null && ownershipPct !== "";
  if (!isPro && !isJoint) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {isPro && (
        <span
          className="rounded-full border border-amber-400/40 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
          title="Compte professionnel — exclu du patrimoine personnel"
        >
          Pro
        </span>
      )}
      {isJoint && (
        <span
          className="rounded-full border border-sky-400/40 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
          title={`Compte joint — part détenue ${ownershipPct} %`}
        >
          Joint · {ownershipPct}&nbsp;%
        </span>
      )}
    </span>
  );
}

/**
 * Barre de progression plafond légal — un livret réglementé (Livret A, LDDS,
 * LEP, PEL) ne peut pas être versé au-delà de son plafond. Le dépassement
 * reste affiché (intérêts capitalisés qui franchissent le plafond, cas réel),
 * mais la barre elle-même est bornée visuellement pour ne pas déborder.
 */
function CeilingProgressBar({
  balance,
  ceilingAmount,
  currency,
}: {
  balance: string;
  ceilingAmount: string | null | undefined;
  currency: string;
}) {
  const pct = ceilingProgressPct(balance, ceilingAmount);
  if (pct == null) return null;
  const alert = pct >= CEILING_ALERT_THRESHOLD_PCT;
  return (
    <div className="mt-1.5">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--muted)]">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            alert ? "bg-[var(--danger)]" : "bg-emerald-500"
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <p
        className={cn(
          "mt-0.5 text-[10px]",
          alert
            ? "font-medium text-[var(--danger)]"
            : "text-[var(--muted-foreground)]"
        )}
      >
        {pct.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}&nbsp;% du
        plafond ({formatCurrency(String(ceilingAmount), currency)})
        {alert && " — proche du plafond"}
      </p>
    </div>
  );
}

type AccountEvent = {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  occurredAt: string;
  notes: string | null;
};

const EVENT_LABELS: Record<string, string> = {
  OPENING: "Ouverture",
  DEPOSIT: "Dépôt",
  WITHDRAWAL: "Retrait",
  INTEREST: "Intérêts versés",
};

/**
 * Historique d'un compte — généré côté serveur à chaque changement de solde
 * (cf. `account-events.ts`), jamais saisi : ce que l'utilisateur voit ici est
 * garanti cohérent avec le solde actuel, contrairement à un journal éditable.
 */
function AccountHistoryModal({
  kind,
  accountId,
  accountLabel,
  currency,
  onClose,
}: {
  kind: "banks" | "savings";
  accountId: string;
  accountLabel: string;
  currency: string;
  onClose: () => void;
}) {
  const q = useQuery({
    queryKey: [kind, accountId, "events"],
    queryFn: () =>
      fetchJson<{ events: AccountEvent[] }>(`/api/${kind}/${accountId}/events`),
  });
  const events = q.data?.events ?? [];

  return (
    <Modal title={`Historique — ${accountLabel}`} onClose={onClose}>
      <div data-testid="account-history-modal">
        {q.isLoading ? (
          <p className="text-meta">Chargement…</p>
        ) : events.length === 0 ? (
          <p className="text-meta">Aucun mouvement enregistré.</p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="table-head text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-1.5 pr-2 text-left font-medium">Date</th>
                  <th className="py-1.5 pr-2 text-left font-medium">Nature</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Montant</th>
                  <th className="py-1.5 text-right font-medium">
                    Solde après
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr
                    key={e.id}
                    className="border-t border-[var(--border)]"
                    data-testid="account-history-row"
                  >
                    <td className="py-1.5 pr-2 tabular-nums">
                      {new Date(e.occurredAt).toLocaleString("fr-FR", {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </td>
                    <td className="py-1.5 pr-2">
                      {EVENT_LABELS[e.type] ?? e.type}
                      {e.notes && (
                        <span className="text-meta ml-1">· {e.notes}</span>
                      )}
                    </td>
                    <td
                      className={cn(
                        "py-1.5 pr-2 text-right tabular-nums font-medium",
                        Number(e.amount) < 0 && "text-[var(--danger)]"
                      )}
                    >
                      {Number(e.amount) > 0 ? "+" : ""}
                      {formatCurrency(e.amount, currency)}
                    </td>
                    <td className="py-1.5 text-right tabular-nums">
                      {formatCurrency(e.balanceAfter, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function FieldLabel({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <span className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--muted-foreground)]">
      {children}
      {hint && (
        <span title={hint} className="cursor-help text-slate-400">
          <HelpCircle className="h-3 w-3" />
        </span>
      )}
    </span>
  );
}

const DOW_LABELS = [
  "",
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];
const MONTH_LABELS = [
  "",
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

/* ─── Main tab ─────────────────────────────────────────────────────── */

export function BanksTab({ baseCurrency }: { baseCurrency: string }) {
  const qc = useQueryClient();
  const banksQ = useQuery({
    queryKey: ["banks"],
    queryFn: () =>
      fetchJson<{
        accounts: Array<{
          id: string;
          bankName: string;
          balance: string;
          currency: string;
          countsInNetWorth: boolean;
          isPro: boolean;
          ownershipPct: string | null;
        }>;
      }>("/api/banks"),
  });
  const savingsQ = useQuery({
    queryKey: ["savings"],
    queryFn: () =>
      fetchJson<{
        accounts: Array<{
          id: string;
          name: string;
          bankName: string | null;
          productType: string;
          ceilingAmount: string | null;
          balance: string;
          displayBalance: string;
          apyPercent: string;
          rateType: string;
          payoutFrequency: string;
          payoutDayOfWeek: number | null;
          payoutDayOfMonth: number | null;
          payoutMonth: number | null;
          payoutRuleLabel: string;
          dailyInterest: string;
          periodInterest: string;
          daysElapsed: number;
          currency: string;
          countsInNetWorth: boolean;
          lastPayoutAt: string | null;
          isPro: boolean;
          ownershipPct: string | null;
        }>;
      }>("/api/savings"),
    refetchInterval: 60_000,
  });
  const summaryQ = useQuery({
    queryKey: ["banks-summary"],
    queryFn: () =>
      fetchJson<{
        checkingTotalBase: string;
        savingsTotalBase: string;
        termDepositTotalBase: string;
        weightedApyPct: string | null;
        projectedAnnualInterestBase: string;
      }>("/api/banks/summary"),
  });
  const termDepositsQ = useQuery({
    queryKey: ["term-deposits"],
    queryFn: () =>
      fetchJson<{
        termDeposits: Array<{
          id: string;
          bankName: string | null;
          principal: string;
          principalBase: string;
          ratePercent: string;
          currency: string;
          openedAt: string;
          maturityDate: string;
          earlyWithdrawalPenaltyPct: string | null;
          isPro: boolean;
          ownershipPct: string | null;
          notes: string | null;
          status: "ACTIVE" | "MATURED";
          daysUntilMaturity: number;
        }>;
      }>("/api/term-deposits"),
  });

  type BankRow = NonNullable<typeof banksQ.data>["accounts"][number];
  type SavingsRow = NonNullable<typeof savingsQ.data>["accounts"][number];
  const [deleteBankTarget, setDeleteBankTarget] = useState<BankRow | null>(null);
  const [deleteSavingsTarget, setDeleteSavingsTarget] = useState<SavingsRow | null>(null);
  const [historyTarget, setHistoryTarget] = useState<{
    kind: "banks" | "savings";
    id: string;
    label: string;
    currency: string;
  } | null>(null);

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

  const [bankName, setBankName] = useState("Revolut");
  const [bankBalance, setBankBalance] = useState("0");
  const [bankCurrency, setBankCurrency] = useState("EUR");
  const [bankIsPro, setBankIsPro] = useState(false);
  const [bankOwnershipPct, setBankOwnershipPct] = useState("");

  const [livretName, setLivretName] = useState("Livret A");
  const [livretBankName, setLivretBankName] = useState("Revolut");
  const [livretProductType, setLivretProductType] =
    useState<RegulatedProductType>("LIVRET_A");
  const [livretCeiling, setLivretCeiling] = useState("");
  const [livretBalance, setLivretBalance] = useState("0");
  const [livretApy, setLivretApy] = useState("3");
  const [livretRateType, setLivretRateType] = useState<"APR" | "APY">("APY");
  const [livretFreq, setLivretFreq] = useState<
    "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY"
  >("DAILY");
  const [livretDow, setLivretDow] = useState(1);
  const [livretDom, setLivretDom] = useState(1);
  const [livretMonth, setLivretMonth] = useState(12);
  const [livretCurrency, setLivretCurrency] = useState("EUR");
  const [livretIsPro, setLivretIsPro] = useState(false);
  const [livretOwnershipPct, setLivretOwnershipPct] = useState("");
  const [livretAdvanced, setLivretAdvanced] = useState(false);
  const [expandedSavings, setExpandedSavings] = useState<Record<string, boolean>>(
    {}
  );

  const [catBankName, setCatBankName] = useState("");
  const [catPrincipal, setCatPrincipal] = useState("10000");
  const [catRate, setCatRate] = useState("3");
  const [catCurrency, setCatCurrency] = useState("EUR");
  const [catOpenedAt, setCatOpenedAt] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [catMaturityDate, setCatMaturityDate] = useState("");
  const [catPenalty, setCatPenalty] = useState("");
  type TermDepositRow = NonNullable<typeof termDepositsQ.data>["termDeposits"][number];
  const [deleteTermDepositTarget, setDeleteTermDepositTarget] =
    useState<TermDepositRow | null>(null);

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
    mutationFn: () =>
      fetchJson("/api/banks", {
        method: "POST",
        body: JSON.stringify({
          bankName,
          balance: bankBalance || "0",
          currency: bankCurrency || "EUR",
          isPro: bankIsPro,
          ownershipPct: bankOwnershipPct || null,
        }),
      }),
    onSuccess: async () => {
      toast.success("Compte courant ajouté");
      setBankBalance("0");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addSavings = useMutation({
    mutationFn: () =>
      fetchJson("/api/savings", {
        method: "POST",
        body: JSON.stringify({
          name: livretName,
          bankName: livretBankName.trim() || null,
          productType: livretProductType,
          ceilingAmount: livretCeiling || null,
          balance: livretBalance || "0",
          apyPercent: livretApy || "0",
          rateType: livretRateType,
          payoutFrequency: livretFreq,
          payoutDayOfWeek: livretFreq === "WEEKLY" ? livretDow : null,
          payoutDayOfMonth:
            livretFreq === "MONTHLY" || livretFreq === "YEARLY"
              ? livretDom
              : null,
          payoutMonth: livretFreq === "YEARLY" ? livretMonth : null,
          currency: livretCurrency || "EUR",
          isPro: livretIsPro,
          ownershipPct: livretOwnershipPct || null,
        }),
      }),
    onSuccess: async () => {
      toast.success("Livret ajouté");
      setLivretBalance("0");
      await refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addTermDeposit = useMutation({
    mutationFn: () =>
      fetchJson("/api/term-deposits", {
        method: "POST",
        body: JSON.stringify({
          bankName: catBankName.trim() || null,
          principal: catPrincipal || "0",
          ratePercent: catRate || "0",
          currency: catCurrency || "EUR",
          openedAt: catOpenedAt,
          maturityDate: catMaturityDate,
          earlyWithdrawalPenaltyPct: catPenalty || null,
        }),
      }),
    onSuccess: async () => {
      toast.success("Dépôt à terme ajouté");
      setCatMaturityDate("");
      await refresh();
    },
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

  const banks = banksQ.data?.accounts ?? [];
  const savings = savingsQ.data?.accounts ?? [];
  const termDeposits = termDepositsQ.data?.termDeposits ?? [];

  return (
    <div className="section-stack space-y-6" data-testid="banks-tab">
      <header className="module-page-header px-0.5">
        <h1 className="text-title">Banques</h1>
        <p className="module-intro text-meta">
          Comptes courants, livrets et dépôts à terme · conversion en{" "}
          {baseCurrency} pour le patrimoine agrégé uniquement
        </p>
      </header>

      {/* KPI de synthèse — recalculés à chaque appel depuis les mêmes
          listes que les sections ci-dessous, jamais un total stocké à part. */}
      <div className="card overflow-hidden" data-testid="banks-summary-strip">
        <ModuleKpiStrip>
          <AltMiniKpi
            label="Liquidités (comptes courants)"
            value={formatCurrency(
              summaryQ.data?.checkingTotalBase ?? "0",
              baseCurrency
            )}
          />
          <AltMiniKpi
            label="Épargne (livrets + courus)"
            value={formatCurrency(
              summaryQ.data?.savingsTotalBase ?? "0",
              baseCurrency
            )}
          />
          <AltMiniKpi
            label="Rendement moyen pondéré"
            value={
              summaryQ.data?.weightedApyPct
                ? `${Number(summaryQ.data.weightedApyPct).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`
                : "—"
            }
            hint="Livrets uniquement, pondéré par le solde"
          />
          <AltMiniKpi
            label="Projection annuelle d'intérêts"
            value={formatCurrency(
              summaryQ.data?.projectedAnnualInterestBase ?? "0",
              baseCurrency
            )}
            hint="Estimation — ignore la capitalisation réelle"
          />
        </ModuleKpiStrip>
      </div>

      {/* ═══════════════ Comptes courants ═══════════════ */}
      <section className="space-y-3" data-testid="banks-checking-section">
        <div className="flex flex-wrap items-end justify-between gap-2 px-0.5">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">
              Comptes courants
            </h2>
            <p className="text-meta">
              Liquidités à vue · inclus dans le patrimoine si solde &gt; 0
            </p>
          </div>
        </div>

        {/* Carte d’ajout rapide — séparée de la liste */}
        <div className="card p-3.5 sm:p-4" data-testid="banks-checking-add">
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Ajouter un compte
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="min-w-0 flex-1 sm:min-w-[12rem] sm:max-w-xs">
              <FieldLabel>Banque</FieldLabel>
              <BankNameCombobox
                value={bankName}
                onChange={setBankName}
                testId="banks-add-bank-name"
              />
            </label>
            <label className="w-full sm:w-32">
              <FieldLabel hint="Montant dans la devise du compte (pas de conversion auto)">
                Solde
              </FieldLabel>
              <input
                className="input w-full !py-1.5 tabular-nums"
                value={bankBalance}
                onChange={(e) => setBankBalance(e.target.value)}
                inputMode="decimal"
                data-testid="banks-add-balance"
              />
            </label>
            <label className="w-full sm:w-32">
              <FieldLabel hint="Devise nominale du compte — le solde n’est pas converti">
                Devise
              </FieldLabel>
              <CurrencySelect
                value={bankCurrency}
                onChange={setBankCurrency}
                className="w-full"
                title="Devise du compte courant"
              />
            </label>
            <label className="w-full sm:w-28">
              <FieldLabel hint="Part détenue si compte joint — vide = compte individuel">
                Part (joint)
              </FieldLabel>
              <input
                className="input w-full !py-1.5 tabular-nums"
                placeholder="100 %"
                value={bankOwnershipPct}
                onChange={(e) => setBankOwnershipPct(e.target.value)}
                inputMode="decimal"
                data-testid="banks-add-ownership"
              />
            </label>
            <label className="flex items-center gap-1.5 pb-2 text-[11px] font-medium text-[var(--muted-foreground)]">
              <input
                type="checkbox"
                checked={bankIsPro}
                onChange={(e) => setBankIsPro(e.target.checked)}
                data-testid="banks-add-ispro"
              />
              Compte pro
            </label>
            <Button
              size="sm"
              className="h-9 shrink-0"
              onClick={() => addBank.mutate()}
              disabled={addBank.isPending}
              data-testid="banks-add-submit"
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter
            </Button>
          </div>
        </div>

        {/* Liste existante */}
        <div className="card overflow-hidden" data-testid="banks-checking-list">
          <div className="border-b border-[var(--border)] px-4 py-2.5">
            <p className="text-[11px] font-medium text-[var(--muted-foreground)]">
              Comptes enregistrés
              {!banksQ.isLoading && (
                <span className="ml-1.5 tabular-nums">
                  · {banks.length}
                </span>
              )}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="table-head text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Banque</th>
                  <th className="px-4 py-2.5 text-right font-medium">Solde</th>
                  <th className="px-4 py-2.5 text-left font-medium">Devise</th>
                  <th className="px-4 py-2.5 text-center font-medium">
                    Patrimoine
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {banks.map((a) => (
                  <tr
                    key={a.id}
                    className="border-t border-[var(--border)] hover:bg-[var(--muted)]/20"
                  >
                    <td className="px-4 py-2.5">
                      <BankNameCombobox
                        value={a.bankName}
                        onChange={(bankName) =>
                          patchBank.mutate({ id: a.id, bankName })
                        }
                        className="min-w-[10rem]"
                      />
                      <div className="mt-1">
                        <OwnershipBadge
                          isPro={a.isPro}
                          ownershipPct={a.ownershipPct}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <EditableField
                        key={a.id}
                        initialValue={a.balance}
                        isEqual={decimalEquals}
                        className="input ml-auto !w-32 !py-1.5 text-right tabular-nums"
                        testId={`banks-balance-${a.id}`}
                        onCommit={(balance) =>
                          patchBank.mutate({ id: a.id, balance })
                        }
                      />
                    </td>
                    <td className="px-4 py-2.5">
                      <CurrencySelect
                        value={a.currency || "EUR"}
                        className="!w-28"
                        title="Devise de ce compte (solde non converti)"
                        onChange={(currency) => {
                          if (currency !== a.currency) {
                            patchBank.mutate({ id: a.id, currency });
                          }
                        }}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <NetWorthBadge included={a.countsInNetWorth} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-[11px]"
                          title="Historique des mouvements"
                          data-testid={`banks-history-${a.id}`}
                          onClick={() =>
                            setHistoryTarget({
                              kind: "banks",
                              id: a.id,
                              label: a.bankName,
                              currency: a.currency,
                            })
                          }
                        >
                          <History className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="Supprimer"
                          aria-label="Supprimer le compte"
                          data-testid={`banks-delete-${a.id}`}
                          onClick={() => setDeleteBankTarget(a)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {banks.length === 0 && !banksQ.isLoading && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]"
                    >
                      Aucun compte courant — utilisez le formulaire ci-dessus
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ═══════════════ Livrets ═══════════════ */}
      <section className="space-y-3" data-testid="banks-savings-section">
        <div className="flex flex-wrap items-end justify-between gap-2 px-0.5">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">
              Livrets d&apos;épargne
            </h2>
            <p className="text-meta">
              Intérêts capitalisés selon la périodicité choisie
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={() => accrueMut.mutate()}
            disabled={accrueMut.isPending || savings.length === 0}
            title="Crédite au solde les périodes d’intérêts déjà échues (selon chaque règle de livret)"
            data-testid="banks-accrue-interests"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5",
                accrueMut.isPending && "animate-spin"
              )}
            />
            Actualiser les intérêts
          </Button>
        </div>

        {/* Ajout livret — essentiel + avancé repliable */}
        <div className="card p-3.5 sm:p-4" data-testid="banks-savings-add">
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Ajouter un livret
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="w-full sm:min-w-[9rem] sm:flex-1 sm:max-w-[12rem]">
              <FieldLabel>Nom</FieldLabel>
              <input
                className="input w-full !py-1.5"
                value={livretName}
                onChange={(e) => setLivretName(e.target.value)}
                data-testid="banks-savings-add-name"
              />
            </label>
            <label className="w-full sm:w-36">
              <FieldLabel hint="Détermine le plafond légal suggéré ci-contre">
                Type de produit
              </FieldLabel>
              <select
                className="input w-full !py-1.5"
                value={livretProductType}
                data-testid="banks-savings-add-producttype"
                onChange={(e) => {
                  const pt = e.target.value as RegulatedProductType;
                  setLivretProductType(pt);
                  setLivretCeiling(REGULATED_PRODUCT_INFO[pt]?.ceilingAmount ?? "");
                }}
              >
                {(
                  Object.keys(REGULATED_PRODUCT_LABELS) as RegulatedProductType[]
                ).map((k) => (
                  <option key={k} value={k}>
                    {REGULATED_PRODUCT_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0 flex-1 sm:min-w-[12rem] sm:max-w-xs">
              <FieldLabel hint="Banque de détention — rattache le solde à la plateforme du même nom">
                Banque
              </FieldLabel>
              <BankNameCombobox
                value={livretBankName}
                onChange={setLivretBankName}
                testId="banks-savings-add-bank"
              />
            </label>
            <label className="w-full sm:w-28">
              <FieldLabel>Solde</FieldLabel>
              <input
                className="input w-full !py-1.5 tabular-nums"
                value={livretBalance}
                onChange={(e) => setLivretBalance(e.target.value)}
                inputMode="decimal"
                data-testid="banks-savings-add-balance"
              />
            </label>
            <label className="w-full sm:w-24">
              <FieldLabel
                hint="APY = rendement annualisé effectif · APR = taux nominal annualisé"
              >
                Taux %
              </FieldLabel>
              <input
                className="input w-full !py-1.5 tabular-nums"
                value={livretApy}
                onChange={(e) => setLivretApy(e.target.value)}
                inputMode="decimal"
                data-testid="banks-savings-add-apy"
              />
            </label>
            <label className="w-full sm:w-28">
              <FieldLabel hint="Vide = pas de plafond suivi">Plafond (€)</FieldLabel>
              <input
                className="input w-full !py-1.5 tabular-nums"
                value={livretCeiling}
                onChange={(e) => setLivretCeiling(e.target.value)}
                inputMode="decimal"
                data-testid="banks-savings-add-ceiling"
              />
            </label>
            <label className="w-full sm:w-28">
              <FieldLabel hint="Devise nominale du livret">Devise</FieldLabel>
              <CurrencySelect
                value={livretCurrency}
                onChange={setLivretCurrency}
                className="w-full"
              />
            </label>
            <label className="w-full sm:w-28">
              <FieldLabel hint="Part détenue si livret joint — vide = individuel">
                Part (joint)
              </FieldLabel>
              <input
                className="input w-full !py-1.5 tabular-nums"
                placeholder="100 %"
                value={livretOwnershipPct}
                onChange={(e) => setLivretOwnershipPct(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <label className="flex items-center gap-1.5 pb-2 text-[11px] font-medium text-[var(--muted-foreground)]">
              <input
                type="checkbox"
                checked={livretIsPro}
                onChange={(e) => setLivretIsPro(e.target.checked)}
              />
              Livret pro
            </label>
            <Button
              size="sm"
              className="h-9 shrink-0"
              onClick={() => addSavings.mutate()}
              disabled={addSavings.isPending}
              data-testid="banks-savings-add-submit"
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter
            </Button>
          </div>
          {isRateSuspicious(livretProductType, livretApy) && (
            <p
              className="mt-2 text-[11px] font-medium text-[var(--warning)]"
              data-testid="banks-savings-rate-warning"
            >
              Taux inhabituel pour un {REGULATED_PRODUCT_LABELS[livretProductType]}{" "}
              (réf. {REGULATED_PRODUCT_INFO[livretProductType]?.referenceRatePct}
              %). Vérifiez la saisie.
            </p>
          )}

          <button
            type="button"
            className={cn(
              "mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--muted-foreground)] transition hover:text-[var(--foreground)]"
            )}
            aria-expanded={livretAdvanced}
            onClick={() => setLivretAdvanced((v) => !v)}
            data-testid="banks-savings-advanced-toggle"
          >
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform",
                livretAdvanced && "rotate-180"
              )}
            />
            Réglages du taux et des versements
          </button>

          {livretAdvanced && (
            <div
              className="mt-2.5 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] bg-[var(--muted)]/20 p-3"
              data-testid="banks-savings-advanced"
            >
              <label className="w-full sm:w-24">
                <FieldLabel hint="APY : taux effectif · APR : taux nominal divisé par le nombre de périodes">
                  Type
                </FieldLabel>
                <select
                  className="input w-full !py-1.5"
                  value={livretRateType}
                  onChange={(e) =>
                    setLivretRateType(e.target.value as "APR" | "APY")
                  }
                >
                  <option value="APY">APY</option>
                  <option value="APR">APR</option>
                </select>
              </label>
              <label className="w-full sm:w-36">
                <FieldLabel>Périodicité</FieldLabel>
                <select
                  className="input w-full !py-1.5"
                  value={livretFreq}
                  onChange={(e) =>
                    setLivretFreq(
                      e.target.value as
                        | "DAILY"
                        | "WEEKLY"
                        | "MONTHLY"
                        | "YEARLY"
                    )
                  }
                >
                  <option value="DAILY">Journalier</option>
                  <option value="WEEKLY">Hebdomadaire</option>
                  <option value="MONTHLY">Mensuel</option>
                  <option value="YEARLY">Annuel</option>
                </select>
              </label>
              {livretFreq === "WEEKLY" && (
                <label className="w-full sm:w-32">
                  <FieldLabel>Jour</FieldLabel>
                  <select
                    className="input w-full !py-1.5"
                    value={livretDow}
                    onChange={(e) => setLivretDow(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                      <option key={d} value={d}>
                        {DOW_LABELS[d]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(livretFreq === "MONTHLY" || livretFreq === "YEARLY") && (
                <label className="w-full sm:w-28">
                  <FieldLabel>Jour du mois</FieldLabel>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    className="input w-full !py-1.5"
                    value={livretDom}
                    onChange={(e) => setLivretDom(Number(e.target.value))}
                  />
                </label>
              )}
              {livretFreq === "YEARLY" && (
                <label className="w-full sm:w-32">
                  <FieldLabel>Mois</FieldLabel>
                  <select
                    className="input w-full !py-1.5"
                    value={livretMonth}
                    onChange={(e) => setLivretMonth(Number(e.target.value))}
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => (
                      <option key={m} value={m}>
                        {MONTH_LABELS[m]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <p className="w-full text-[10px] leading-relaxed text-[var(--muted-foreground)]">
                Les intérêts courus s&apos;affichent en temps réel ; le bouton
                « Actualiser les intérêts » crédite au solde les périodes déjà
                échues selon la règle de chaque livret.
              </p>
            </div>
          )}
        </div>

        {/* Liste livrets — lignes compactes + réglages au clic */}
        <div className="card overflow-hidden" data-testid="banks-savings-list">
          <div className="border-b border-[var(--border)] px-4 py-2.5">
            <p className="text-[11px] font-medium text-[var(--muted-foreground)]">
              Livrets enregistrés
              {!savingsQ.isLoading && (
                <span className="ml-1.5 tabular-nums">· {savings.length}</span>
              )}
            </p>
          </div>

          {savings.length === 0 && !savingsQ.isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
              Aucun livret — ajoutez-en un ci-dessus
            </p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {savings.map((a) => {
                const open = Boolean(expandedSavings[a.id]);
                return (
                  <li key={a.id} className="px-3 py-3 sm:px-4">
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <EditableField
                            key={a.id}
                            initialValue={a.name}
                            className="input !w-auto min-w-[8rem] max-w-[14rem] !py-1 font-medium"
                            testId={`savings-name-${a.id}`}
                            onCommit={(name) =>
                              patchSavings.mutate({ id: a.id, name })
                            }
                          />
                          <NetWorthBadge
                            included={a.countsInNetWorth}
                            compact
                          />
                          <OwnershipBadge
                            isPro={a.isPro}
                            ownershipPct={a.ownershipPct}
                          />
                        </div>
                        <div className="mt-1.5 max-w-xs">
                          <FieldLabel hint="Banque de détention">
                            Banque
                          </FieldLabel>
                          <BankNameCombobox
                            value={a.bankName || ""}
                            onChange={(bankName) =>
                              patchSavings.mutate({ id: a.id, bankName })
                            }
                            placeholder="Banque de détention…"
                          />
                        </div>
                        <p className="text-meta mt-1">
                          {REGULATED_PRODUCT_LABELS[a.productType as RegulatedProductType] ?? a.productType}
                          {" · "}
                          {a.rateType || "APY"} {a.apyPercent}&nbsp;% ·{" "}
                          {a.payoutRuleLabel}
                        </p>
                        {isRateSuspicious(a.productType, a.apyPercent) && (
                          <p className="mt-0.5 text-[10px] font-medium text-[var(--warning)]">
                            Taux inhabituel pour ce produit
                          </p>
                        )}
                        {a.ceilingAmount && (
                          <div className="max-w-xs">
                            <CeilingProgressBar
                              balance={a.balance}
                              ceilingAmount={a.ceilingAmount}
                              currency={a.currency}
                            />
                          </div>
                        )}
                      </div>

                      <div className="text-right">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                          Solde affiché
                        </p>
                        <p className="text-base font-semibold tabular-nums text-[var(--foreground)]">
                          {formatCurrency(a.displayBalance, a.currency)}
                        </p>
                        <p className="text-[10px] text-[var(--muted-foreground)]">
                          Crédité{" "}
                          {formatCurrency(a.balance, a.currency)}
                          {a.daysElapsed > 0 && (
                            <> · {a.daysElapsed}&nbsp;j courus</>
                          )}
                        </p>
                        <p className="mt-0.5 text-[11px] font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                          +
                          {formatCurrency(
                            a.periodInterest || a.dailyInterest,
                            a.currency
                          )}
                          <span className="font-normal text-[var(--muted-foreground)]">
                            {" "}
                            / période
                          </span>
                        </p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-[11px]"
                          aria-expanded={open}
                          onClick={() =>
                            setExpandedSavings((prev) => ({
                              ...prev,
                              [a.id]: !prev[a.id],
                            }))
                          }
                        >
                          Régler
                          <ChevronDown
                            className={cn(
                              "ml-0.5 h-3.5 w-3.5 transition-transform",
                              open && "rotate-180"
                            )}
                          />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 px-2 text-[11px]"
                          title="Historique des mouvements"
                          data-testid={`savings-history-${a.id}`}
                          onClick={() =>
                            setHistoryTarget({
                              kind: "savings",
                              id: a.id,
                              label: a.name,
                              currency: a.currency,
                            })
                          }
                        >
                          <History className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="Supprimer"
                          aria-label="Supprimer le livret"
                          data-testid={`savings-delete-${a.id}`}
                          onClick={() => setDeleteSavingsTarget(a)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    </div>

                    {open && (
                      <div className="mt-3 grid gap-2 rounded-lg border border-[var(--border)] bg-[var(--muted)]/15 p-3 sm:grid-cols-2 lg:grid-cols-4">
                        <label className="text-[11px] text-[var(--muted-foreground)]">
                          Solde crédité
                          <EditableField
                            key={a.id}
                            initialValue={a.balance}
                            isEqual={decimalEquals}
                            className="input mt-1 w-full !py-1.5 text-right tabular-nums"
                            testId={`savings-balance-${a.id}`}
                            onCommit={(balance) =>
                              patchSavings.mutate({ id: a.id, balance })
                            }
                          />
                        </label>
                        <label className="text-[11px] text-[var(--muted-foreground)]">
                          Devise
                          <div className="mt-1">
                            <CurrencySelect
                              value={a.currency || "EUR"}
                              className="w-full"
                              onChange={(currency) => {
                                if (currency !== a.currency) {
                                  patchSavings.mutate({ id: a.id, currency });
                                }
                              }}
                            />
                          </div>
                        </label>
                        <label className="text-[11px] text-[var(--muted-foreground)]">
                          Type de produit
                          <select
                            className="input mt-1 w-full !py-1.5"
                            value={a.productType}
                            data-testid={`savings-producttype-${a.id}`}
                            onChange={(e) =>
                              patchSavings.mutate({
                                id: a.id,
                                productType: e.target.value,
                              })
                            }
                          >
                            {(
                              Object.keys(
                                REGULATED_PRODUCT_LABELS
                              ) as RegulatedProductType[]
                            ).map((k) => (
                              <option key={k} value={k}>
                                {REGULATED_PRODUCT_LABELS[k]}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[11px] text-[var(--muted-foreground)]">
                          Plafond (€)
                          <EditableField
                            key={a.id}
                            initialValue={a.ceilingAmount ?? ""}
                            isEqual={decimalEquals}
                            className="input mt-1 w-full !py-1.5 text-right tabular-nums"
                            testId={`savings-ceiling-${a.id}`}
                            onCommit={(ceilingAmount) =>
                              patchSavings.mutate({ id: a.id, ceilingAmount })
                            }
                          />
                        </label>
                        <label className="text-[11px] text-[var(--muted-foreground)]">
                          Part (joint, %)
                          <EditableField
                            key={a.id}
                            initialValue={a.ownershipPct ?? ""}
                            isEqual={decimalEquals}
                            className="input mt-1 w-full !py-1.5 text-right tabular-nums"
                            testId={`savings-ownership-${a.id}`}
                            onCommit={(ownershipPct) =>
                              patchSavings.mutate({ id: a.id, ownershipPct })
                            }
                          />
                        </label>
                        <label className="flex items-center gap-1.5 pt-4 text-[11px] text-[var(--muted-foreground)]">
                          <input
                            type="checkbox"
                            checked={a.isPro}
                            data-testid={`savings-ispro-${a.id}`}
                            onChange={(e) =>
                              patchSavings.mutate({
                                id: a.id,
                                isPro: e.target.checked,
                              })
                            }
                          />
                          Livret pro
                        </label>
                        <label className="text-[11px] text-[var(--muted-foreground)]">
                          Type de taux
                          <select
                            className="input mt-1 w-full !py-1.5"
                            value={a.rateType || "APY"}
                            onChange={(e) =>
                              patchSavings.mutate({
                                id: a.id,
                                rateType: e.target.value,
                              })
                            }
                          >
                            <option value="APY">APY</option>
                            <option value="APR">APR</option>
                          </select>
                        </label>
                        <label className="text-[11px] text-[var(--muted-foreground)]">
                          Taux %
                          <EditableField
                            key={a.id}
                            initialValue={a.apyPercent}
                            isEqual={decimalEquals}
                            className="input mt-1 w-full !py-1.5 text-right tabular-nums"
                            testId={`savings-apy-${a.id}`}
                            onCommit={(apyPercent) =>
                              patchSavings.mutate({ id: a.id, apyPercent })
                            }
                          />
                        </label>
                        <label className="text-[11px] text-[var(--muted-foreground)] sm:col-span-2">
                          Périodicité
                          <select
                            className="input mt-1 w-full !py-1.5"
                            value={a.payoutFrequency || "DAILY"}
                            onChange={(e) =>
                              patchSavings.mutate({
                                id: a.id,
                                payoutFrequency: e.target.value,
                              })
                            }
                          >
                            <option value="DAILY">Journalier</option>
                            <option value="WEEKLY">Hebdomadaire</option>
                            <option value="MONTHLY">Mensuel</option>
                            <option value="YEARLY">Annuel</option>
                          </select>
                        </label>
                        {a.payoutFrequency === "WEEKLY" && (
                          <label className="text-[11px] text-[var(--muted-foreground)]">
                            Jour
                            <select
                              className="input mt-1 w-full !py-1.5"
                              value={a.payoutDayOfWeek ?? 1}
                              onChange={(e) =>
                                patchSavings.mutate({
                                  id: a.id,
                                  payoutDayOfWeek: e.target.value,
                                })
                              }
                            >
                              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                                <option key={d} value={d}>
                                  {DOW_LABELS[d]}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {(a.payoutFrequency === "MONTHLY" ||
                          a.payoutFrequency === "YEARLY") && (
                          <label className="text-[11px] text-[var(--muted-foreground)]">
                            Jour du mois
                            <EditableField
                              key={a.id}
                              type="number"
                              min={1}
                              max={31}
                              initialValue={String(a.payoutDayOfMonth ?? 1)}
                              className="input mt-1 w-full !py-1.5"
                              testId={`savings-dom-${a.id}`}
                              onCommit={(payoutDayOfMonth) =>
                                patchSavings.mutate({
                                  id: a.id,
                                  payoutDayOfMonth,
                                })
                              }
                            />
                          </label>
                        )}
                        {a.payoutFrequency === "YEARLY" && (
                          <label className="text-[11px] text-[var(--muted-foreground)]">
                            Mois
                            <select
                              className="input mt-1 w-full !py-1.5"
                              value={a.payoutMonth ?? 12}
                              onChange={(e) =>
                                patchSavings.mutate({
                                  id: a.id,
                                  payoutMonth: e.target.value,
                                })
                              }
                            >
                              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(
                                (m) => (
                                  <option key={m} value={m}>
                                    {MONTH_LABELS[m]}
                                  </option>
                                )
                              )}
                            </select>
                          </label>
                        )}
                        {a.lastPayoutAt && (
                          <p className="text-meta sm:col-span-2">
                            Dernier versement :{" "}
                            {new Date(a.lastPayoutAt).toLocaleDateString(
                              "fr-FR"
                            )}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <p className="border-t border-[var(--border)] px-4 py-2.5 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            Solde affiché = solde crédité + intérêts courus non encore versés.
            La conversion en {baseCurrency} sert uniquement au patrimoine
            agrégé. « Actualiser les intérêts » capitalise les périodes dues.
          </p>
        </div>
      </section>

      {/* ═══════════════ Dépôts à terme (CAT) ═══════════════ */}
      <section className="space-y-3" data-testid="banks-cat-section">
        <div className="flex flex-wrap items-end justify-between gap-2 px-0.5">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-[var(--foreground)]">
              Dépôts à terme
            </h2>
            <p className="text-meta">
              Durée fixe, taux figé à l’ouverture · pénalité en cas de retrait
              anticipé
            </p>
          </div>
        </div>

        <div className="card p-3.5 sm:p-4" data-testid="banks-cat-add">
          <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Ajouter un dépôt à terme
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="min-w-0 flex-1 sm:min-w-[12rem] sm:max-w-xs">
              <FieldLabel>Banque</FieldLabel>
              <BankNameCombobox
                value={catBankName}
                onChange={setCatBankName}
                testId="banks-cat-add-bank"
              />
            </label>
            <label className="w-full sm:w-32">
              <FieldLabel>Principal</FieldLabel>
              <input
                className="input w-full !py-1.5 tabular-nums"
                value={catPrincipal}
                onChange={(e) => setCatPrincipal(e.target.value)}
                inputMode="decimal"
                data-testid="banks-cat-add-principal"
              />
            </label>
            <label className="w-full sm:w-24">
              <FieldLabel hint="Taux fixé à l'ouverture, ne varie pas sur la durée">
                Taux %
              </FieldLabel>
              <input
                className="input w-full !py-1.5 tabular-nums"
                value={catRate}
                onChange={(e) => setCatRate(e.target.value)}
                inputMode="decimal"
                data-testid="banks-cat-add-rate"
              />
            </label>
            <label className="w-full sm:w-28">
              <FieldLabel>Devise</FieldLabel>
              <CurrencySelect
                value={catCurrency}
                onChange={setCatCurrency}
                className="w-full"
              />
            </label>
            <label className="w-full sm:w-40">
              <FieldLabel>Date d&apos;ouverture</FieldLabel>
              <input
                type="date"
                className="input w-full !py-1.5"
                value={catOpenedAt}
                onChange={(e) => setCatOpenedAt(e.target.value)}
                data-testid="banks-cat-add-opened"
              />
            </label>
            <label className="w-full sm:w-40">
              <FieldLabel>Date d&apos;échéance</FieldLabel>
              <input
                type="date"
                className="input w-full !py-1.5"
                value={catMaturityDate}
                onChange={(e) => setCatMaturityDate(e.target.value)}
                data-testid="banks-cat-add-maturity"
              />
            </label>
            <label className="w-full sm:w-32">
              <FieldLabel hint="% du taux perdu en cas de retrait avant échéance">
                Pénalité %
              </FieldLabel>
              <input
                className="input w-full !py-1.5 tabular-nums"
                value={catPenalty}
                onChange={(e) => setCatPenalty(e.target.value)}
                inputMode="decimal"
              />
            </label>
            <Button
              size="sm"
              className="h-9 shrink-0"
              onClick={() => addTermDeposit.mutate()}
              disabled={addTermDeposit.isPending || !catMaturityDate}
              data-testid="banks-cat-add-submit"
            >
              <Plus className="h-3.5 w-3.5" />
              Ajouter
            </Button>
          </div>
        </div>

        <div className="card overflow-hidden" data-testid="banks-cat-list">
          <div className="border-b border-[var(--border)] px-4 py-2.5">
            <p className="text-[11px] font-medium text-[var(--muted-foreground)]">
              Dépôts enregistrés
              {!termDepositsQ.isLoading && (
                <span className="ml-1.5 tabular-nums">
                  · {termDeposits.length}
                </span>
              )}
            </p>
          </div>
          {termDeposits.length === 0 && !termDepositsQ.isLoading ? (
            <p className="px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
              Aucun dépôt à terme — ajoutez-en un ci-dessus
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-sm">
                <thead className="table-head text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium">Banque</th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      Principal
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">Taux</th>
                    <th className="px-4 py-2.5 text-left font-medium">
                      Échéance
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {termDeposits.map((t) => (
                    <tr
                      key={t.id}
                      className="border-t border-[var(--border)] hover:bg-[var(--muted)]/20"
                      data-testid="banks-cat-row"
                    >
                      <td className="px-4 py-2.5">
                        {t.bankName || "—"}
                        <div className="mt-1">
                          <OwnershipBadge
                            isPro={t.isPro}
                            ownershipPct={t.ownershipPct}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {formatCurrency(t.principal, t.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {Number(t.ratePercent).toLocaleString("fr-FR", {
                          maximumFractionDigits: 2,
                        })}
                        &nbsp;%
                      </td>
                      <td className="px-4 py-2.5">
                        {new Date(t.maturityDate).toLocaleDateString("fr-FR")}
                        <span
                          className={cn(
                            "ml-1.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                            t.status === "MATURED"
                              ? "border-emerald-400/40 text-emerald-700 dark:text-emerald-300"
                              : "border-[var(--border)] text-[var(--muted-foreground)]"
                          )}
                        >
                          {t.status === "MATURED"
                            ? "Échu"
                            : `J-${t.daysUntilMaturity}`}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          title="Supprimer"
                          aria-label="Supprimer le dépôt à terme"
                          data-testid={`banks-cat-delete-${t.id}`}
                          onClick={() => setDeleteTermDepositTarget(t)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-[var(--border)] px-4 py-2.5 text-[11px] leading-relaxed text-[var(--muted-foreground)]">
            Pas de solde qui évolue au jour le jour entre l’ouverture et
            l’échéance — pas d’historique de mouvements pour un CAT.
          </p>
        </div>
      </section>

      {historyTarget && (
        <AccountHistoryModal
          kind={historyTarget.kind}
          accountId={historyTarget.id}
          accountLabel={historyTarget.label}
          currency={historyTarget.currency}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      <ConfirmDialog
        open={deleteTermDepositTarget != null}
        title="Supprimer le dépôt à terme"
        message={
          deleteTermDepositTarget
            ? `« ${deleteTermDepositTarget.bankName || "Dépôt à terme"} » — principal ${formatCurrency(deleteTermDepositTarget.principal, deleteTermDepositTarget.currency)}. Cette suppression est définitive.`
            : ""
        }
        onCancel={() => setDeleteTermDepositTarget(null)}
        onConfirm={() => {
          if (deleteTermDepositTarget)
            deleteTermDeposit.mutate(deleteTermDepositTarget.id);
          setDeleteTermDepositTarget(null);
        }}
        testId="banks-cat-delete-confirm"
      />

      <ConfirmDialog
        open={deleteBankTarget != null}
        title="Supprimer le compte courant"
        message={
          deleteBankTarget
            ? `« ${deleteBankTarget.bankName} » — solde ${formatCurrency(deleteBankTarget.balance, deleteBankTarget.currency)}. Cette suppression est définitive.`
            : ""
        }
        onCancel={() => setDeleteBankTarget(null)}
        onConfirm={() => {
          if (deleteBankTarget) deleteBank.mutate(deleteBankTarget.id);
          setDeleteBankTarget(null);
        }}
        testId="banks-delete-confirm"
      />
      <ConfirmDialog
        open={deleteSavingsTarget != null}
        title="Supprimer le livret"
        message={
          deleteSavingsTarget
            ? `« ${deleteSavingsTarget.name} » — solde crédité ${formatCurrency(deleteSavingsTarget.balance, deleteSavingsTarget.currency)}. Cette suppression est définitive.`
            : ""
        }
        onCancel={() => setDeleteSavingsTarget(null)}
        onConfirm={() => {
          if (deleteSavingsTarget) deleteSavings.mutate(deleteSavingsTarget.id);
          setDeleteSavingsTarget(null);
        }}
        testId="savings-delete-confirm"
      />
    </div>
  );
}
