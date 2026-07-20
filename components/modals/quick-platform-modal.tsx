"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { PlatformLogo } from "@/components/ui/platform-logo";
import { findPreset, primaryType } from "@/app/lib/platforms/presets";
import { fetchJson } from "@/app/lib/api-client";

export type CreatedPlatform = {
  id: string;
  name: string;
  type: string;
  logoUrl: string | null;
  created: boolean;
};

type Props = {
  open: boolean;
  /** Préremplit le nom (texte saisi dans le combobox) */
  prefillName?: string;
  onClose: () => void;
  onCreated: (platform: CreatedPlatform) => void;
  /**
   * Contexte d’appel — adapte le copy et le layering
   * (import = au-dessus de la modale d’import suspendue).
   */
  context?: "import" | "tx" | "standalone";
};

/**
 * Création contextuelle minimale : nom + logo URL optionnel.
 * Style aligné sur les modales premium de l’app.
 * layer=1 quand ouverte depuis l’import (premier plan).
 */
export function QuickPlatformModal({
  open,
  prefillName = "",
  onClose,
  onCreated,
  context = "standalone",
}: Props) {
  const [name, setName] = useState(prefillName);
  const [logoUrl, setLogoUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(prefillName || "");
    setLogoUrl("");
    setError(null);
    setPending(false);
  }, [open, prefillName]);

  if (!open) return null;

  const preset = name.trim().length >= 2 ? findPreset(name.trim()) : undefined;
  const previewLogo = logoUrl.trim() || preset?.logoUrl || null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (n.length < 2) {
      setError("Nom trop court (2 caractères min.)");
      return;
    }
    if (logoUrl.trim() && !/^https?:\/\//i.test(logoUrl.trim())) {
      setError("URL logo invalide (http/https)");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetchJson<{
        platform: {
          id: string;
          name: string;
          type: string;
          logoUrl: string | null;
        };
        created?: boolean;
      }>("/api/platforms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: n,
          type: preset ? primaryType(preset) : "AUTRE",
          logoKey: preset?.key || null,
          logoUrl: logoUrl.trim() || preset?.logoUrl || null,
          upsert: true,
        }),
      });
      onCreated({
        id: res.platform.id,
        name: res.platform.name,
        type: res.platform.type,
        logoUrl: res.platform.logoUrl,
        created: res.created !== false,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible");
    } finally {
      setPending(false);
    }
  }

  const fromImport = context === "import";

  return (
    <Modal
      title="Nouvelle plateforme"
      onClose={onClose}
      testId="quick-platform-modal"
      panelClassName="max-w-md"
      layer={fromImport || context === "tx" ? 1 : 0}
    >
      <form className="space-y-3" onSubmit={submit} data-testid="quick-platform-form">
        <p className="text-[11px] leading-relaxed text-[var(--muted-foreground)]">
          {fromImport
            ? "Étape prioritaire : créez la plateforme pour continuer l’import CSV. Le logo peut rester vide (suggestion auto si reconnue)."
            : "Création rapide pour rattacher une transaction. Vous pourrez enrichir le type, les notes et le logo plus tard dans Mes plateformes."}
        </p>

        <Field label="Nom de la plateforme">
          <input
            className="input w-full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex. Boursorama, Binance, Trade Republic…"
            autoComplete="off"
            data-testid="quick-platform-name"
            autoFocus
          />
          {preset && (
            <p className="mt-1 text-[11px] text-teal-800 dark:text-teal-200">
              Reconnue : {preset.name}
              {preset.logoUrl ? " · logo suggéré" : ""}
            </p>
          )}
        </Field>

        <Field label="URL du logo (optionnel)">
          <div className="flex items-center gap-2">
            <PlatformLogo src={previewLogo} name={name || "?"} size={32} />
            <input
              className="input min-w-0 flex-1"
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://… (laisser vide = suggestion auto)"
              autoComplete="off"
              data-testid="quick-platform-logo"
            />
          </div>
        </Field>

        {error && (
          <p
            className="rounded-lg bg-rose-950/40 px-3 py-2 text-xs text-rose-300"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Annuler
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={pending || name.trim().length < 2}
            data-testid="quick-platform-submit"
          >
            {pending ? "Création…" : "Créer et sélectionner"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
