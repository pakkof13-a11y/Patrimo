"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  FileUp,
  LogOut,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { PreferencesPanel } from "@/components/layout/preferences-panel";
import { NotificationBell } from "@/components/layout/notification-bell";
import { BASE_CURRENCY_OPTIONS, currencyLabel } from "@/app/lib/money/currencies";
import { formatDateTimeParis } from "@/app/lib/money/format";
import { cn } from "@/app/lib/utils";
import { NAV_GROUPS } from "@/app/lib/types/nav-groups";
import { isPositionsTab, type MainTab } from "@/app/lib/types/ui";

const TX_QUICK: { type: string; label: string }[] = [
  { type: "ACHAT", label: "Achat" },
  { type: "VENTE", label: "Vente" },
  { type: "DIVIDENDE", label: "Dividende" },
  { type: "FRAIS", label: "Frais" },
];

type MenuCoords = { top: number; left: number; minWidth: number };

export function AppHeader({
  tab,
  onTabChange,
  baseCurrency,
  onBaseCurrencyChange,
  lastPriceSync,
  priceSyncPulse,
  refreshPending,
  onRefreshPrices,
  onOpenTransaction,
  onOpenImport,
  onOpenCommandPalette,
}: {
  tab: MainTab;
  onTabChange: (tab: MainTab) => void;
  baseCurrency: string;
  onBaseCurrencyChange: (code: string) => void;
  lastPriceSync: Date | null;
  priceSyncPulse: boolean;
  refreshPending: boolean;
  onRefreshPrices: () => void;
  onOpenTransaction: (type?: string) => void;
  onOpenImport?: () => void;
  onOpenCommandPalette?: () => void;
}) {
  const positionsFamily = isPositionsTab(tab);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [groupCoords, setGroupCoords] = useState<MenuCoords | null>(null);
  const [txMenuOpen, setTxMenuOpen] = useState(false);
  const [txCoords, setTxCoords] = useState<MenuCoords | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const groupBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const groupMenuRef = useRef<HTMLDivElement>(null);
  const txRef = useRef<HTMLDivElement>(null);
  const txMenuRef = useRef<HTMLDivElement>(null);
  const txToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      const inNavBtn = Object.values(groupBtnRefs.current).some((el) =>
        el?.contains(t)
      );
      const inGroupMenu = groupMenuRef.current?.contains(t);
      if (!inNavBtn && !inGroupMenu) {
        setOpenGroup(null);
        setGroupCoords(null);
      }
      if (
        !txRef.current?.contains(t) &&
        !txMenuRef.current?.contains(t)
      ) {
        setTxMenuOpen(false);
        setTxCoords(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpenGroup(null);
        setGroupCoords(null);
        setTxMenuOpen(false);
        setTxCoords(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  useLayoutEffect(() => {
    if (!openGroup) {
      setGroupCoords(null);
      return;
    }
    function update() {
      const btn = groupBtnRefs.current[openGroup!];
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      setGroupCoords({
        top: r.bottom + 4,
        left: r.left,
        minWidth: Math.max(r.width, 192),
      });
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [openGroup]);

  useLayoutEffect(() => {
    if (!txMenuOpen) {
      setTxCoords(null);
      return;
    }
    function update() {
      const btn = txToggleRef.current;
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      // Align right edge of menu with the split button group
      const wrap = txRef.current?.getBoundingClientRect();
      const right = wrap ? wrap.right : r.right;
      setTxCoords({
        top: r.bottom + 4,
        left: right - 160,
        minWidth: 160,
      });
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [txMenuOpen]);

  function groupIsActive(items: { id: MainTab }[]) {
    return items.some((i) =>
      i.id === "holdings" ? positionsFamily : tab === i.id
    );
  }

  const openGroupDef = openGroup
    ? NAV_GROUPS.find((g) => g.id === openGroup)
    : null;

  const groupMenu =
    openGroupDef &&
    groupCoords &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        ref={groupMenuRef}
        className="z-[100] min-w-[12rem] rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-xl"
        role="menu"
        data-testid={`nav-group-menu-${openGroupDef.id}`}
        style={{
          position: "fixed",
          top: groupCoords.top,
          left: groupCoords.left,
          minWidth: groupCoords.minWidth,
        }}
      >
        {openGroupDef.items.map((item) => {
          const tid = item.testId || item.id;
          const sel =
            item.id === "holdings" ? positionsFamily : tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              data-testid={`nav-${tid}`}
              className={cn(
                "block w-full px-3 py-1.5 text-left text-sm",
                sel
                  ? "bg-teal-50 font-medium text-teal-900 dark:bg-teal-950/40 dark:text-teal-100"
                  : "hover:bg-[var(--muted)]"
              )}
              onClick={() => {
                setOpenGroup(null);
                setGroupCoords(null);
                onTabChange(item.id);
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>,
      document.body
    );

  const txMenu =
    txMenuOpen &&
    txCoords &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        ref={txMenuRef}
        className="z-[100] min-w-[10rem] rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-xl"
        role="menu"
        data-testid="tx-type-menu"
        style={{
          position: "fixed",
          top: txCoords.top,
          left: Math.max(8, txCoords.left),
          minWidth: txCoords.minWidth,
        }}
      >
        {TX_QUICK.map((t) => (
          <button
            key={t.type}
            type="button"
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--muted)]"
            onClick={() => {
              setTxMenuOpen(false);
              setTxCoords(null);
              onOpenTransaction(t.type);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>,
      document.body
    );

  return (
    <header className="app-header sticky top-0 z-20 min-w-0 backdrop-blur-md">
      {/*
        Top bar fluide :
        - mobile : marque + actions sur 2 lignes (wrap ordonné)
        - sm+ : une ligne justify-between, actions en wrap si besoin
      */}
      <div
        className={cn(
          "app-shell flex min-w-0 flex-col gap-2 px-3 py-2.5",
          "sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5 sm:py-3",
          "lg:px-6"
        )}
      >
        <div className="flex min-w-0 shrink-0 items-center gap-2.5 sm:gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/patrimo.jpg"
            alt="Patrimo"
            width={36}
            height={36}
            className="h-8 w-8 shrink-0 rounded-lg object-cover shadow-sm ring-1 ring-black/5 dark:ring-white/10 sm:h-9 sm:w-9"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--foreground)]">
              Patrimo
            </div>
            <div className="hidden text-xs text-zinc-600 dark:text-slate-400 sm:block">
              Europe/Paris · multi-compte
            </div>
          </div>
        </div>

        <div
          className={cn(
            "flex min-w-0 flex-wrap items-center gap-1.5",
            "sm:justify-end sm:gap-2"
          )}
        >
          {onOpenCommandPalette && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpenCommandPalette}
              title="Palette de commandes (Ctrl+K)"
              data-testid="open-command-palette"
              className="hidden sm:inline-flex"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="text-[11px] text-slate-500">Ctrl+K</span>
            </Button>
          )}
          <select
            className="input !w-auto max-w-[6.5rem] !py-1.5 text-xs sm:max-w-none"
            value={baseCurrency}
            onChange={(e) => onBaseCurrencyChange(e.target.value)}
            title="Devise de reporting"
            aria-label="Devise de reporting"
          >
            {BASE_CURRENCY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {currencyLabel(c)}
              </option>
            ))}
          </select>
          <PreferencesPanel />
          <ThemeToggle />
          <NotificationBell />
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="Se déconnecter"
            data-testid="logout"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Quitter</span>
          </Button>
          <div
            className="hidden items-center gap-1.5 text-[10px] text-zinc-500 dark:text-slate-400 md:flex"
            title={
              lastPriceSync
                ? `Dernier prix · ${formatDateTimeParis(lastPriceSync)}`
                : "Auto-refresh 10s"
            }
          >
            <span
              className={cn(
                "inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500 transition-opacity",
                priceSyncPulse ? "opacity-100 animate-pulse" : "opacity-40"
              )}
            />
            <span className="max-w-[9rem] truncate lg:max-w-none">
              {lastPriceSync
                ? `Prix · ${formatDateTimeParis(lastPriceSync)}`
                : "Auto 10s"}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefreshPrices}
            disabled={refreshPending}
            data-testid="refresh-prices"
            title="Actualiser les prix"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refreshPending && "animate-spin")}
            />
            <span className="hidden lg:inline">Actualiser</span>
          </Button>
          {onOpenImport && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenImport();
              }}
              data-testid="open-import-csv"
              title="Import CSV"
            >
              <FileUp className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Import CSV</span>
            </Button>
          )}
          {/* Bouton Transaction + menu types */}
          <div ref={txRef} className="relative inline-flex shrink-0">
            <Button
              size="sm"
              onClick={() => onOpenTransaction()}
              data-testid="open-tx-form"
              className="rounded-r-none"
              title="Nouvelle transaction"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Transaction</span>
            </Button>
            <Button
              ref={txToggleRef}
              size="sm"
              className="rounded-l-none border-l border-teal-800/30 px-1.5"
              aria-label="Types d'opération"
              aria-expanded={txMenuOpen}
              data-testid="open-tx-menu"
              onClick={() => setTxMenuOpen((v) => !v)}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>

      {/* Navigation regroupée — overflow-x pour mobile, menus en portal fixed */}
      <nav
        ref={navRef}
        className={cn(
          "app-shell flex min-w-0 gap-1 overflow-x-auto overscroll-x-contain",
          "px-3 pb-2 sm:px-5 lg:px-6",
          "[scrollbar-width:thin]"
        )}
        aria-label="Navigation principale"
        data-testid="primary-nav"
      >
        {NAV_GROUPS.map((group) => {
          const single = group.items.length === 1;
          const active = groupIsActive(group.items);
          if (single) {
            const item = group.items[0]!;
            const tid = item.testId || item.id;
            return (
              <button
                key={group.id}
                type="button"
                data-testid={`nav-${tid}`}
                onClick={() => onTabChange(item.id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition whitespace-nowrap",
                  active
                    ? "bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-200"
                    : "text-zinc-800 hover:bg-zinc-100 dark:text-slate-300 dark:hover:bg-slate-800"
                )}
              >
                {item.label}
              </button>
            );
          }
          return (
            <div key={group.id} className="relative shrink-0">
              <button
                ref={(el) => {
                  groupBtnRefs.current[group.id] = el;
                }}
                type="button"
                data-testid={`nav-group-${group.id}`}
                aria-expanded={openGroup === group.id}
                aria-haspopup="menu"
                onClick={() =>
                  setOpenGroup((g) => (g === group.id ? null : group.id))
                }
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium transition whitespace-nowrap",
                  active
                    ? "bg-teal-50 text-teal-900 dark:bg-teal-950 dark:text-teal-200"
                    : "text-zinc-800 hover:bg-zinc-100 dark:text-slate-300 dark:hover:bg-slate-800"
                )}
              >
                {group.label}
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 opacity-60 transition-transform",
                    openGroup === group.id && "rotate-180"
                  )}
                />
              </button>
            </div>
          );
        })}
      </nav>
      {groupMenu}
      {txMenu}
    </header>
  );
}
