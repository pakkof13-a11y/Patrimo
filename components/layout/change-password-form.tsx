"use client";

import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/app/lib/api-client";

/**
 * Formulaire « Changer mon mot de passe » — visible USER et ADMIN.
 * Exige le mot de passe actuel côté API.
 */
export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const mut = useMutation({
    mutationFn: () =>
      fetchJson<{ ok: boolean }>("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      }),
    onSuccess: () => {
      toast.success("Mot de passe mis à jour");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error("Nouveau mot de passe : 6 caractères minimum");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("La confirmation ne correspond pas");
      return;
    }
    mut.mutate();
  }

  return (
    <div data-testid="change-password-section">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        <KeyRound className="h-3.5 w-3.5" aria-hidden />
        Sécurité
      </div>
      <p className="text-meta mb-2">
        Modifiez le mot de passe de ce compte. L&apos;ancien reste requis.
      </p>
      <p className="mb-2 text-[11px] font-medium text-[var(--foreground)]">
        Changer mon mot de passe
      </p>
      <p className="mb-2 text-[11px] text-zinc-500 dark:text-slate-400">
        Saisissez votre mot de passe actuel, puis le nouveau (min. 6 caractères).
      </p>
      <form onSubmit={onSubmit} className="space-y-2" data-testid="change-password-form">
        <input
          className="input w-full !py-1.5 text-xs"
          type="password"
          placeholder="Mot de passe actuel"
          autoComplete="current-password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          data-testid="change-password-current"
          required
        />
        <input
          className="input w-full !py-1.5 text-xs"
          type="password"
          placeholder="Nouveau mot de passe"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          data-testid="change-password-new"
          required
          minLength={6}
        />
        <input
          className="input w-full !py-1.5 text-xs"
          type="password"
          placeholder="Confirmer le nouveau mot de passe"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          data-testid="change-password-confirm"
          required
          minLength={6}
        />
        <Button
          type="submit"
          size="sm"
          className="w-full"
          disabled={mut.isPending}
          data-testid="change-password-submit"
        >
          {mut.isPending ? "Mise à jour…" : "Enregistrer mon mot de passe"}
        </Button>
      </form>
    </div>
  );
}
