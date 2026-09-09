"use client";

import { fetchJson } from "@/app/lib/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { currencyLabel } from "@/app/lib/money/currencies";
import { formatCurrency } from "@/app/lib/utils";
import { invalidatePortfolioView } from "@/app/lib/ui/invalidate-portfolio";
import { toast } from "sonner";

/**
 * Ce que la poche fait au patrimoine, dit par enveloppe.
 *
 * Une seule phrase pour les trois se tromperait deux fois sur trois : le
 * découvert est une situation réelle sur un compte-titres ordinaire — et le
 * patrimoine le compte avec son signe — alors qu'un compte espèces de PEA et
 * une assurance-vie ne peuvent pas être débiteurs, et que l'API refuse la
 * saisie (400). Promettre « avec son signe » sur ces deux-là annoncerait une
 * liberté que l'écran n'a pas.
 */
const AIDE_SOLDE: Record<"CTO" | "PEA" | "AV", string> = {
  CTO: "Défaut 0 — compté avec son signe, découvert compris",
  PEA: "Défaut 0 — compté dès qu'il est saisi ; un solde négatif est refusé",
  AV: "Défaut 0 — compté dès qu'il est saisi ; un solde négatif est refusé",
};

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
          /*
            `null` tant que la poche n'existe pas en base.

            Le GET a cessé de créer les trois lignes au passage — une lecture
            qui écrivait, et dont la seule trace suffisait à déclarer un
            patrimoine non vierge. `listEnvelopeCash` rend donc les trois
            enveloppes avec `id: null` pour celles qui n'ont pas encore de
            ligne ; ce type disait `string` et se trompait. Le champ n'est lu
            nulle part ici, mais un type faux finit toujours par être cru.
          */
          id: string | null;
          envelope: string;
          balance: string;
          currency: string;
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
      invalidatePortfolioView(qc);
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
        <p className="text-[11px] text-zinc-400">{AIDE_SOLDE[envelope]}</p>
      </div>
      <label className="text-xs">
        Solde
        <input
          className="input mt-1 w-36 tabular-nums"
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
          <input className="input mt-1 w-24" value="EUR" disabled readOnly />
        ) : (
          <select
            className="input mt-1 w-24"
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
      </div>
    </div>
  );
}
