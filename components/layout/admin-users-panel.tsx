"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fetchJson } from "@/app/lib/api-client";

type AdminUser = {
  id: string;
  username: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string;
};

export function AdminUsersPanel() {
  const qc = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"USER" | "ADMIN">("USER");

  const usersQ = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => fetchJson<{ users: AdminUser[] }>("/api/admin/users"),
    staleTime: 15_000,
  });

  const createMut = useMutation({
    mutationFn: () =>
      fetchJson<{ user: AdminUser }>("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role }),
      }),
    onSuccess: async () => {
      toast.success("Utilisateur créé");
      setUsername("");
      setPassword("");
      setRole("USER");
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetMut = useMutation({
    mutationFn: (body: { userId: string; password: string }) =>
      fetchJson<{ ok: boolean }>("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => toast.success("Mot de passe mis à jour"),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ ok: boolean }>(
        `/api/admin/users?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      ),
    onSuccess: async () => {
      toast.success("Utilisateur supprimé");
      await qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || password.length < 6) {
      toast.error("Identifiant et mot de passe (6+ caractères) requis");
      return;
    }
    createMut.mutate();
  }

  function handleReset(u: AdminUser) {
    const pwd = window.prompt(
      `Nouveau mot de passe pour « ${u.username} » (min. 6 caractères) :`
    );
    if (!pwd) return;
    if (pwd.length < 6) {
      toast.error("Mot de passe trop court");
      return;
    }
    resetMut.mutate({ userId: u.id, password: pwd });
  }

  function handleDelete(u: AdminUser) {
    if (
      !window.confirm(
        `Supprimer le compte « ${u.username} » et toutes ses données patrimoine ?`
      )
    ) {
      return;
    }
    deleteMut.mutate(u.id);
  }

  return (
    <div
      className="mt-4 border-t border-[var(--border)] pt-3"
      data-testid="admin-users-panel"
    >
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
        <Users className="h-3.5 w-3.5" />
        Administration
      </div>
      <p className="mb-2 text-[11px] text-zinc-500 dark:text-slate-400">
        SuperUser — création de comptes, liste et réinitialisation des mots de
        passe. Les données de chaque utilisateur sont isolées.
      </p>

      <form onSubmit={handleCreate} className="mb-3 space-y-2 rounded-lg border border-[var(--border)] p-2">
        <div className="flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300">
          <UserPlus className="h-3.5 w-3.5" />
          Nouvel utilisateur
        </div>
        <input
          className="input w-full !py-1.5 text-xs"
          placeholder="Identifiant"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          data-testid="admin-create-username"
          autoComplete="off"
        />
        <input
          className="input w-full !py-1.5 text-xs"
          type="password"
          placeholder="Mot de passe"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          data-testid="admin-create-password"
          autoComplete="new-password"
        />
        <select
          className="input w-full !py-1.5 text-xs"
          value={role}
          onChange={(e) => setRole(e.target.value as "USER" | "ADMIN")}
          data-testid="admin-create-role"
        >
          <option value="USER">USER — compte isolé</option>
          <option value="ADMIN">ADMIN — SuperUser</option>
        </select>
        <Button
          type="submit"
          size="sm"
          className="w-full"
          disabled={createMut.isPending}
          data-testid="admin-create-submit"
        >
          {createMut.isPending ? "Création…" : "Créer le compte"}
        </Button>
      </form>

      <div className="text-[11px] font-medium text-slate-600 dark:text-slate-300">
        Comptes ({usersQ.data?.users.length ?? "…"})
      </div>
      {usersQ.isError && (
        <p className="mt-1 text-[11px] text-rose-500">
          Impossible de charger la liste.
        </p>
      )}
      <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto">
        {(usersQ.data?.users ?? []).map((u) => (
          <li
            key={u.id}
            className="flex items-center justify-between gap-1 rounded-md border border-[var(--border)] px-2 py-1.5 text-[11px]"
            data-testid={`admin-user-${u.username}`}
          >
            <div className="min-w-0">
              <div className="truncate font-semibold">{u.username}</div>
              <div className="text-[10px] text-slate-400">
                {u.role}
                {u.name ? ` · ${u.name}` : ""}
              </div>
            </div>
            <div className="flex shrink-0 gap-0.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                title="Réinitialiser le mot de passe"
                onClick={() => handleReset(u)}
                data-testid={`admin-reset-${u.username}`}
              >
                <KeyRound className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                title="Supprimer"
                onClick={() => handleDelete(u)}
                data-testid={`admin-delete-${u.username}`}
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-500" />
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
