"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Database,
  ImagePlus,
  Monitor,
  Moon,
  Settings,
  Sun,
  Trash2,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";
import { fetchJson } from "@/app/lib/api-client";
import { AdminUsersPanel } from "@/components/layout/admin-users-panel";
import { ChangePasswordForm } from "@/components/layout/change-password-form";
import {
  DEFAULT_BENCHMARK_OPTIONS,
  loadDefaultBenchmark,
  saveDefaultBenchmark,
  type DefaultBenchmark,
} from "@/app/lib/portfolio/benchmark-prefs";
import {
  LATENT_PNL_RANGE_LABELS,
  LATENT_PNL_RANGES,
  loadLatentPnlRange,
  saveLatentPnlRange,
  type LatentPnlRange,
} from "@/app/lib/portfolio/latent-pnl-prefs";
import {
  loadUserAvatarDataUrl,
  readImageFileAsDataUrl,
  saveUserAvatarDataUrl,
  userInitials,
} from "@/app/lib/ui/user-avatar-prefs";

const CLEAR_CONFIRM_WORD = "SUPPRIMER";

type ThemeChoice = "system" | "light" | "dark";

const THEME_OPTIONS: {
  id: ThemeChoice;
  label: string;
  hint: string;
  icon: typeof Sun;
}[] = [
  {
    id: "system",
    label: "Système",
    hint: "Suit le réglage de votre appareil",
    icon: Monitor,
  },
  {
    id: "light",
    label: "Clair",
    hint: "Fond papier, contrastes diurnes",
    icon: Sun,
  },
  {
    id: "dark",
    label: "Sombre",
    hint: "Fonds navy, lecture prolongée",
    icon: Moon,
  },
];

