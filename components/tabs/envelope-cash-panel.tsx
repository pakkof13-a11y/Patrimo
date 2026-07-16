"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { currencyLabel } from "@/app/lib/money/currencies";
import { formatCurrency } from "@/app/lib/utils";
import { toast } from "sonner";

/** Editable cash pocket for CTO / PEA / AV */
export function EnvelopeCashPanel({
  envelope,
  lockCurrencyToEur,
}: {
  envelope: "CTO" | "PEA" | "AV";
  lockCurrencyToEur?: boolean;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["envelopes"],
    queryFn: () =>
      fetchJson<{
        envelopes: Array<{
          id: string;
          envelope: string;
          balance: string;
          currency: string;
          countsInNetWorth: boolean;
        }>;
      }>("/api/envelopes"),
  });

  const row = (q.data?.envelopes || []).find((e) => e.envelope === envelope);

  async function save(patch: { balance?: string; currency?: string }) {
    try {
      await fetchJson("/api/envelopes", {
        method: "PUT",
        body: JSON.stringify({
          envelope,
          balance: patch.balance ?? row?.balance ?? "0",
          currency: lockCurrencyToEur ? "EUR" : patch.currency ?? row?.currency ?? "EUR",
        }),
      });
      await qc.invalidateQueries({ queryKey: ["envelopes"] });
      await qc.invalidateQueries({ queryKey: ["holdings"] });
      toast.success("Solde cash enregistré");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur");
    }
  }

  return (
    <div className="card mb-4 flex flex-wrap items-end gap-4 p-4">
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Solde cash ({envelope})
        </div>
        <p className="text-[11px] text-zinc-400">
          Défaut 0 — inclus dans le patrimoine seulement si &gt; 0
        </p>
      </div>
      <label className="text-xs">
        Solde
        <input
          className="input mt-1 !w-36 tabular-nums"
          key={row?.balance ?? "0"}
          defaultValue={row?.balance ?? "0"}
          onBlur={(e) => {
            if (e.target.value !== (row?.balance ?? "0")) {
              void save({ balance: e.target.value });
            }
          }}
        />
      </label>
      <label className="text-xs">
        Devise
        {lockCurrencyToEur ? (
          <input className="input mt-1 !w-24" value="EUR" disabled readOnly />
        ) : (
          <select
            className="input mt-1 !w-24"
            key={row?.currency ?? "EUR"}
            defaultValue={row?.currency ?? "EUR"}
            onChange={(e) => void save({ currency: e.target.value, balance: row?.balance })}
          >
            {["EUR", "USD", "CHF", "GBP"].map((c) => (
              <option key={c} value={c}>
                {currencyLabel(c)}
              </option>
            ))}
          </select>
        )}
      </label>
      <div className="text-sm">
        <span className="text-xs text-zinc-500">Affiché : </span>
        <span className="font-semibold tabular-nums">
          {formatCurrency(row?.balance ?? "0", row?.currency ?? "EUR")}
        </span>
        <span className="ml-2 text-[10px] text-zinc-400">
          {row?.countsInNetWorth ? "Inclus" : "Ignoré (0)"}
        </span>
      </div>
    </div>
  );
}
