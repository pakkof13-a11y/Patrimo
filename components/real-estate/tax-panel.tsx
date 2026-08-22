"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchJson } from "@/app/lib/api-client";
import { EmptyPlaceholder, PanelHeader } from "@/components/ui/panel";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatCurrency } from "@/app/lib/utils";
import {
  IFI_THRESHOLD_EUR,
  type RealEstateTaxBundlePayload as TaxBundle,
  type RentalSection,
  type SchemesBlock,
} from "@/app/lib/real-estate/tax/payload";

const REGIME_LABELS: Record<string, string> = {
  MICRO_FONCIER: "Micro-foncier",
  REEL_FONCIER: "Réel foncier",
  MICRO_BIC: "Micro-BIC",
  REEL_BIC: "Réel BIC",
};

const SCHEME_LABELS: Record<string, string> = {
  PINEL: "Pinel",
  PINEL_PLUS: "Pinel+",
  DENORMANDIE: "Denormandie",
  MALRAUX: "Malraux",
  MONUMENT_HISTORIQUE: "Monument historique",
  LOC_AVANTAGES: "Loc'Avantages",
  CENSI_BOUVARD: "Censi-Bouvard",
};

const TMI_OPTIONS = [0, 11, 30, 41, 45];

function num(v: string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Arbitrage de régime pour un mode de location (nu ou meublé).
 *
 * Rendue vide quand aucun bien ne relève de ce mode : afficher une section
 * « meublé » à zéro pour un parc entièrement nu n'apprendrait rien.
 */
function RentalSectionView({
  title,
  section,
  testId,
}: {
  title: string;
  section: RentalSection;
  testId: string;
}) {
  if (section.count === 0) return null;

  const best = section.outcomes.find((o) => o.regime === section.bestRegime);

  return (
    <div className="mt-3" data-testid={testId}>
      <h4 className="text-sm font-medium">{title}</h4>
      <p className="text-meta mt-0.5">
        {section.count} bien{section.count > 1 ? "s" : ""} ·{" "}
        {formatCurrency(num(section.grossRentEur))} de recettes annuelles ·{" "}
        {formatCurrency(num(section.deductibleChargesEur))} de charges déclarées.
      </p>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {section.outcomes.map((o) => {
          const isBest = o.regime === section.bestRegime;
          return (
            <div
              key={o.regime}
              className={cn(
                "rounded-[var(--radius-md)] border px-3 py-2.5",
                isBest
                  ? "border-teal-500/40 bg-teal-500/5"
                  : "border-[var(--border)]",
                !o.eligible && "opacity-60"
              )}
              data-testid={`re-regime-${o.regime}`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {REGIME_LABELS[o.regime] ?? o.regime}
                </p>
                {isBest ? (
                  <span className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 dark:text-teal-300">
                    Le moins imposé
                  </span>
                ) : null}
              </div>

              {o.eligible ? (
                <>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {formatCurrency(num(o.totalTaxEur))}
                    <span className="text-meta ml-1 text-xs font-normal">
                      d&apos;impôt
                    </span>
                  </p>
                  <dl className="text-meta mt-1 space-y-0.5">
                    <div className="flex justify-between gap-2">
                      <dt>Déduction</dt>
                      <dd className="tabular-nums">
                        {formatCurrency(num(o.deductionEur))}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt>Base imposable</dt>
                      <dd className="tabular-nums">
                        {formatCurrency(num(o.taxableIncomeEur))}
                      </dd>
                    </div>
                    {num(o.deficitOffsetGlobalEur) > 0 ? (
                      <div className="flex justify-between gap-2">
                        <dt>Déficit sur revenu global</dt>
                        <dd className="tabular-nums">
                          {formatCurrency(num(o.deficitOffsetGlobalEur))}
                        </dd>
                      </div>
                    ) : null}
                    {num(o.deficitCarriedForwardEur) > 0 ? (
                      <div className="flex justify-between gap-2">
                        <dt>Déficit reporté</dt>
                        <dd className="tabular-nums">
                          {formatCurrency(num(o.deficitCarriedForwardEur))}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                </>
              ) : (
                <p className="text-meta mt-1 leading-snug">
                  {o.ineligibilityReason}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {best && num(section.savingVsNextEur) > 0 ? (
        <p className="text-meta mt-1.5">
          {REGIME_LABELS[best.regime] ?? best.regime} économise{" "}
          <strong>{formatCurrency(num(section.savingVsNextEur))}</strong> par an
          sur l&apos;autre régime, à cette TMI.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Réductions d'impôt des dispositifs, et leur plafonnement global.
 *
 * Le plafond de 10 000 € porte sur la somme des avantages concernés, pas sur
 * chacun pris isolément : deux Pinel de 6 000 € annoncent 12 000 € mais n'en
 * procurent que 10 000. Le montant perdu est donc affiché explicitement —
 * c'est l'information qui manque partout ailleurs.
 */
function SchemesView({ schemes }: { schemes: SchemesBlock }) {
  if (schemes.rows.length === 0) return null;
  const s = schemes.summary;
  const lost = num(s.cappedAwayEur);

  return (
    <div
      className="mt-5 border-t border-[var(--border)] pt-4"
      data-testid="re-schemes"
    >
      <h3 className="text-title text-sm">Dispositifs de défiscalisation</h3>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          { label: "Réduction annuelle brute", value: num(s.totalAnnualEur) },
          { label: "Perdu au plafonnement", value: -lost },
          {
            label: "Réduction imputable",
            value: num(s.effectiveAnnualEur),
            strong: true,
          },
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
            <p className="mt-0.5 text-sm font-semibold tabular-nums">
              {formatCurrency(k.value)}
            </p>
          </div>
        ))}
      </div>

      {lost > 0 ? (
        <div
          className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] leading-snug text-amber-900 dark:text-amber-200"
          data-testid="re-schemes-capped"
        >
          <p className="font-semibold">
            Plafond des niches fiscales atteint — {formatCurrency(lost)} perdus
          </p>
          <p className="mt-0.5">
            Les avantages concernés totalisent{" "}
            {formatCurrency(num(s.cappedAnnualEur))} alors que le plafond annuel
            est de 10 000 €. Malraux et les Monuments historiques échappent à ce
            plafond et ne sont pas comptés ici.
          </p>
        </div>
      ) : null}

      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
            <tr>
              <th className="py-1.5 pr-2 font-medium">Bien</th>
              <th className="py-1.5 pr-2 font-medium">Dispositif</th>
              <th className="py-1.5 pr-2 text-right font-medium">Base retenue</th>
              <th className="py-1.5 pr-2 text-right font-medium">Total</th>
              <th className="py-1.5 pr-2 text-right font-medium">Par an</th>
              <th className="py-1.5 text-right font-medium">Reste</th>
            </tr>
          </thead>
          <tbody>
            {schemes.rows.map((r) => (
              <tr
                key={r.assetId}
                className={cn(
                  "border-t border-[var(--border)]",
                  r.finished && "opacity-60"
                )}
                data-testid={`re-scheme-${r.assetId}`}
              >
                <td className="py-1.5 pr-2">{r.label}</td>
                <td className="py-1.5 pr-2">
                  {SCHEME_LABELS[r.scheme] ?? r.scheme}
                  {!r.subjectToGlobalCap && num(r.totalReductionEur) > 0 ? (
                    <span className="ml-1.5 rounded bg-teal-500/10 px-1 py-0.5 text-[9px] text-teal-700 dark:text-teal-300">
                      hors plafond
                    </span>
                  ) : null}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {num(r.eligibleBaseEur) > 0
                    ? formatCurrency(num(r.eligibleBaseEur))
                    : "—"}
                  {r.baseWasCapped ? (
                    <span
                      className="text-meta ml-1 text-[9px]"
                      title="Base ramenée au plafond légal"
                    >
                      plafonnée
                    </span>
                  ) : null}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">
                  {num(r.totalReductionEur) > 0
                    ? formatCurrency(num(r.totalReductionEur))
                    : "—"}
                </td>
                <td className="py-1.5 pr-2 text-right font-medium tabular-nums">
                  {r.finished
                    ? "terminé"
                    : formatCurrency(num(r.annualReductionEur))}
                </td>
                <td className="py-1.5 text-right tabular-nums">
                  {r.finished ? "—" : `${r.yearsRemaining} an${r.yearsRemaining > 1 ? "s" : ""}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {schemes.rows.some((r) => r.note) ? (
        <ul className="text-meta mt-2 space-y-0.5 leading-snug">
          {schemes.rows
            .filter((r) => r.note)
            .map((r) => (
              <li key={r.assetId}>
                <strong>{r.label}</strong> — {r.note}
              </li>
            ))}
        </ul>
      ) : null}

      <p className="text-meta mt-2 leading-snug">
        Le calcul suppose l&apos;engagement de location tenu et les plafonds de
        loyer et de ressources respectés — conditions que l&apos;application ne
        vérifie pas.
      </p>
    </div>
  );
}

/**
 * Synthèse fiscale du parc immobilier : assiette IFI et arbitrage de régime
 * locatif.
 *
 * Ces deux calculs ne peuvent pas se lire bien par bien — l'IFI se apprécie
 * sur le patrimoine entier et le choix d'un régime dépend du total des
 * recettes. D'où un panneau de consolidation distinct des fiches de biens.
 *
 * Tout est recalculé à la demande côté serveur depuis le journal : les
 * montants ne peuvent pas diverger de l'onglet Positions.
 */
export function RealEstateTaxPanel({ className }: { className?: string }) {
  const [tmi, setTmi] = useState(30);

  const q = useQuery({
    queryKey: ["real-estate-tax", tmi],
    queryFn: () => fetchJson<TaxBundle>(`/api/real-estate/tax?tmi=${tmi}`),
  });

  const ifi = q.data?.ifi;
  const rental = q.data?.rental;

  if (q.isPending) {
    return (
      <section className={cn("card p-4", className)}>
        <PanelHeader title="Fiscalité immobilière" subtitle="IFI et revenus locatifs" />
        <Skeleton className="mt-3 h-32 w-full" />
      </section>
    );
  }

  if (q.isError) {
    return (
      <section className={cn("card p-4", className)}>
        <PanelHeader title="Fiscalité immobilière" subtitle="IFI et revenus locatifs" />
        <EmptyPlaceholder
          title="Calcul indisponible"
          description="La synthèse fiscale n'a pas pu être calculée."
        />
      </section>
    );
  }

  if (!ifi || !rental || ifi.lines.length === 0) {
    return (
      <section className={cn("card p-4", className)} data-testid="re-tax-panel">
        <PanelHeader title="Fiscalité immobilière" subtitle="IFI et revenus locatifs" />
        <EmptyPlaceholder
          title="Aucun bien enregistré"
          description="Ajoutez un bien pour obtenir l'assiette IFI et l'arbitrage de régime locatif."
        />
      </section>
    );
  }

  const netTaxable = num(ifi.netTaxableEur);
  const distanceToThreshold = IFI_THRESHOLD_EUR - netTaxable;

  return (
    <section className={cn("card p-4", className)} data-testid="re-tax-panel">
      <PanelHeader
        title="Fiscalité immobilière"
        subtitle="Assiette IFI et arbitrage de régime locatif — recalculés depuis le journal"
      />

      {/* ── IFI ── */}
      <div className="mt-3">
        <h3 className="text-title text-sm">Impôt sur la fortune immobilière</h3>

        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Valeur taxable", value: num(ifi.grossTaxableEur) },
            { label: "Dettes déduites", value: -num(ifi.totalDeductibleDebtEur) },
            { label: "Assiette nette", value: netTaxable, strong: true },
            { label: "IFI estimé", value: num(ifi.taxEur), strong: true },
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
              <p className="mt-0.5 text-sm font-semibold tabular-nums">
                {formatCurrency(k.value)}
              </p>
            </div>
          ))}
        </div>

        {ifi.liable ? (
          <div
            className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] leading-snug text-amber-900 dark:text-amber-200"
            data-testid="ifi-liable"
          >
            <p className="font-semibold">
              Assujetti à l&apos;IFI — {formatCurrency(num(ifi.taxEur))} estimés
            </p>
            <p className="mt-0.5">
              L&apos;assiette dépasse 1 300 000 €. Le barème s&apos;applique
              alors <strong>dès 800 000 €</strong>, d&apos;où un impôt brut de{" "}
              {formatCurrency(num(ifi.grossTaxEur))}
              {num(ifi.discountEur) > 0 ? (
                <>
                  , ramené à {formatCurrency(num(ifi.taxEur))} par la décote de
                  seuil ({formatCurrency(num(ifi.discountEur))}).
                </>
              ) : (
                "."
              )}{" "}
              Taux effectif : {num(ifi.effectiveRatePct).toFixed(2)} %.
            </p>
          </div>
        ) : (
          <p className="text-meta mt-2">
            Sous le seuil de 1 300 000 € — non assujetti.
            {distanceToThreshold > 0 ? (
              <> Marge restante : {formatCurrency(distanceToThreshold)}.</>
            ) : null}
          </p>
        )}

        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
              <tr>
                <th className="py-1.5 pr-2 font-medium">Bien</th>
                <th className="py-1.5 pr-2 text-right font-medium">Valeur</th>
                <th className="py-1.5 pr-2 text-right font-medium">Abattement</th>
                <th className="py-1.5 pr-2 text-right font-medium">Dette</th>
                <th className="py-1.5 text-right font-medium">Net IFI</th>
              </tr>
            </thead>
            <tbody>
              {ifi.lines.map((l) => (
                <tr key={l.id} className="border-t border-[var(--border)]">
                  <td className="py-1.5 pr-2">
                    <span className="truncate">{l.label}</span>
                    {num(l.allowanceEur) > 0 ? (
                      <span className="ml-1.5 rounded bg-teal-500/10 px-1 py-0.5 text-[9px] text-teal-700 dark:text-teal-300">
                        RP −30 %
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatCurrency(num(l.grossValueEur))}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-[var(--muted-foreground)]">
                    {num(l.allowanceEur) > 0
                      ? `−${formatCurrency(num(l.allowanceEur))}`
                      : "—"}
                  </td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-[var(--muted-foreground)]">
                    {num(l.deductibleDebtEur) > 0
                      ? `−${formatCurrency(num(l.deductibleDebtEur))}`
                      : "—"}
                  </td>
                  <td className="py-1.5 text-right font-medium tabular-nums">
                    {formatCurrency(num(l.netValueEur))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Régime locatif : nu et meublé séparés ── */}
      {rental.bare.count > 0 || rental.furnished.count > 0 ? (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-title text-sm">Régime locatif</h3>
            <label className="text-meta flex items-center gap-1.5">
              TMI
              <select
                className="input h-7 py-0 text-xs"
                value={tmi}
                onChange={(e) => setTmi(Number(e.target.value))}
                aria-label="Tranche marginale d'imposition"
                data-testid="re-tax-tmi"
              >
                {TMI_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {t} %
                  </option>
                ))}
              </select>
            </label>
          </div>

          <RentalSectionView
            title="Location nue — revenus fonciers"
            section={rental.bare}
            testId="re-rental-bare"
          />
          <RentalSectionView
            title="Location meublée — bénéfices industriels et commerciaux"
            section={rental.furnished}
            testId="re-rental-furnished"
          />

          <p className="text-meta mt-3 leading-snug">
            Nu et meublé sont présentés séparément : ils relèvent de deux
            fiscalités distinctes, avec des plafonds propres, et leurs recettes
            ne s&apos;additionnent pas. Estimation indicative — le choix d&apos;un régime
            engage plusieurs années.
          </p>
        </div>
      ) : null}

      {q.data?.schemes ? <SchemesView schemes={q.data.schemes} /> : null}
    </section>
  );
}
