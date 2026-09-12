"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson } from "@/app/lib/api-client";
import { cn, formatCurrency } from "@/app/lib/utils";

type PendingCoupon = {
  assetId: string;
  supportName: string;
  lifeInsuranceId: string | null;
  observedOn: string;
  amountEur: string;
  couponBarrierPct: string | null;
  couponMemory: boolean;
  underlying: string | null;
  note: string;
};

/** Trois états possibles pour une constatation, tant qu'elle n'est pas envoyée. */
type Choice = "pending" | "paid" | "unpaid";

/**
 * Normalise une saisie de montant « à la française » avant envoi à l'API.
 *
 * L'API valide `amountEur` avec `/^\d+([.,]\d+)?$/` : un espace — normal ou
 * insécable, celui que `formatCurrency` utilise comme séparateur de
 * milliers — fait échouer cette regex, et donc **tout le lot** de décisions
 * groupées (le body entier est un seul schéma Zod). `null` : nettoyé mais
 * invalide (vide ou mal formé) ; l'appelant décide quoi en faire.
 */
function normalizeCouponAmount(raw: string): string | null {
  const cleaned = raw.replace(/\s/g, "").trim();
  if (cleaned === "" || !/^\d+([.,]\d+)?$/.test(cleaned)) return null;
  return cleaned;
}

/**
 * Constatations de coupon à trancher.
 *
 * ## Pourquoi trois états et non une case à cocher
 *
 * L'échéancier des loyers se contente d'une case : un loyer non confirmé reste
 * dû et revient au passage suivant. Un coupon, non. Si la barrière n'a pas été
 * franchie, il est perdu — le reproposer indéfiniment ferait croire à un revenu
 * en attente. Il faut donc pouvoir dire « non versé », ce qui clôt l'échéance
 * sans rien écrire au journal.
 *
 * L'application ne connaît pas le niveau du sous-jacent aux dates de
 * constatation : elle ne peut pas décider à la place de l'utilisateur. Elle
 * affiche la barrière et le montant théorique, il tranche.
 */
