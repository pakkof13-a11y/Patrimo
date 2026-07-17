"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { signOut } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";
import { fetchJson } from "@/app/lib/api-client";
import {
  BASE_CURRENCY_OPTIONS,
  currencyLabel,
} from "@/app/lib/money/currencies";
import { formatDateTimeParis } from "@/app/lib/money/format";

/**
 * Menu Compte : identité, devise, statut sync, déconnexion.
 * Thème & sécurité → panneau Préférences (⚙).
 */
export function HeaderAccountMenu({
  baseCurrency,
  onBaseCurrencyChange,
  lastPriceSync,
  priceSyncPulse,
}: {
  baseCurrency: string;
  onBaseCurrencyChange: (code: string) => void;
  lastPriceSync: Date | null;
  priceSyncPulse: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const meQ = useQuery({
    queryKey: ["auth-me"],
    queryFn: () =>
      fetchJson<{
        user: { id: string; username?: string; role?: string };
      }>("/api/auth/me"),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const username =
    meQ.data?.user?.username ||
    meQ.data?.user?.id?.slice(0, 8) ||
    "Compte";
  const isAdmin = meQ.data?.user?.role === "ADMIN";

  return (
    <div ref={rootRef} className="relative" data-testid="header-account-menu">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          "gap-1.5 border-slate-200/90 dark:border-slate-700",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        )}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Menu compte"
        data-testid="header-account-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <UserRound className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
        <span className="hidden max-w-[7rem] truncate sm:inline">{username}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 opacity-50 transition-transform",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </Button>

      {open && (
        <div
          className={cn(
            "absolute right-0 z-[60] mt-2 w-72 origin-top-right",
            "rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-xl",
            "animate-in fade-in-0 zoom-in-95"
          )}
          role="menu"
          aria-label="Compte et préférences rapides"
          data-testid="header-account-dropdown"
        >
          {/* Identité */}
          <div className="mb-2 rounded-lg bg-[var(--muted)]/50 px-3 py-2.5">
            <p className="truncate text-sm font-semibold text-[var(--foreground)]">
              {username}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Europe/Paris
              {isAdmin && (
                <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  ADMIN
                </span>
              )}
            </p>
          </div>

          {/* Devise */}
          <label className="mb-2 block px-1">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Devise de reporting
            </span>
            <select
              className="input !w-full !py-1.5 text-sm"
              value={baseCurrency}
              onChange={(e) => onBaseCurrencyChange(e.target.value)}
              aria-label="Devise de reporting"
              data-testid="header-currency-select"
            >
              {BASE_CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {currencyLabel(c)}
                </option>
              ))}
            </select>
          </label>

          <p className="mb-2 px-2.5 text-[10px] leading-snug text-[var(--muted-foreground)]">
            Thème et sécurité : icône ⚙ Préférences à gauche.
          </p>

          {/* Sync statut (info only) */}
          <div
            className="mb-2 flex items-start gap-2 border-t border-[var(--border)] px-2.5 pt-2 text-[11px] text-slate-500 dark:text-slate-400"
            data-testid="header-price-status"
          >
            <span
              className={cn(
                "mt-1 inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500",
                priceSyncPulse ? "animate-pulse opacity-100" : "opacity-50"
              )}
              aria-hidden
            />
            <span>
              {lastPriceSync
                ? `Derniers prix · ${formatDateTimeParis(lastPriceSync)}`
                : "Prix · actualisation auto (~10 s)"}
            </span>
          </div>

          <button
            type="button"
            role="menuitem"
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm",
              "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30"
            )}
            data-testid="logout"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            Se déconnecter
          </button>
        </div>
      )}
    </div>
  );
}
