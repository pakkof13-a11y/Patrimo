"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Lock, Plus, Unlock } from "lucide-react";
import { fetchJson } from "@/app/lib/api-client";
import { EmptyPlaceholder, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/app/lib/utils";
import { d } from "@/app/lib/money/decimal";
import {
  eligibleAccounts,
  SECURITIES_ENVELOPE_TYPES,
} from "@/app/lib/securities/constants";
import { peaWithdrawalTax } from "@/app/lib/securities/pea";

type RoomRow = {
  ownCapEur: string;
  contributionsEur: string;
  combinedContributionsEur: string;
  remainingEur: string;
  overCapEur: string;
  usedPct: string;
  isOverCap: boolean;
  bindingCap: "OWN" | "COMBINED";
};

type AccountRow = {
  id: string;
  envelopeType: string;
  envelopeLabel: string;
  platformId: string;
  platformName: string;
  platformLogoUrl: string | null;
  openDate: string;
  iban: string | null;
  notes: string | null;
  positionCount: number;
  marketValueEur: string;
  costBasisEur: string;
  unrealizedPnlEur: string;
  unrealizedPnlPct: string | null;
  cashEur: string;
  cashAttributed: boolean;
  liquidationValueEur: string;
  contributionsEur: string;
  withdrawalsEur: string;
  gainEur: string;
  maturity: {
    maturityDate: string;
    isMatured: boolean;
    ageYears: number;
    daysToMaturity: number;
  } | null;
  room: RoomRow | null;
  taxStatusLabel: string | null;
};

type PositionRow = {
  assetId: string;
  securitiesAccountId: string | null;
  accountType: string;
  name: string;
  ticker: string | null;
  category: string;
  marketValueEur: string;
  unitCostBasisEur: string | null;
  priceEur: string;
  unrealizedPnlEur: string;
  unrealizedPnlPct: string | null;
};

type SecuritiesResponse = {
  accounts: AccountRow[];
  positions: PositionRow[];
  summary: {
    marketValueEur: string;
    unrealizedPnlEur: string;
    unrealizedPnlPct: string | null;
    positionCount: number;
    accountCount: number;
  };
};

type PlatformRow = { id: string; name: string; type?: string | null };

function num(v: string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const emptyForm = {
  envelopeType: "PEA",
  platformId: "",
  openDate: new Date().toISOString().slice(0, 10),
  notes: "",
};

/**
 * Jauge de plafond de versement.
 *
 * Le dépassement reste visible — la barre est bornée à 100 % pour ne pas
 * déborder, mais le pourcentage réel s'affiche. Quand c'est le plafond commun
 * PEA + PEA-PME qui borne, on le dit : un PEA-PME vide dont la place est
 * limitée à 75 000 € l'est par le plafond commun, pas par le sien, et sans
 * cette phrase le chiffre paraît faux.
 */
function ContributionGauge({ room }: { room: RoomRow }) {
  const pct = num(room.usedPct);
  const alert = room.isOverCap || pct >= 95;
  // La barre mesure le plafond qui borne réellement. Quand c'est le plafond
  // commun, le montant affiché doit être celui des deux plans réunis : sinon un
  // PEA-PME vide montrerait « 0 € » au-dessus d'une barre déjà entamée par le
  // PEA, et le chiffre contredirait le dessin.
  const isCombined = room.bindingCap === "COMBINED";
  return (
    <div className="mt-2" data-testid="securities-room-gauge">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
          {isCombined ? "Versements PEA + PEA-PME" : "Versements"}
        </span>
        <span className="text-xs font-medium tabular-nums">
          {formatCurrency(
            isCombined ? room.combinedContributionsEur : room.contributionsEur,
            "EUR"
          )}
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--muted)]">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            alert ? "bg-[var(--danger)]" : "bg-emerald-500"
          )}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <p
        className={cn(
          "mt-0.5 text-[10px]",
          alert
            ? "font-medium text-[var(--danger)]"
            : "text-[var(--muted-foreground)]"
        )}
        data-testid="securities-room-caption"
      >
        {room.isOverCap ? (
          <>Plafond dépassé de {formatCurrency(room.overCapEur, "EUR")}</>
        ) : (
          <>
            {formatCurrency(room.remainingEur, "EUR")} de versement encore
            possible
          </>
        )}
        {room.bindingCap === "COMBINED" && (
          <> — limité par le plafond commun PEA + PEA-PME de 225 000 €</>
        )}
      </p>
    </div>
  );
}

