"use client";

import { useEffect, useRef, useState } from "react";
import { fetchJson } from "@/app/lib/api-client";
import { useDebouncedValue } from "@/app/hooks/use-debounced-value";
import { cn } from "@/app/lib/utils";
import type { GeocodeOutcome, GeocodeResult } from "@/app/lib/real-estate/geocode";

/**
 * Champ « Adresse » avec suggestion BAN en debounce.
 *
 * S'appuie sur `geocodeAddress` déjà existant (via la route fine
 * `/api/real-estate/geocode`) — un seul meilleur résultat par requête, pas
 * une liste : c'est ce que l'API sert déjà pour l'estimation DVF, inutile
 * d'en réclamer une autre forme ici.
 *
 * Le champ reste un simple texte libre tant que rien n'est sélectionné :
 * aucune contrainte de saisie n'est imposée, la suggestion n'est qu'une
 * proposition à confirmer.
 */
export function AddressAutocomplete({
  id,
  testId,
  value,
  onChangeValue,
  postalCode,
  city,
  onSelect,
  placeholder,
}: {
  id?: string;
  testId?: string;
  /** Valeur affichée du champ adresse — contrôlée par le parent. */
  value: string;
  onChangeValue: (v: string) => void;
  /** Contexte pour lever les ambiguïtés (même rue dans deux communes). */
  postalCode?: string;
  city?: string;
  /** Appelé quand l'utilisateur retient une suggestion (BAN ou approximative). */
  onSelect: (result: GeocodeResult) => void;
  placeholder?: string;
}) {
  const [outcome, setOutcome] = useState<GeocodeOutcome | null>(null);
  const [loading, setLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  /** Adresse du dernier point retenu — évite de re-suggérer juste après un choix. */
  const lastPicked = useRef<string | null>(null);

  const debounced = useDebouncedValue(value, 400);

  useEffect(() => {
    const query = debounced.trim();
    if (query.length < 3 || query === lastPicked.current) {
      setOutcome(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    fetchJson<GeocodeOutcome>("/api/real-estate/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addressLine: query, postalCode, city }),
      signal: controller.signal,
    })
      .then((out) => {
        if (controller.signal.aborted) return;
        setOutcome(out);
      })
      .catch((e) => {
        if (controller.signal.aborted) return;
        setOutcome({
          kind: "unavailable",
          error: e instanceof Error ? e.message : "Géocodage indisponible",
        });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- postalCode/city ne servent qu'à désambiguïser, pas à redéclencher la recherche seuls
  }, [debounced]);

  function pick(result: GeocodeResult) {
    lastPicked.current = result.label;
    onChangeValue(result.label);
    onSelect(result);
    setOutcome(null);
    setPanelOpen(false);
  }

  const showPanel = panelOpen && (loading || outcome != null);

  return (
    <div className="relative">
      <input
        id={id}
        data-testid={testId}
        className="input mt-1 w-full"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChangeValue(e.target.value)}
        onFocus={() => setPanelOpen(true)}
        // Délai avant fermeture : laisse le clic sur une suggestion s'exécuter
        // avant que le blur ne démonte le panneau.
        onBlur={() => setTimeout(() => setPanelOpen(false), 150)}
      />

      {showPanel && (
        <div
          className="absolute z-10 mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--card)] p-2 text-xs shadow-md"
          data-testid={testId ? `${testId}-suggestions` : undefined}
        >
          {loading && (
            <p className="text-meta">Recherche de l&apos;adresse…</p>
          )}

          {!loading && outcome?.kind === "ok" && (
            <button
              type="button"
              className="block w-full rounded px-1.5 py-1 text-left hover:bg-[var(--muted)]"
              data-testid={testId ? `${testId}-suggestion-ok` : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(outcome.result)}
            >
              {outcome.result.label}
            </button>
          )}

          {!loading && outcome?.kind === "low-confidence" && (
            <div>
              <button
                type="button"
                className={cn(
                  "block w-full rounded px-1.5 py-1 text-left hover:bg-[var(--muted)]",
                  "text-amber-700 dark:text-amber-400"
                )}
                data-testid={testId ? `${testId}-suggestion-low` : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(outcome.best)}
              >
                {outcome.best.label}
              </button>
              <p className="text-meta px-1.5 pb-0.5">
                Confiance faible ({Math.round(outcome.best.score * 100)} %) —
                vérifiez avant de valider.
              </p>
            </div>
          )}

          {!loading && outcome?.kind === "not-found" && (
            <p className="text-meta px-1.5 py-0.5">
              Adresse introuvable dans la Base Adresse Nationale — vérifiez la
              saisie ou complétez-la manuellement.
            </p>
          )}

          {!loading && outcome?.kind === "unavailable" && (
            <p className="text-meta px-1.5 py-0.5">
              Service de géocodage indisponible pour le moment — vous pouvez
              continuer la saisie manuellement.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