export function CouponSchedulePanel({ className }: { className?: string }) {
  const qc = useQueryClient();
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  const pendingQ = useQuery({
    queryKey: ["life-insurance-coupons"],
    staleTime: 60_000,
    queryFn: () =>
      fetchJson<{ pending: PendingCoupon[] }>("/api/life-insurance/coupons"),
  });

  const pending = useMemo(
    () => pendingQ.data?.pending ?? [],
    [pendingQ.data?.pending]
  );

  const decided = useMemo(
    () => pending.filter((p) => (choices[p.note] ?? "pending") !== "pending"),
    [pending, choices]
  );

  // Lignes « versé » dont le montant (saisi ou théorique) ne passe pas la
  // validation de l'API : identifiées une à une, plutôt qu'un échec de lot
  // silencieux qui ne dit pas laquelle est en cause.
  const invalidPaidRows = useMemo(
    () =>
      decided
        .filter((p) => choices[p.note] === "paid")
        .filter(
          (p) => normalizeCouponAmount(amounts[p.note] ?? p.amountEur) == null
        ),
    [decided, choices, amounts]
  );
  const invalidPaidNotes = useMemo(
    () => new Set(invalidPaidRows.map((p) => p.note)),
    [invalidPaidRows]
  );

  const paidTotal = useMemo(
    () =>
      decided
        .filter((p) => choices[p.note] === "paid")
        .reduce((sum, p) => {
          const normalized = normalizeCouponAmount(
            amounts[p.note] ?? p.amountEur
          );
          return sum + (normalized != null ? Number(normalized.replace(",", ".")) : 0);
        }, 0),
    [decided, choices, amounts]
  );

  const settle = useMutation({
    mutationFn: () =>
      fetchJson<{
        created: number;
        skipped: number;
        alreadySettled: number;
        errors: string[];
      }>("/api/life-insurance/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decisions: decided.map((p) => ({
            assetId: p.assetId,
            observedOn: p.observedOn,
            paid: choices[p.note] === "paid",
            amountEur:
              choices[p.note] === "paid"
                ? normalizeCouponAmount(amounts[p.note] ?? p.amountEur)
                : null,
          })),
        }),
      }),
    onSuccess: (res) => {
      if (res.created > 0) {
        toast.success(
          `${res.created} coupon${res.created > 1 ? "s" : ""} enregistré${res.created > 1 ? "s" : ""}`
        );
      }
      if (res.skipped > 0) {
        toast.info(
          `${res.skipped} constatation${res.skipped > 1 ? "s" : ""} marquée${res.skipped > 1 ? "s" : ""} non versée${res.skipped > 1 ? "s" : ""}`
        );
      }
      if (res.alreadySettled > 0) {
        toast.info(`${res.alreadySettled} déjà tranchée(s), ignorée(s)`);
      }
      for (const err of res.errors) toast.error(err);
      setChoices({});
      setAmounts({});
      void qc.invalidateQueries({ queryKey: ["life-insurance-coupons"] });
      void qc.invalidateQueries({ queryKey: ["holdings"] });
      void qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : "Enregistrement impossible"),
  });

  // Panneau absent plutôt que vide : un état vide permanent finit par ne plus
  // être lu, et masquerait les échéances le jour où il y en a.
  if (pendingQ.isPending || pending.length === 0) return null;

  return (
    <div
      className={cn("card p-3.5 sm:p-4", className)}
      data-testid="coupon-schedule-panel"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Constatations de coupon</p>
          <p className="text-meta">
            {pending.length} constatation{pending.length > 1 ? "s" : ""} échue
            {pending.length > 1 ? "s" : ""}
            {" — indiquez pour chacune si le coupon a été versé"}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary text-[11px]"
          disabled={
            decided.length === 0 ||
            settle.isPending ||
            invalidPaidRows.length > 0
          }
          onClick={() => settle.mutate()}
          data-testid="coupon-settle"
        >
          {settle.isPending
            ? "Enregistrement…"
            : `Enregistrer ${decided.length} décision${decided.length > 1 ? "s" : ""}${
                paidTotal > 0
                  ? ` · ${formatCurrency(String(paidTotal), "EUR")}`
                  : ""
              }`}
        </button>
      </div>

      {invalidPaidRows.length > 0 && (
        <p
          className="mt-1.5 text-[11px] text-[var(--danger)]"
          role="alert"
          data-testid="coupon-amount-error"
        >
          Montant invalide pour {invalidPaidRows.length} ligne
          {invalidPaidRows.length > 1 ? "s" : ""} :{" "}
          {invalidPaidRows.map((p) => p.supportName).join(", ")} — un nombre
          est attendu (virgule décimale acceptée, sans espace).
        </p>
      )}

      <ul className="mt-2.5 divide-y divide-[var(--border)]">
        {pending.map((p) => {
          const choice = choices[p.note] ?? "pending";
          return (
            <li
              key={p.note}
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 py-2 text-xs"
              data-testid="coupon-row"
            >
              <span className="tabular-nums text-[var(--muted-foreground)]">
                {new Date(p.observedOn).toLocaleDateString("fr-FR")}
              </span>
              <span
                className="min-w-0 flex-1 truncate"
                aria-label={p.supportName}
                title={p.supportName}
              >
                {p.supportName}
                {p.underlying ? (
                  <span className="text-[var(--muted-foreground)]">
                    {" · "}
                    {p.underlying}
                  </span>
                ) : null}
              </span>

              {p.couponBarrierPct && (
                <span
                  className="group relative text-meta shrink-0"
                  tabIndex={0}
                  aria-label={`barrière ${p.couponBarrierPct} % — le coupon n'est versé que si le sous-jacent est au-dessus de cette barrière`}
                >
                  barrière {p.couponBarrierPct} %
                  <span
                    className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 w-48 -translate-x-1/2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-left text-[length:var(--text-2xs)] font-normal leading-snug text-[var(--foreground-secondary)] opacity-0 shadow-lg transition group-hover:opacity-100 group-focus:opacity-100 motion-reduce:transition-none"
                    role="tooltip"
                  >
                    Le coupon n&apos;est versé que si le sous-jacent est
                    au-dessus de cette barrière
                  </span>
                </span>
              )}
              {p.couponMemory && (
                <span
                  className="group relative shrink-0 rounded bg-stone-500/10 px-1.5 py-0.5 text-[10px] font-medium text-stone-700 dark:text-stone-300"
                  tabIndex={0}
                  aria-label="mémoire — un coupon non versé se rattrape à une constatation ultérieure favorable"
                >
                  mémoire
                  <span
                    className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 w-48 -translate-x-1/2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-left text-[length:var(--text-2xs)] font-normal leading-snug text-[var(--foreground-secondary)] opacity-0 shadow-lg transition group-hover:opacity-100 group-focus:opacity-100 motion-reduce:transition-none"
                    role="tooltip"
                  >
                    Un coupon non versé se rattrape à une constatation
                    ultérieure favorable
                  </span>
                </span>
              )}

              {choice === "paid" ? (
                <input
                  // Classe statique volontairement inchangée : le harnais
                  // `tests/unit/input-cascade.test.ts` relève les combinaisons
                  // `className="…input…"` telles qu'écrites dans le dépôt.
                  // L'état invalide passe par `style` (jetons couleur), jamais
                  // par une classe supplémentaire ici.
                  className="input w-24 text-right text-xs"
                  style={
                    invalidPaidNotes.has(p.note)
                      ? { borderColor: "var(--danger)", color: "var(--danger)" }
                      : undefined
                  }
                  inputMode="decimal"
                  aria-label={`Montant reçu pour ${p.supportName}`}
                  aria-invalid={invalidPaidNotes.has(p.note)}
                  data-testid="coupon-amount"
                  value={amounts[p.note] ?? p.amountEur}
                  onChange={(e) =>
                    setAmounts((prev) => ({ ...prev, [p.note]: e.target.value }))
                  }
                />
              ) : (
                <span className="tabular-nums shrink-0 font-medium">
                  {formatCurrency(p.amountEur, "EUR")}
                </span>
              )}

              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                    choice === "paid"
                      ? "bg-[var(--success)] text-white"
                      : "border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  )}
                  aria-pressed={choice === "paid"}
                  data-testid="coupon-paid"
                  onClick={() =>
                    setChoices((prev) => ({
                      ...prev,
                      [p.note]: choice === "paid" ? "pending" : "paid",
                    }))
                  }
                >
                  Versé
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                    choice === "unpaid"
                      ? "bg-[var(--muted-foreground)] text-white"
                      : "border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  )}
                  aria-pressed={choice === "unpaid"}
                  data-testid="coupon-unpaid"
                  onClick={() =>
                    setChoices((prev) => ({
                      ...prev,
                      [p.note]: choice === "unpaid" ? "pending" : "unpaid",
                    }))
                  }
                >
                  Non versé
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="text-meta mt-2">
        « Non versé » clôt la constatation sans rien inscrire au journal : un
        coupon dont la barrière n&apos;a pas été franchie est perdu, il ne
        reviendra pas — sauf effet mémoire, qui le rattrapera sur une
        constatation ultérieure.
      </p>
    </div>
  );
}
