"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PanelLeft, Settings, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/app/lib/utils";
import { fetchJson } from "@/app/lib/api-client";
import {
  LAYOUT_WIDTH_OPTIONS,
  useDisplay,
} from "@/components/layout/display-provider";
import type { LayoutWidthMode } from "@/app/lib/display-preferences";
import { AdminUsersPanel } from "@/components/layout/admin-users-panel";
import { ChangePasswordForm } from "@/components/layout/change-password-form";

/**
 * Panneau unique « Préférences » :
 * - Affichage, changement de mot de passe (tous)
 * - Admin : gestion des comptes (ADMIN seulement)
 * - Zone danger (effacer ses données)
 */
export function PreferencesPanel() {
  const { layoutWidth, setLayoutWidth } = useDisplay();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

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
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const id = window.setTimeout(() => {
      document.addEventListener("mousedown", onDoc);
    }, 50);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open]);



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
          "Base de données utilisateur réinitialisée — portefeuille vide"
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
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleClearAll() {
    const step1 = window.confirm(
      "Réinitialiser la base de données utilisateur ?\n\nToutes vos saisies seront effacées (transactions, positions, plateformes, banques, passifs, AV, épargne salariale, alternatifs…). Le compte de connexion est conservé."
    );
    if (!step1) return;

    const step2 = window.confirm(
      "Dernière confirmation : action irréversible. Revenir à un portefeuille totalement vide ?"
    );
    if (!step2) return;

    clearMut.mutate();
  }

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="outline"
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
      >
        <Settings className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Préférences</span>
      </Button>
      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-80 max-h-[min(80vh,32rem)] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 shadow-xl"
          role="dialog"
          aria-label="Préférences"
          data-testid="preferences-dialog"
        >
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Settings className="h-4 w-4 text-teal-600" />
            Préférences
          </div>
          {meQ.data?.user && (
            <p className="mb-2 text-[11px] text-slate-500">
              Connecté :{" "}
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {meQ.data.user.username || meQ.data.user.id}
              </span>
              {meQ.data.user.role === "ADMIN" && (
                <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  ADMIN
                </span>
              )}
            </p>
          )}

          {/* ── Affichage ─────────────────────────────────────────────── */}
          <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <PanelLeft className="h-3.5 w-3.5" />
            Affichage
          </div>
          <p className="mb-2 text-[11px] text-zinc-500 dark:text-slate-400">
            Conteneur fluide (95 % de l&apos;écran, plafonné par le mode choisi). Les
            tableaux s&apos;étirent avec les colonnes visibles ; le scroll horizontal
            n&apos;apparaît que si nécessaire.
          </p>
          <div className="space-y-2" data-testid="display-settings">
            {LAYOUT_WIDTH_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  setLayoutWidth(opt.id as LayoutWidthMode);
                }}
                className={cn(
                  "w-full rounded-lg border px-3 py-2 text-left transition",
                  layoutWidth === opt.id
                    ? "border-teal-600 bg-teal-50 dark:border-teal-500 dark:bg-teal-950/40"
                    : "border-[var(--border)] hover:bg-[var(--muted)]"
                )}
              >
                <div className="text-sm font-medium">{opt.label}</div>
                <div className="text-[11px] text-zinc-500 dark:text-slate-400">
                  {opt.description}
                </div>
              </button>
            ))}
          </div>

          {/* ── Mot de passe personnel (USER + ADMIN) ─────────────────── */}
          <ChangePasswordForm />

          {/* ── SuperUser uniquement ──────────────────────────────────── */}
          {isAdmin && <AdminUsersPanel />}

          {/* ── Zone danger ───────────────────────────────────────────── */}
          <div className="mt-4 border-t border-[var(--border)] pt-3">
            <p className="mb-2 text-[11px] leading-snug text-zinc-500 dark:text-slate-400">
              Efface <strong className="font-medium">uniquement vos</strong>{" "}
              données (userId de session) : transactions, positions, plateformes,
              banques, livrets, AV, passifs, épargne, alternatifs, cash
              enveloppes, historique. Les autres comptes restent intacts.
            </p>
            <Button
              type="button"
              variant="danger"
              size="sm"
              className="w-full"
              data-testid="clear-all-transactions"
              disabled={clearMut.isPending}
              onClick={handleClearAll}
            >
              <Trash2 className="h-3.5 w-3.5" />
              {clearMut.isPending
                ? "Réinitialisation…"
                : "Réinitialiser la base de données utilisateur"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
