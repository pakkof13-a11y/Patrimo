"use client";

/**
 * Atomes partagés de l'onglet Banques.
 *
 * Extraits tels quels de `banks-tab.tsx` lors de la refonte : combobox de
 * banque, champ à validation différée, badges, barre de plafond, historique de
 * compte. Ils n'ont pas changé de comportement — seulement de fichier, pour que
 * la liste et le panneau de détail les partagent au lieu d'en avoir chacun une
 * copie.
 */

import { fetchJson } from "@/app/lib/api-client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, HelpCircle, Search } from "lucide-react";
import { BANK_OPTIONS } from "@/app/lib/constants";
import {
  ACCOUNT_CURRENCY_OPTIONS,
  currencyLabel,
} from "@/app/lib/money/currencies";
import { formatCurrency, cn } from "@/app/lib/utils";
import { Modal } from "@/components/ui/modal";
import { d } from "@/app/lib/money/decimal";
import {
  CEILING_ALERT_THRESHOLD_PCT,
  ceilingProgressPct,
} from "@/app/lib/cash/regulated-products";

/** Deux écritures décimales représentent-elles la même valeur ? "1000" ≡ "1000.00". */
export function decimalEquals(a: string, b: string): boolean {
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
export function EditableField({
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

export function CurrencySelect({
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
export function BankNameCombobox({
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

export function NetWorthBadge({
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
export function OwnershipBadge({
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
export function CeilingProgressBar({
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

export type AccountEvent = {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  occurredAt: string;
  notes: string | null;
};

export const EVENT_LABELS: Record<string, string> = {
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
export function AccountHistoryModal({
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

export function FieldLabel({
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

export const DOW_LABELS = [
  "",
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];
export const MONTH_LABELS = [
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

