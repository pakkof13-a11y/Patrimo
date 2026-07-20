"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  FileUp,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/layout/notification-bell";
import { HeaderAccountMenu } from "@/components/layout/header-account-menu";
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

/** Bouton utilitaire icône — hover/focus cohérents header */
const iconBtnClass = cn(
  "h-8 w-8 shrink-0 p-0 text-[var(--muted-foreground)]",
  "hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
  "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
  "disabled:opacity-45"
);

/**
 * Top bar reconstruite (IA SaaS) :
 *
 *  ┌ Identité ────────── Utilitaires ─── Métier (1–2 CTA) ── Compte ┐
 *  │ Logo               🔍 🔔 ↻        Import · Transaction    ⚙ 👤 │
 *  └────────────────────────────────────────────────────────────────┘
 *  ┌ Navigation principale (scroll mobile) ─────────────────────────┐
 *
 * Priorités visibles : Transaction (+ types) ; Import en secondaire.
 * Devise / thème / logout / statut prix → menu Compte.
 */
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
      if (!txRef.current?.contains(t) && !txMenuRef.current?.contains(t)) {
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
      const wrap = txRef.current?.getBoundingClientRect();
      const right = wrap ? wrap.right : r.right;
      setTxCoords({
        top: r.bottom + 4,
        left: right - 168,
        minWidth: 168,
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
                "block w-full px-3 py-2 text-left text-sm transition",
                "focus-visible:bg-[var(--muted)] focus-visible:outline-none",
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
        className="z-[100] min-w-[10.5rem] rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-xl"
        role="menu"
        data-testid="tx-type-menu"
        style={{
          position: "fixed",
          top: txCoords.top,
          left: Math.max(8, txCoords.left),
          minWidth: txCoords.minWidth,
        }}
      >
        <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          Type d&apos;opération
        </p>
        {TX_QUICK.map((t) => (
          <button
            key={t.type}
            type="button"
            role="menuitem"
            className={cn(
              "block w-full px-3 py-2 text-left text-sm transition",
              "hover:bg-[var(--muted)] focus-visible:bg-[var(--muted)] focus-visible:outline-none"
            )}
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

  const priceTitle = lastPriceSync
    ? `Actualiser les prix · dernier : ${formatDateTimeParis(lastPriceSync)}`
    : "Actualiser les prix (auto ~10 s)";

  return (
    <header
      className="app-header sticky top-0 z-20 min-w-0 backdrop-blur-md"
      data-testid="app-header"
    >
      {/* ── Rangée 1 : identité · utilitaires · métier · compte ── */}
      <div
        className={cn(
          "app-shell flex min-w-0 items-center gap-2 px-3 py-2",
          "sm:gap-3 sm:px-5 sm:py-2.5",
          "lg:px-6"
        )}
      >
        {/* A — Identité */}
        <div
          className="flex min-w-0 shrink-0 items-center gap-2.5"
          data-testid="header-brand"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/patrimo.jpg"
            alt=""
            width={36}
            height={36}
            className="h-8 w-8 shrink-0 rounded-lg object-cover shadow-sm ring-1 ring-black/5 dark:ring-white/10 sm:h-9 sm:w-9"
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight text-[var(--foreground)]">
              Patrimo
            </div>
            <div className="text-meta hidden md:block">Suivi de patrimoine</div>
          </div>
        </div>

        {/* Spacer */}
        <div className="min-w-0 flex-1" aria-hidden />

        {/* B — Utilitaires (power users) */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 rounded-[var(--radius-lg)] border border-[var(--border)]",
            "bg-[var(--muted)]/40 p-0.5"
          )}
          data-testid="header-utilities"
          role="group"
          aria-label="Outils"
        >
          {onOpenCommandPalette && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onOpenCommandPalette}
              title="Recherche (/) · palette (Ctrl+K)"
              data-testid="open-command-palette"
              aria-label="Recherche et palette de commandes (raccourci barre oblique ou Ctrl+K)"
              className={cn(iconBtnClass, "hidden sm:inline-flex")}
            >
              <Search className="h-3.5 w-3.5" />
            </Button>
          )}
          <NotificationBell />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefreshPrices}
            disabled={refreshPending}
            data-testid="refresh-prices"
            title={priceTitle}
            aria-label="Actualiser les prix"
            className={cn(iconBtnClass, "relative")}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refreshPending && "animate-spin")}
            />
            <span
              className={cn(
                "absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500",
                priceSyncPulse ? "opacity-100" : "opacity-40"
              )}
              aria-hidden
            />
          </Button>
        </div>

        {/* C — Actions métier (1 primaire + 1 secondaire) */}
        <div
          className="flex shrink-0 items-center gap-1.5 sm:gap-2"
          data-testid="header-business-actions"
          role="group"
          aria-label="Actions principales"
        >
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
              title="Importer un relevé CSV"
              className={cn(
                "border-slate-200 dark:border-slate-700",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
              )}
            >
              <FileUp className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Importer</span>
            </Button>
          )}

          <div ref={txRef} className="relative inline-flex shrink-0 shadow-sm">
            <Button
              size="sm"
              onClick={() => onOpenTransaction()}
              data-testid="open-tx-form"
              className={cn(
                "rounded-r-none pr-2.5",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50 focus-visible:ring-offset-1"
              )}
              title="Nouvelle transaction (n) — source de vérité du portefeuille"
              aria-keyshortcuts="n"
            >
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Transaction</span>
            </Button>
            <Button
              ref={txToggleRef}
              size="sm"
              className={cn(
                "rounded-l-none border-l border-teal-900/20 px-1.5 dark:border-teal-950/40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/50"
              )}
              aria-label="Choisir un type d'opération"
              aria-expanded={txMenuOpen}
              aria-haspopup="menu"
              data-testid="open-tx-menu"
              title="Achat, vente, dividende, frais…"
              onClick={() => setTxMenuOpen((v) => !v)}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* D — Compte (Préférences = FAB bas-gauche, roue crantée) */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-1 border-l border-[var(--border)] pl-2 sm:pl-2.5"
          )}
          data-testid="header-account-zone"
          role="group"
          aria-label="Compte"
        >
          <HeaderAccountMenu
            baseCurrency={baseCurrency}
            onBaseCurrencyChange={onBaseCurrencyChange}
            lastPriceSync={lastPriceSync}
            priceSyncPulse={priceSyncPulse}
          />
        </div>
      </div>

      {/* ── Rangée 2 : navigation produit ── */}
      <nav
        ref={navRef}
        className={cn(
          "app-shell flex min-w-0 gap-0.5 overflow-x-auto overscroll-x-contain",
          "border-t border-[var(--border)] px-2 pb-1.5 pt-1 sm:px-4 sm:pb-2 lg:px-5",
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
                  "shrink-0 rounded-[var(--radius-md)] px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition",
                  "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                  active
                    ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
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
                  "inline-flex items-center gap-1 rounded-[var(--radius-md)] px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition",
                  "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                  active
                    ? "bg-[var(--primary-soft)] text-[var(--primary)]"
                    : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
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