function SectionTitle({
  icon: Icon,
  children,
  tone = "default",
}: {
  icon: typeof Settings;
  children: React.ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <div
      className={cn(
        "mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide",
        tone === "danger"
          ? "text-red-700/90 dark:text-red-300/90"
          : "text-[var(--muted-foreground)]"
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </div>
  );
}

/**
 * Panneau Préférences — architecture en 3 zones :
 * 1. Affichage (thème, avatar, P&L latent, benchmark)
 * 2. Sécurité (mot de passe) + admin
 * 3. Données / zone de danger
 *
 * - `embedded` : contenu seul (menu profil haut-droit)
 * - `header` : bouton icône + popover
 * - `bottom-left` : FAB (legacy, désactivé côté app)
 */
export function PreferencesPanel({
  placement = "header",
  embedded = false,
}: {
  placement?: "bottom-left" | "header";
  /** Contenu inline sans bouton trigger (menu compte) */
  embedded?: boolean;
} = {}) {
  const [open, setOpen] = useState(embedded);
  const [dangerOpen, setDangerOpen] = useState(false);
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [themeMounted, setThemeMounted] = useState(false);
  const [defaultBenchmark, setDefaultBenchmark] =
    useState<DefaultBenchmark>("none");
  const [latentRange, setLatentRange] = useState<LatentPnlRange>("all");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setThemeMounted(true);
    setDefaultBenchmark(loadDefaultBenchmark());
    setLatentRange(loadLatentPnlRange());
    setAvatarUrl(loadUserAvatarDataUrl());
  }, []);

  const meQ = useQuery({
    queryKey: ["auth-me"],
    queryFn: () =>
      fetchJson<{
        user: { id: string; username?: string; role?: string };
      }>("/api/auth/me"),
    staleTime: 60_000,
    retry: false,
  });
  const isAdmin = meQ.data?.user?.role === "ADMIN";

  useEffect(() => {
    if (embedded) return;
    if (!open) {
      setDangerOpen(false);
      setConfirmChecked(false);
      setConfirmText("");
      return;
    }
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc);
    }, 50);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open, embedded]);

  const clearMut = useMutation({
    mutationFn: () =>
      fetchJson<{
        ok: boolean;
        message?: string;
        transactionsDeleted: number;
        assetsDeleted: number;
        platformsDeleted?: number;
      }>("/api/preferences/clear-data", { method: "DELETE" }),
    onSuccess: async (data) => {
      toast.success(
        data.message ||
          "Patrimoine effacé — votre compte de connexion est conservé"
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["holdings"] }),
        qc.invalidateQueries({ queryKey: ["transactions"] }),
        qc.invalidateQueries({ queryKey: ["assets"] }),
        qc.invalidateQueries({ queryKey: ["portfolio-history"] }),
        qc.invalidateQueries({ queryKey: ["platforms"] }),
        qc.invalidateQueries({ queryKey: ["asset-detail"] }),
        qc.invalidateQueries({ queryKey: ["banks"] }),
        qc.invalidateQueries({ queryKey: ["savings"] }),
        qc.invalidateQueries({ queryKey: ["liabilities"] }),
        qc.invalidateQueries({ queryKey: ["life-insurance"] }),
        qc.invalidateQueries({ queryKey: ["employee-savings"] }),
        qc.invalidateQueries({ queryKey: ["alternatives"] }),
        qc.invalidateQueries({ queryKey: ["precious-metals"] }),
        qc.invalidateQueries({ queryKey: ["private-equity"] }),
        qc.invalidateQueries({ queryKey: ["crowdlending"] }),
        qc.invalidateQueries({ queryKey: ["tangibles"] }),
        qc.invalidateQueries({ queryKey: ["envelopes"] }),
      ]);
      setConfirmChecked(false);
      setConfirmText("");
      setDangerOpen(false);
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canConfirmClear =
    confirmChecked &&
    confirmText.trim().toUpperCase() === CLEAR_CONFIRM_WORD &&
    !clearMut.isPending;

  function handleClearPatrimoine() {
    if (!canConfirmClear) return;
    clearMut.mutate();
  }

  const activeTheme: ThemeChoice =
    !themeMounted
      ? "system"
      : theme === "light" || theme === "dark" || theme === "system"
        ? theme
        : "system";

  const isFab = placement === "bottom-left" && !embedded;
  const username =
    meQ.data?.user?.username || meQ.data?.user?.id?.slice(0, 8) || "";
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
    toast.success("Avatar retiré — initiales affichées");
  }

  const prefsBody = (
        <>
          {!embedded && (
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h2 className="text-title flex items-center gap-2">
                <Settings
                  className="h-4 w-4 text-[var(--primary)]"
                  aria-hidden
                />
                Préférences
              </h2>
              {meQ.data?.user && (
                <p className="text-meta mt-1">
                  Connecté ·{" "}
                  <span className="font-medium text-[var(--foreground)]">
                    {meQ.data.user.username || meQ.data.user.id}
                  </span>
                  {isAdmin && (
                    <span className="ml-1.5 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      ADMIN
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
          )}
          {embedded && (
            <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
              Préférences
            </p>
          )}

          {/* ── 1. Affichage ──────────────────────────────────────────── */}
          <section
            className="mb-4"
            aria-labelledby="prefs-display-heading"
            data-testid="display-settings"
          >
            <SectionTitle icon={Monitor}>
              <span id="prefs-display-heading">Affichage</span>
            </SectionTitle>
            <p className="text-meta mb-2.5">
              La largeur de l&apos;interface s&apos;adapte automatiquement à
              votre écran (mode fluide). Aucun réglage manuel requis.
            </p>

            <p className="mb-1.5 text-[11px] font-medium text-[var(--foreground)]">
              Avatar (bas à gauche)
            </p>
            <div
              className="mb-3 flex items-center gap-3"
              data-testid="avatar-settings"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--primary)] text-sm font-bold text-white shadow">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={avatarUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
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
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="!h-7 !text-[11px]"
                    onClick={() => avatarInputRef.current?.click()}
                    data-testid="avatar-upload"
                  >
                    <ImagePlus className="mr-1 h-3 w-3" />
                    JPG / PNG
                  </Button>
                  {avatarUrl && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="!h-7 !text-[11px]"
                      onClick={clearAvatar}
                      data-testid="avatar-clear"
                    >
                      Retirer
                    </Button>
                  )}
                </div>
                <p className="text-[10px] text-[var(--muted-foreground)]">
                  {avatarUrl
                    ? "Avatar actif — initiales masquées sur le bouton"
                    : `Initiales « ${initials} » (2 premières lettres du compte)`}
                </p>
              </div>
            </div>

            <p className="mb-1.5 text-[11px] font-medium text-[var(--foreground)]">
              Thème
            </p>
            <div
              className="grid grid-cols-3 gap-1.5"
              role="radiogroup"
              aria-label="Thème d'interface"
              data-testid="theme-settings"
            >
              {THEME_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const selected = activeTheme === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`theme-option-${opt.id}`}
                    onClick={() => setTheme(opt.id)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-[var(--radius-md)] border px-1.5 py-2.5 text-center transition",
                      "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                      selected
                        ? "border-[var(--primary)] bg-[var(--primary-soft)]"
                        : "border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--muted)]/50"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-3.5 w-3.5",
                        selected
                          ? "text-[var(--primary)]"
                          : "text-[var(--muted-foreground)]"
                      )}
                      aria-hidden
                    />
                    <span className="text-[11px] font-semibold text-[var(--foreground)]">
                      {opt.label}
                    </span>
                    <span className="text-[9px] leading-tight text-[var(--muted-foreground)]">
                      {opt.hint}
                    </span>
                  </button>
                );
              })}
            </div>
            {themeMounted && resolvedTheme && (
              <p className="text-meta mt-2">
                Actuellement :{" "}
                <span className="font-medium text-[var(--foreground)]">
                  {resolvedTheme === "dark" ? "sombre" : "clair"}
                </span>
                {activeTheme === "system" ? " (via le système)" : ""}
              </p>
            )}

            <p className="mb-1.5 mt-4 text-[11px] font-medium text-[var(--foreground)]">
              P&amp;L latent — période
            </p>
            <p className="text-meta mb-2">
              Période affichée sur l&apos;indicateur P&amp;L latent (bandeau KPI).
              « Tout » = latent total actuel.
            </p>
            <div
              className="flex flex-nowrap gap-0.5 overflow-x-auto pb-0.5"
              role="radiogroup"
              aria-label="Période P&L latent"
              data-testid="latent-pnl-range-settings"
            >
              {LATENT_PNL_RANGES.map((id) => {
                const selected = latentRange === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    data-testid={`latent-pnl-range-${id}`}
                    onClick={() => {
                      setLatentRange(id);
                      saveLatentPnlRange(id);
                      try {
                        window.dispatchEvent(
                          new CustomEvent("patrimo:latent-pnl-range")
                        );
                      } catch {
                        /* ignore */
                      }
                    }}
                    className={cn(
                      "shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold transition",
                      selected
                        ? "border-[var(--primary)] bg-[var(--primary-soft)] text-[var(--primary)]"
                        : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)]/50"
                    )}
                  >
                    {LATENT_PNL_RANGE_LABELS[id]}
                  </button>
                );
              })}
            </div>

            <p className="mb-1.5 mt-4 text-[11px] font-medium text-[var(--foreground)]">
              Benchmark par défaut (dashboard)
            </p>
            <p className="text-meta mb-2">
              Comparaison appliquée au module Évolution lorsque Vs est sur
              « Défaut ». Surchargeable dans le dashboard.
            </p>
            <div
              className="grid grid-cols-2 gap-1.5 sm:grid-cols-4"
              role="radiogroup"
              aria-label="Benchmark par défaut"
              data-testid="default-benchmark-settings"
            >
              {DEFAULT_BENCHMARK_OPTIONS.map((opt) => {
                const selected = defaultBenchmark === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={opt.hint}
                    data-testid={`default-benchmark-${opt.id}`}
                    onClick={() => {
                      setDefaultBenchmark(opt.id);
                      saveDefaultBenchmark(opt.id);
                      toast.success("Benchmark par défaut enregistré");
                    }}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-[var(--radius-md)] border px-2 py-2 text-left transition",
                      "focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]",
                      selected
                        ? "border-[var(--primary)] bg-[var(--primary-soft)]"
                        : "border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--muted)]/50"
                    )}
                  >
                    <span className="text-[11px] font-semibold text-[var(--foreground)]">
                      {opt.label}
                    </span>
                    <span className="text-[9px] leading-tight text-[var(--muted-foreground)]">
                      {opt.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── 2. Sécurité ───────────────────────────────────────────── */}
          <section
            className="mb-1 border-t border-[var(--border)] pt-3"
            aria-labelledby="prefs-security-heading"
            data-testid="security-settings"
          >
            <span id="prefs-security-heading" className="sr-only">
              Sécurité du compte
            </span>
            <ChangePasswordForm />
            {isAdmin && <AdminUsersPanel />}
          </section>

          {/* ── 3. Données / zone de danger ───────────────────────────── */}
          <section
            className="mt-4 border-t border-[var(--border)] pt-3"
            aria-labelledby="prefs-data-heading"
            data-testid="data-danger-zone"
          >
            <SectionTitle icon={Database} tone="danger">
              <span id="prefs-data-heading">Données</span>
            </SectionTitle>
            <p className="text-meta mb-2">
              Actions irréversibles sur{" "}
              <strong className="font-medium text-[var(--foreground)]">
                votre patrimoine uniquement
              </strong>
              . Votre identifiant et votre mot de passe ne sont pas affectés.
            </p>

            {!dangerOpen ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(
                  "w-full border-red-200 text-red-800 hover:bg-red-50",
                  "dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/40"
                )}
                data-testid="open-clear-data"
                onClick={() => setDangerOpen(true)}
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Effacer mon patrimoine…
              </Button>
            ) : (
              <div
                className={cn(
                  "rounded-[var(--radius-lg)] border border-red-200/90 bg-red-50/50 p-3",
                  "dark:border-red-900/40 dark:bg-red-950/25"
                )}
                data-testid="clear-data-confirm"
              >
                <p className="mb-2 text-xs font-semibold text-red-900 dark:text-red-100">
                  Effacer mon patrimoine
                </p>
                <ul className="mb-2 list-inside list-disc space-y-0.5 text-[11px] leading-snug text-red-900/85 dark:text-red-100/80">
                  <li>
                    <strong>Supprimé :</strong> transactions, positions,
                    plateformes, banques, passifs, AV, épargne, alternatifs,
                    historique
                  </li>
                  <li>
                    <strong>Conservé :</strong> compte de connexion (identifiant
                    / mot de passe)
                  </li>
                  <li>Les autres utilisateurs de l&apos;app ne sont pas touchés</li>
                </ul>

                <label className="mb-2 flex cursor-pointer items-start gap-2 text-[11px] text-red-900/90 dark:text-red-100/85">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-red-300 text-red-700 focus:ring-red-500"
                    checked={confirmChecked}
                    onChange={(e) => setConfirmChecked(e.target.checked)}
                    data-testid="clear-data-checkbox"
                  />
                  <span>
                    Je comprends que cette action est définitive et que je ne
                    pourrai pas récupérer ces données.
                  </span>
                </label>

                <label className="mb-3 block text-[11px] text-red-900/90 dark:text-red-100/85">
                  <span className="mb-1 block font-medium">
                    Pour confirmer, saisissez{" "}
                    <kbd className="rounded bg-red-100 px-1 font-mono text-[10px] dark:bg-red-950">
                      {CLEAR_CONFIRM_WORD}
                    </kbd>
                  </span>
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    className="input !border-red-200 !bg-white !py-1.5 text-sm dark:!border-red-900/50 dark:!bg-[var(--input-bg)]"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={CLEAR_CONFIRM_WORD}
                    data-testid="clear-data-confirm-input"
                    aria-label={`Saisir ${CLEAR_CONFIRM_WORD} pour confirmer`}
                  />
                </label>

                <div className="flex flex-col gap-1.5 sm:flex-row">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      setDangerOpen(false);
                      setConfirmChecked(false);
                      setConfirmText("");
                    }}
                    data-testid="clear-data-cancel"
                  >
                    Annuler
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    className="flex-1"
                    data-testid="clear-all-transactions"
                    disabled={!canConfirmClear}
                    onClick={handleClearPatrimoine}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {clearMut.isPending
                      ? "Suppression…"
                      : "Effacer définitivement"}
                  </Button>
                </div>
              </div>
            )}
          </section>
        </>
  );

  if (embedded) {
    return (
      <div
        ref={rootRef}
        className="px-0.5"
        data-placement="embedded"
        data-testid="preferences-panel"
      >
        <div data-testid="preferences-dialog">{prefsBody}</div>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={cn(
        isFab
          ? "fixed bottom-4 left-4 z-[70] sm:bottom-5 sm:left-5"
          : "relative"
      )}
      data-placement={placement}
    >
      <Button
        type="button"
        variant={isFab ? "default" : "ghost"}
        size="sm"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        title="Préférences"
        data-testid="preferences-panel"
        aria-expanded={open}
        aria-label="Préférences"
        className={cn(
          isFab
            ? cn(
                "relative h-11 w-11 overflow-hidden rounded-full p-0 shadow-lg",
                "bg-[var(--primary)] text-white hover:opacity-95",
                open && "ring-2 ring-teal-500/40 ring-offset-2"
              )
            : cn(
                "h-8 w-8 shrink-0 p-0 text-[var(--muted-foreground)] hover:bg-[var(--muted)]",
                open && "bg-[var(--muted)] text-[var(--primary)]"
              )
        )}
      >
        {isFab ? (
          avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatarUrl}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-sm font-bold">{initials}</span>
          )
        ) : (
          <Settings className="h-3.5 w-3.5" aria-hidden />
        )}
      </Button>
      {open && (
        <div
          className={cn(
            "z-50 w-[min(22rem,calc(100vw-1.25rem))] p-3.5",
            "max-h-[min(85vh,36rem)] overflow-y-auto overscroll-contain",
            "rounded-[var(--radius-xl)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow-md)]",
            isFab
              ? "absolute bottom-full left-0 mb-2"
              : "absolute right-0 mt-2"
          )}
          role="dialog"
          aria-label="Préférences"
          data-testid="preferences-dialog"
        >
          {prefsBody}
        </div>
      )}
    </div>
  );
}
