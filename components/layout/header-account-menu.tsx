"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ImagePlus, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";
import { fetchJson } from "@/app/lib/api-client";
import {
  BASE_CURRENCY_OPTIONS,
  currencyLabel,
} from "@/app/lib/money/currencies";
import { formatDateTimeParis } from "@/app/lib/money/format";
import { PreferencesPanel } from "@/components/layout/preferences-panel";
import {
  loadUserAvatarDataUrl,
  readImageFileAsDataUrl,
  saveUserAvatarDataUrl,
  userInitials,
} from "@/app/lib/ui/user-avatar-prefs";

/**
 * Menu Compte (haut-droit) : identité, préférences intégrées, déconnexion.
 * FAB bas-gauche supprimé — tout passe par ce menu profil.
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
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const meQ = useQuery({
    queryKey: ["auth-me"],
    queryFn: () =>
      fetchJson<{
        user: { id: string; username?: string; role?: string; email?: string };
      }>("/api/auth/me"),
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    setAvatarUrl(loadUserAvatarDataUrl());
  }, [open]);

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
  const email =
    meQ.data?.user?.email ||
    `${(username || "user").toLowerCase().replace(/[^a-z0-9._-]/g, "")}@patrimo.local`;
  const initials = userInitials(username);

  async function onAvatarFile(file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await readImageFileAsDataUrl(file);
      saveUserAvatarDataUrl(dataUrl);
      setAvatarUrl(dataUrl);
      toast.success("Avatar mis à jour");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Avatar invalide");
    }
  }

  function clearAvatar() {
    saveUserAvatarDataUrl(null);
    setAvatarUrl(null);
    toast.success("Avatar retiré");
  }

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
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="h-5 w-5 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-[9px] font-bold text-white">
            {initials}
          </span>
        )}
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
            "absolute right-0 z-[60] mt-2 w-[min(22rem,calc(100vw-1.25rem))] origin-top-right",
            "max-h-[min(85vh,36rem)] overflow-y-auto overscroll-contain",
            "rounded-xl border border-[var(--border)] bg-[var(--card)] p-2 shadow-xl",
            "animate-in fade-in-0 zoom-in-95"
          )}
          role="menu"
          aria-label="Compte et préférences"
          data-testid="header-account-dropdown"
        >
          {/* Identité + avatar (sélection à droite du bandeau) */}
          <div
            className="mb-2 rounded-lg bg-[var(--muted)]/50 px-3 py-2.5"
            data-testid="header-account-identity"
          >
            <div className="flex items-center gap-2.5">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-sm font-bold text-white">
                  {initials}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                  {username}
                  {isAdmin && (
                    <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                      ADMIN
                    </span>
                  )}
                </p>
                <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                  {email}
                </p>
                <p className="text-[10px] text-slate-400">Europe/Paris</p>
              </div>
              {/* Bouton avatar à droite du bandeau user (sélection JPG/PNG) */}
              <div
                className="flex shrink-0 flex-col items-end gap-1"
                data-testid="avatar-settings"
              >
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png"
                  className="hidden"
                  data-testid="avatar-file-input"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    void onAvatarFile(f);
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="!h-7 !px-2 !text-[11px]"
                  onClick={() => avatarInputRef.current?.click()}
                  data-testid="avatar-upload"
                  title="Changer l’avatar"
                >
                  <ImagePlus className="mr-1 h-3 w-3" />
                  JPG / PNG
                </Button>
                {avatarUrl && (
                  <button
                    type="button"
                    className="text-[10px] text-[var(--muted-foreground)] underline-offset-2 hover:underline"
                    onClick={clearAvatar}
                    data-testid="avatar-clear"
                  >
                    Retirer
                  </button>
                )}
              </div>
            </div>
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

          {/* Préférences (thème, avatar, P&L latent, benchmark, sécurité…) */}
          <div
            className="mb-2 border-t border-[var(--border)] pt-2"
            data-testid="header-preferences-slot"
          >
            <PreferencesPanel placement="header" embedded />
          </div>

          {/* Sync statut */}
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

          <div className="border-t border-[var(--border)] pt-1">
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
        </div>
      )}
    </div>
  );
}
