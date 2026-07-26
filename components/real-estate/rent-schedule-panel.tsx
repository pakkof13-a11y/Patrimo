"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson } from "@/app/lib/api-client";
import { cn, formatCurrency } from "@/app/lib/utils";

type PendingEntry = {
  assetId: string;
  propertyName: string;
  kind: "RENT" | "CHARGES";
  dueDate: string;
  amountEur: string;
  note: string;
};

/**
 * Échéances de loyers et charges à confirmer.
 *
 * Volontairement une liste à cocher et non une écriture automatique : un loyer
 * proposé n'est pas un loyer encaissé. Un locataire peut payer en retard,
 * partiellement, ou pas du tout — écrire d'office gonflerait la trésorerie
 * affichée d'argent jamais reçu.
 *
 * Le panneau disparaît quand il n'y a rien à confirmer, plutôt que d'occuper la
 * place avec un état vide qu'on finirait par ne plus voir.
 */
export function RentSchedulePanel({ className }: { className?: string }) {
  const qc = useQueryClient();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  const pendingQ = useQuery({
    queryKey: ["rent-schedule"],
    staleTime: 60_000,
    queryFn: () =>
      fetchJson<{ pending: PendingEntry[] }>("/api/real-estate/rent-schedule"),
  });

  const pending = useMemo(
    () => pendingQ.data?.pending ?? [],
    [pendingQ.data?.pending]
  );

  const selected = useMemo(
    () => pending.filter((p) => !excluded.has(p.note)),
    [pending, excluded]
  );

  const total = useMemo(
    () =>
      selected.reduce(
        (sum, p) => sum + (p.kind === "RENT" ? 1 : -1) * Number(p.amountEur),
        0
      ),
    [selected]
  );

  const confirm = useMutation({
    mutationFn: () =>
      fetchJson<{ created: number; skipped: number; errors: string[] }>(
        "/api/real-estate/rent-schedule",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entries: selected.map((p) => ({
              assetId: p.assetId,
              kind: p.kind,
              dueDate: p.dueDate,
            })),
          }),
        }
      ),
    onSuccess: (res) => {
      if (res.created > 0) {
        toast.success(
          `${res.created} écriture${res.created > 1 ? "s" : ""} enregistrée${res.created > 1 ? "s" : ""}`
        );
      }
      if (res.skipped > 0) {
        toast.info(`${res.skipped} déjà enregistrée(s), ignorée(s)`);
      }
      for (const err of res.errors) toast.error(err);
      setExcluded(new Set());
      void qc.invalidateQueries({ queryKey: ["rent-schedule"] });
      void qc.invalidateQueries({ queryKey: ["holdings"] });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible"),
  });

  if (pendingQ.isPending || pending.length === 0) return null;

  return (
    <div
      className={cn("card p-3.5 sm:p-4", className)}
      data-testid="rent-schedule-panel"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Échéances à confirmer</p>
          <p className="text-meta">
            {pending.length} échéance{pending.length > 1 ? "s" : ""} due
            {pending.length > 1 ? "s" : ""}
            {" — rien n'est enregistré tant que vous n'avez pas confirmé"}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary text-[11px]"
          disabled={selected.length === 0 || confirm.isPending}
          onClick={() => confirm.mutate()}
          data-testid="rent-confirm"
        >
          {confirm.isPending
            ? "Enregistrement…"
            : `Confirmer ${selected.length} écriture${selected.length > 1 ? "s" : ""} · ${formatCurrency(String(total), "EUR")}`}
        </button>
      </div>

      <ul className="mt-2.5 divide-y divide-[var(--border)]">
        {pending.map((p) => {
          const isExcluded = excluded.has(p.note);
          return (
            <li
              key={p.note}
              className={cn(
                "flex items-center gap-2.5 py-1.5 text-xs",
                isExcluded && "opacity-45"
              )}
            >
              <input
                type="checkbox"
                checked={!isExcluded}
                aria-label={`${p.kind === "RENT" ? "Loyer" : "Charges"} ${p.propertyName}`}
                onChange={() =>
                  setExcluded((prev) => {
                    const next = new Set(prev);
                    if (next.has(p.note)) next.delete(p.note);
                    else next.add(p.note);
                    return next;
                  })
                }
              />
              <span className="tabular-nums text-[var(--muted-foreground)]">
                {new Date(p.dueDate).toLocaleDateString("fr-FR")}
              </span>
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] font-medium",
                  p.kind === "RENT"
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                )}
              >
                {p.kind === "RENT" ? "Loyer" : "Charges"}
              </span>
              <span className="min-w-0 flex-1 truncate" title={p.propertyName}>
                {p.propertyName}
              </span>
              <span className="tabular-nums font-medium">
                {p.kind === "RENT" ? "+" : "−"}
                {formatCurrency(p.amountEur, "EUR")}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-meta mt-2">
        Décochez une échéance pour la reporter : elle vous sera proposée à
        nouveau tant qu&apos;elle n&apos;est pas confirmée.
      </p>
    </div>
  );
}