/**
 * Simulateur de retrait — calculé dans le navigateur.
 *
 * `peaWithdrawalTax` est une fonction pure sans accès Prisma : la simulation
 * n'a donc pas à faire d'aller-retour serveur, et le résultat suit la saisie
 * immédiatement.
 */
function WithdrawalSimulator({ account }: { account: AccountRow }) {
  const [amount, setAmount] = useState("");

  const result = useMemo(() => {
    if (!amount.trim() || !account.maturity) return null;
    return peaWithdrawalTax({
      liquidationValueEur: d(account.liquidationValueEur),
      contributionsEur: d(account.contributionsEur),
      withdrawalAmountEur: d(amount.replace(",", ".")),
      isMatured: account.maturity.isMatured,
    });
  }, [amount, account]);

  return (
    <div
      className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--muted)]/20 p-2.5"
      data-testid="securities-withdrawal-simulator"
    >
      <label className="text-meta block">
        Simuler un retrait (€)
        <input
          inputMode="decimal"
          className="input mt-1 w-full"
          placeholder="10 000"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          data-testid="securities-withdrawal-amount"
        />
      </label>

      {amount.trim() && !result && (
        <p className="text-meta mt-1.5 text-[var(--danger)]">
          Montant supérieur à la valeur du plan, ou saisie invalide.
        </p>
      )}

      {result && (
        <div className="mt-2 space-y-1 text-xs" data-testid="securities-withdrawal-result">
          <div className="flex justify-between">
            <span className="text-[var(--muted-foreground)]">
              Gain contenu dans le retrait
            </span>
            <span className="tabular-nums">
              {formatCurrency(result.taxableGainEur.toFixed(2), "EUR")}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted-foreground)]">
              Impôt sur le revenu (12,8 %)
            </span>
            <span className="tabular-nums">
              {formatCurrency(result.incomeTaxEur.toFixed(2), "EUR")}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--muted-foreground)]">
              Prélèvements sociaux (17,2 %)
            </span>
            <span className="tabular-nums">
              {formatCurrency(result.socialChargesEur.toFixed(2), "EUR")}
            </span>
          </div>
          <div className="flex justify-between border-t border-[var(--border)] pt-1 font-medium">
            <span>Net perçu</span>
            <span className="tabular-nums">
              {formatCurrency(result.netWithdrawalEur.toFixed(2), "EUR")}
            </span>
          </div>
          {result.closesPea && (
            <p className="flex items-start gap-1.5 rounded-[var(--radius-md)] border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-2 py-1.5 text-[10px] text-[var(--warning)]">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>
                Avant 5 ans, un retrait entraîne en principe la clôture du plan.
                Des exceptions existent (licenciement, invalidité, retraite
                anticipée, création d&apos;entreprise) : elles dépendent de
                votre situation et ne sont pas présumées ici.
              </span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Comptes titres — PEA, PEA-PME et compte-titres ordinaire.
 *
 * Ce que cet onglet montre et que le tableau Positions ne pouvait pas montrer :
 * l'antériorité fiscale du plan, le plafond de versement restant, et ce qu'un
 * retrait coûterait réellement. Un PEA ne s'impose pas ligne par ligne comme un
 * compte-titres — seul le retrait est un fait générateur.
 */
export function SecuritiesTab({ className }: { className?: string }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [openAccountId, setOpenAccountId] = useState<string | null>(null);
  const [contribAmount, setContribAmount] = useState("");
  const [contribDate, setContribDate] = useState(
    new Date().toISOString().slice(0, 10)
  );

  const q = useQuery({
    queryKey: ["securities"],
    queryFn: () => fetchJson<SecuritiesResponse>("/api/securities"),
  });

  const platformsQ = useQuery({
    queryKey: ["platforms"],
    queryFn: () => fetchJson<{ platforms: PlatformRow[] }>("/api/platforms"),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["securities"] });
    void qc.invalidateQueries({ queryKey: ["holdings"] });
    void qc.invalidateQueries({ queryKey: ["portfolio"] });
  };

  const createAccount = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/securities/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          envelopeType: form.envelopeType,
          platformId: form.platformId,
          openDate: form.openDate,
          notes: form.notes || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Ouverture impossible");
      return json;
    },
    onSuccess: () => {
      toast.success("Compte enregistré");
      setForm(emptyForm);
      setShowForm(false);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const attachPosition = useMutation({
    mutationFn: async (vars: {
      assetId: string;
      securitiesAccountId: string | null;
    }) => {
      const res = await fetch("/api/securities/positions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Rattachement impossible");
      return json;
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Rattachement groupé.
   *
   * Les requêtes sont enchaînées et non parallélisées : elles écrivent toutes
   * sur `Asset`, et le gain de quelques centaines de millisecondes ne vaut pas
   * un lot d'écritures concurrentes dont on ne saurait pas dire lesquelles ont
   * abouti en cas d'échec partiel.
   */
  const attachAll = useMutation({
    mutationFn: async (vars: { assetIds: string[]; accountId: string }) => {
      let attached = 0;
      for (const assetId of vars.assetIds) {
        const res = await fetch("/api/securities/positions", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            assetId,
            securitiesAccountId: vars.accountId,
          }),
        });
        if (res.ok) attached += 1;
      }
      return { attached, total: vars.assetIds.length };
    },
    onSuccess: ({ attached, total }) => {
      toast.success(
        attached === total
          ? `${attached} ligne(s) rattachée(s)`
          : `${attached} ligne(s) sur ${total} rattachée(s)`
      );
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addContribution = useMutation({
    mutationFn: async (accountId: string) => {
      const res = await fetch(
        `/api/securities/accounts/${accountId}/contributions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "DEPOSIT",
            amountEur: contribAmount,
            occurredAt: contribDate,
          }),
        }
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Enregistrement impossible");
      return json;
    },
    onSuccess: () => {
      toast.success("Versement enregistré");
      setContribAmount("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Mémoïsés : un `?? []` nu produirait un tableau neuf à chaque rendu, ce qui
  // ferait recalculer les `useMemo` en aval sans qu'aucune donnée ait changé.
  const accounts = useMemo(() => q.data?.accounts ?? [], [q.data]);
  const positions = useMemo(() => q.data?.positions ?? [], [q.data]);
  const summary = q.data?.summary;
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  /**
   * Lignes détenues mais rattachées à aucun compte.
   *
   * Ce n'est pas cosmétique : une ligne non rattachée ne compte pas dans la
   * valeur liquidative du compte, donc pas non plus dans la simulation de
   * retrait — dont le résultat serait alors sous-évalué sans que rien ne
   * l'indique. D'où le bandeau, et la proposition de rattachement groupé
   * lorsqu'un seul compte peut les recevoir.
   */
  const unattached = useMemo(
    () => positions.filter((p) => !p.securitiesAccountId),
    [positions]
  );

  const bulkTargets = useMemo(() => {
    const groups = new Map<string, { accountId: string; assetIds: string[] }>();
    for (const p of unattached) {
      const options = eligibleAccounts(p.accountType, accounts);
      // Uniquement quand la destination ne fait aucun doute : avec deux CTO,
      // c'est à l'utilisateur de dire lequel détient quoi.
      if (options.length !== 1) continue;
      const target = options[0]!;
      const entry = groups.get(target.id) ?? {
        accountId: target.id,
        assetIds: [],
      };
      entry.assetIds.push(p.assetId);
      groups.set(target.id, entry);
    }
    return [...groups.values()].map((g) => ({
      ...g,
      account: accounts.find((a) => a.id === g.accountId)!,
    }));
  }, [unattached, accounts]);

  if (q.isPending) {
    return <Skeleton className={cn("h-64 w-full", className)} />;
  }

  return (
    <section
      className={cn("card p-4", className)}
      data-testid="securities-panel"
    >
      <PanelHeader
        title="PEA & CTO"
        subtitle="Comptes titres — antériorité fiscale, plafond de versement et valorisation issue du journal"
        actions={
          <Button
            type="button"
            variant={showForm ? "outline" : "default"}
            onClick={() => setShowForm((v) => !v)}
            data-testid="securities-form-toggle"
          >
            {showForm ? "Annuler" : "Ajouter un compte"}
          </Button>
        }
      />

      {showForm && (
        <div
          className="mt-3 rounded-[var(--radius-md)] border border-[var(--primary)]/20 bg-[var(--primary-soft)] p-3"
          data-testid="securities-form"
        >
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-meta block">
              Type de compte
              <select
                className="input mt-1 w-full"
                value={form.envelopeType}
                onChange={(e) => set("envelopeType", e.target.value)}
                data-testid="securities-envelope-type"
              >
                {Object.entries(SECURITIES_ENVELOPE_TYPES).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-meta block">
              Courtier
              <select
                className="input mt-1 w-full"
                value={form.platformId}
                onChange={(e) => set("platformId", e.target.value)}
                data-testid="securities-platform"
              >
                <option value="">— choisir —</option>
                {(platformsQ.data?.platforms ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-meta block">
              Date d&apos;ouverture
              <input
                type="date"
                className="input mt-1 w-full"
                value={form.openDate}
                onChange={(e) => set("openDate", e.target.value)}
                data-testid="securities-open-date"
              />
            </label>

            <label className="text-meta block">
              Notes
              <input
                className="input mt-1 w-full"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </label>
          </div>

          <p className="text-meta mt-2">
            La date d&apos;ouverture détermine l&apos;antériorité fiscale du
            plan : c&apos;est elle qui fixe la date des 5 ans, au-delà de
            laquelle un retrait cesse d&apos;être soumis à l&apos;impôt sur le
            revenu.
          </p>

          <div className="mt-3">
            <Button
              type="button"
              disabled={!form.platformId || createAccount.isPending}
              onClick={() => createAccount.mutate()}
              data-testid="securities-submit"
            >
              {createAccount.isPending ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </div>
      )}

      {accounts.length === 0 ? (
        <EmptyPlaceholder
          compact
          title="Aucun compte titres"
          description="Déclarez votre PEA ou vos comptes-titres pour suivre leur antériorité fiscale, leur plafond de versement et leur valorisation."
        />
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Valeur titres", value: summary?.marketValueEur, strong: true },
              { label: "P&L latent", value: summary?.unrealizedPnlEur },
            ].map((k) => (
              <div
                key={k.label}
                className={cn(
                  "rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2",
                  k.strong && "bg-[var(--muted)]/40"
                )}
              >
                <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                  {k.label}
                </p>
                <p
                  className={cn(
                    "mt-0.5 tabular-nums",
                    k.strong ? "text-sm font-semibold" : "text-xs font-medium",
                    !k.strong &&
                      (num(k.value) < 0
                        ? "text-[var(--danger)]"
                        : "text-[var(--success)]")
                  )}
                >
                  {formatCurrency(k.value ?? "0", "EUR")}
                </p>
              </div>
            ))}
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                Comptes
              </p>
              <p className="mt-0.5 text-xs font-medium tabular-nums">
                {summary?.accountCount ?? 0}
              </p>
            </div>
            <div className="rounded-[var(--radius-md)] border border-[var(--border)] px-2.5 py-2">
              <p className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                Lignes
              </p>
              <p className="mt-0.5 text-xs font-medium tabular-nums">
                {summary?.positionCount ?? 0}
              </p>
            </div>
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {accounts.map((a) => {
              const isOpen = openAccountId === a.id;
              return (
                <div
                  key={a.id}
                  className="rounded-[var(--radius-md)] border border-[var(--border)] p-3"
                  data-testid="securities-account-card"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="rounded-full border border-[var(--primary)]/40 bg-[var(--primary-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--primary)]"
                          data-testid="securities-envelope-badge"
                        >
                          {a.envelopeLabel}
                        </span>
                        <span className="truncate text-sm font-medium">
                          {a.platformName}
                        </span>
                      </div>
                      <p className="text-meta mt-0.5">
                        Ouvert le{" "}
                        {new Date(a.openDate).toLocaleDateString("fr-FR")}
                        {a.positionCount > 0 && ` · ${a.positionCount} ligne(s)`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        {formatCurrency(a.liquidationValueEur, "EUR")}
                      </p>
                      <p
                        className={cn(
                          "text-[11px] tabular-nums",
                          num(a.unrealizedPnlEur) < 0
                            ? "text-[var(--danger)]"
                            : "text-[var(--success)]"
                        )}
                      >
                        {formatCurrency(a.unrealizedPnlEur, "EUR")} latent
                      </p>
                    </div>
                  </div>

                  {/* Antériorité fiscale — l'information que Positions ne portait pas. */}
                  {a.maturity && (
                    <div
                      className={cn(
                        "mt-2 flex items-start gap-1.5 rounded-[var(--radius-md)] border px-2 py-1.5 text-[11px]",
                        a.maturity.isMatured
                          ? "border-[var(--success)]/40 bg-[var(--success)]/10 text-[var(--success)]"
                          : "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--warning)]"
                      )}
                      data-testid="securities-maturity"
                    >
                      {a.maturity.isMatured ? (
                        <Unlock className="mt-0.5 h-3 w-3 shrink-0" />
                      ) : (
                        <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                      )}
                      <span>
                        {a.taxStatusLabel}
                        {!a.maturity.isMatured && (
                          <>
                            {" "}
                            — 5 ans atteints le{" "}
                            {new Date(
                              a.maturity.maturityDate
                            ).toLocaleDateString("fr-FR")}
                          </>
                        )}
                      </span>
                    </div>
                  )}

                  {a.room && <ContributionGauge room={a.room} />}

                  <div className="mt-2 flex items-center justify-between text-[11px]">
                    <span className="text-[var(--muted-foreground)]">
                      Espèces
                    </span>
                    <span className="tabular-nums">
                      {a.cashAttributed ? (
                        formatCurrency(a.cashEur, "EUR")
                      ) : (
                        <span
                          className="text-[var(--muted-foreground)]"
                          title="La poche d'espèces est tenue par enveloppe et non par compte : elle ne peut pas être ventilée entre plusieurs comptes de même type."
                          data-testid="securities-cash-unattributed"
                        >
                          non ventilées
                        </span>
                      )}
                    </span>
                  </div>

                  {a.maturity && (
                    <>
                      <button
                        type="button"
                        className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--primary)]"
                        aria-expanded={isOpen}
                        onClick={() => setOpenAccountId(isOpen ? null : a.id)}
                        data-testid="securities-account-toggle"
                      >
                        <CalendarClock className="h-3 w-3" aria-hidden />
                        {isOpen ? "Masquer" : "Versements et simulation"}
                      </button>

                      {isOpen && (
                        <>
                          <div className="mt-2 flex items-end gap-1.5">
                            <label className="text-meta block flex-1">
                              Versement (€)
                              <input
                                inputMode="decimal"
                                className="input mt-1 w-full"
                                value={contribAmount}
                                onChange={(e) =>
                                  setContribAmount(e.target.value)
                                }
                                data-testid="securities-contribution-amount"
                              />
                            </label>
                            <label className="text-meta block flex-1">
                              Date
                              <input
                                type="date"
                                className="input mt-1 w-full"
                                value={contribDate}
                                onChange={(e) => setContribDate(e.target.value)}
                              />
                            </label>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={
                                !contribAmount.trim() ||
                                addContribution.isPending
                              }
                              onClick={() => addContribution.mutate(a.id)}
                              data-testid="securities-contribution-submit"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          </div>

                          <WithdrawalSimulator account={a} />
                        </>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {unattached.length > 0 && (
            <div
              className="mt-3 flex flex-wrap items-start gap-2 rounded-[var(--radius-md)] border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-2 text-xs text-[var(--warning)]"
              data-testid="securities-unattached-banner"
            >
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0 flex-1">
                <strong>{unattached.length} ligne(s) non rattachée(s)</strong> à
                un compte. Elles ne comptent ni dans la valeur liquidative, ni
                dans la simulation de retrait — qui serait donc sous-évaluée.
              </span>
              {bulkTargets.map((t) => (
                <Button
                  key={t.accountId}
                  type="button"
                  variant="outline"
                  disabled={attachAll.isPending}
                  onClick={() =>
                    attachAll.mutate({
                      assetIds: t.assetIds,
                      accountId: t.accountId,
                    })
                  }
                  data-testid="securities-attach-all"
                >
                  Rattacher {t.assetIds.length} ligne(s) au{" "}
                  {t.account.envelopeLabel}
                </Button>
              ))}
            </div>
          )}

          {positions.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs" data-testid="securities-table">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                    <th className="py-1.5 pr-2">Titre</th>
                    <th className="py-1.5 pr-2">Enveloppe</th>
                    <th className="py-1.5 pr-2">Compte</th>
                    <th className="py-1.5 pr-2 text-right">PRU</th>
                    <th className="py-1.5 pr-2 text-right">Cours</th>
                    <th className="py-1.5 pr-2 text-right">P&L latent</th>
                    <th className="py-1.5 text-right">Valeur</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr
                      key={p.assetId}
                      className="border-b border-[var(--border)]/50"
                      data-testid="securities-row"
                    >
                      <td className="py-1.5 pr-2">
                        <span className="font-medium">{p.name}</span>
                        {p.ticker && (
                          <span className="text-meta ml-1">· {p.ticker}</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2">
                        <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                          {p.accountType}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2">
                        {(() => {
                          // Seuls les comptes de la même famille fiscale sont
                          // proposés : le service refuserait les autres, autant
                          // ne pas offrir un choix voué à l'échec.
                          const options = eligibleAccounts(
                            p.accountType,
                            accounts
                          );
                          if (options.length === 0) {
                            return (
                              <span className="text-meta">
                                aucun compte {p.accountType}
                              </span>
                            );
                          }
                          return (
                            <select
                              className="input h-7 w-full min-w-[9rem] py-0 text-[11px]"
                              value={p.securitiesAccountId ?? ""}
                              disabled={attachPosition.isPending}
                              onChange={(e) =>
                                attachPosition.mutate({
                                  assetId: p.assetId,
                                  securitiesAccountId: e.target.value || null,
                                })
                              }
                              data-testid="securities-row-account"
                            >
                              <option value="">— non rattachée —</option>
                              {options.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.envelopeLabel} · {a.platformName}
                                </option>
                              ))}
                            </select>
                          );
                        })()}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {p.unitCostBasisEur
                          ? formatCurrency(p.unitCostBasisEur, "EUR")
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">
                        {formatCurrency(p.priceEur, "EUR")}
                      </td>
                      <td
                        className={cn(
                          "py-1.5 pr-2 text-right tabular-nums",
                          num(p.unrealizedPnlEur) < 0
                            ? "text-[var(--danger)]"
                            : "text-[var(--success)]"
                        )}
                      >
                        {formatCurrency(p.unrealizedPnlEur, "EUR")}
                        {p.unrealizedPnlPct && (
                          <span className="text-meta ml-1">
                            ({Number(p.unrealizedPnlPct).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %)
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-medium tabular-nums">
                        {formatCurrency(p.marketValueEur, "EUR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-meta mt-3">
            Estimations à titre indicatif. Un PEA ne s&apos;impose pas ligne par
            ligne : une vente interne n&apos;est pas un fait générateur, seul le
            retrait l&apos;est, et la plus-value s&apos;apprécie sur
            l&apos;enveloppe entière.
          </p>
        </>
      )}
    </section>
  );
}
