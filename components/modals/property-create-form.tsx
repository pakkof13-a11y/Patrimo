"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Field } from "@/components/ui/field";
import { DateField } from "@/components/ui/date-input";
import {
  FormWizard,
  type WizardStep,
} from "@/components/ui/form-wizard";
import {
  ENERGY_RATINGS,
  PROPERTY_TYPES,
  PROPERTY_USAGES,
  formatOwnershipShare,
  grossRentalYieldPct,
  isDvfEstimable,
  isRentalUsage,
} from "@/app/lib/real-estate/constants";
import { cn, formatCurrency } from "@/app/lib/utils";

/**
 * Saisie d'un bien immobilier.
 *
 * Rien à voir avec le formulaire d'actif habituel : pas de recherche de ticker,
 * pas de fournisseur de cours. Un bien ne se cherche pas dans un catalogue, il
 * se décrit.
 *
 * Trois étapes plutôt qu'un formulaire fleuve : ce qu'est le bien, ce qu'il a
 * coûté, ce qu'il vaut. La validation ne bloque qu'aux étapes où une erreur
 * fausserait le patrimoine.
 */

const STEPS: WizardStep[] = [
  {
    id: "identity",
    label: "Le bien",
    description: "Type, usage, surface et adresse",
  },
  {
    id: "acquisition",
    label: "Acquisition",
    description: "Prix, frais, quote-part et prêt",
  },
  {
    id: "valuation",
    label: "Valorisation",
    description: "Estimation et exploitation",
  },
];

export type PropertyFormLoan = {
  id: string;
  name: string;
  remainingAmountEur: string;
};

type FormState = {
  name: string;
  propertyType: string;
  usage: string;
  rooms: string;
  livingAreaM2: string;
  landAreaM2: string;
  addressLine: string;
  postalCode: string;
  city: string;
  purchaseDate: string;
  purchasePriceEur: string;
  acquisitionFeesEur: string;
  ownershipSharePct: string;
  liabilityId: string;
  monthlyRentEur: string;
  monthlyChargesEur: string;
  annualPropertyTaxEur: string;
  occupancyRatePct: string;
  rentDay: string;
  rentalStartDate: string;
  constructionYear: string;
  energyRating: string;
  parkingSpots: string;
  floor: string;
  hasElevator: boolean;
  notes: string;
};

const EMPTY: FormState = {
  name: "",
  propertyType: "APPARTEMENT",
  usage: "RESIDENCE_PRINCIPALE",
  rooms: "",
  livingAreaM2: "",
  landAreaM2: "",
  addressLine: "",
  postalCode: "",
  city: "",
  purchaseDate: "",
  purchasePriceEur: "",
  acquisitionFeesEur: "",
  // Le cas de loin le plus courant — un acheteur seul ne doit rien avoir à
  // modifier ici.
  ownershipSharePct: "100",
  liabilityId: "",
  monthlyRentEur: "",
  monthlyChargesEur: "",
  annualPropertyTaxEur: "",
  occupancyRatePct: "",
  rentDay: "",
  rentalStartDate: "",
  constructionYear: "",
  energyRating: "",
  parkingSpots: "",
  floor: "",
  hasElevator: false,
  notes: "",
};

function num(v: string): number {
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export function PropertyCreateForm({
  platformId,
  platformName,
  loans = [],
  onCreated,
  onCancel,
}: {
  platformId: string;
  platformName: string;
  /** Prêts existants proposés au rattachement. */
  loans?: PropertyFormLoan[];
  onCreated?: (assetId: string) => void;
  onCancel?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key as string] ? { ...e, [key]: "" } : e));
  };

  const share = num(form.ownershipSharePct) / 100;
  const price = num(form.purchasePriceEur);
  const fees = num(form.acquisitionFeesEur);
  const shareValue = price * share;
  const costBasis = shareValue + fees;

  const rental = isRentalUsage(form.usage);
  const estimable = isDvfEstimable(form.propertyType);
  const needsArea = estimable;

  const yieldPct = useMemo(
    () =>
      grossRentalYieldPct({
        monthlyRentEur: num(form.monthlyRentEur) || null,
        occupancyRatePct: form.occupancyRatePct
          ? num(form.occupancyRatePct)
          : null,
        propertyValueEur: price || null,
      }),
    [form.monthlyRentEur, form.occupancyRatePct, price]
  );

  function validateStep(index: number): boolean {
    const next: Record<string, string> = {};

    if (index === 0) {
      if (!form.name.trim()) next.name = "Donnez un nom au bien";
      // La surface n'est exigée que là où elle sert : sans elle, aucune
      // estimation DVF n'est possible pour une maison ou un appartement.
      if (needsArea && num(form.livingAreaM2) <= 0) {
        next.livingAreaM2 = "Surface requise pour l'estimation";
      }
    }

    if (index === 1) {
      if (!form.purchaseDate) next.purchaseDate = "Date d'achat requise";
      if (price <= 0) next.purchasePriceEur = "Prix d'achat requis";
      const pct = num(form.ownershipSharePct);
      if (pct <= 0 || pct > 100) {
        next.ownershipSharePct = "Entre 0 et 100 %";
      }
      if (fees < 0) next.acquisitionFeesEur = "Montant positif attendu";
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit() {
    if (!validateStep(0) || !validateStep(1)) {
      setStep(0);
      return;
    }
    setPending(true);
    try {
      const res = await fetch("/api/real-estate/properties", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platformId,
          name: form.name.trim(),
          propertyType: form.propertyType,
          usage: form.usage,
          ownershipSharePct: num(form.ownershipSharePct),
          purchasePriceEur: form.purchasePriceEur.replace(",", "."),
          acquisitionFeesEur: form.acquisitionFeesEur
            ? form.acquisitionFeesEur.replace(",", ".")
            : null,
          purchaseDate: new Date(form.purchaseDate).toISOString(),
          rooms: form.rooms ? num(form.rooms) : null,
          livingAreaM2: form.livingAreaM2 ? num(form.livingAreaM2) : null,
          landAreaM2: form.landAreaM2 ? num(form.landAreaM2) : null,
          addressLine: form.addressLine.trim() || null,
          postalCode: form.postalCode.trim() || null,
          city: form.city.trim() || null,
          monthlyRentEur: form.monthlyRentEur
            ? form.monthlyRentEur.replace(",", ".")
            : null,
          monthlyChargesEur: form.monthlyChargesEur
            ? form.monthlyChargesEur.replace(",", ".")
            : null,
          annualPropertyTaxEur: form.annualPropertyTaxEur
            ? form.annualPropertyTaxEur.replace(",", ".")
            : null,
          occupancyRatePct: form.occupancyRatePct
            ? form.occupancyRatePct.replace(",", ".")
            : null,
          rentDay: form.rentDay ? num(form.rentDay) : null,
          rentalStartDate: form.rentalStartDate
            ? new Date(form.rentalStartDate).toISOString()
            : null,
          constructionYear: form.constructionYear
            ? num(form.constructionYear)
            : null,
          energyRating: form.energyRating || null,
          parkingSpots: form.parkingSpots ? num(form.parkingSpots) : null,
          floor: form.floor ? num(form.floor) : null,
          hasElevator: form.hasElevator,
          liabilityId: form.liabilityId || null,
          notes: form.notes.trim() || null,
        }),
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(body?.error ?? "Création impossible");
      }
      toast.success(`${form.name.trim()} ajouté au patrimoine`);
      onCreated?.(body.assetId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Création impossible");
    } finally {
      setPending(false);
    }
  }

  return (
    <FormWizard
      steps={STEPS}
      current={step}
      onStepChange={setStep}
      onValidateStep={(i) => validateStep(i)}
      onCancel={onCancel}
      onSubmit={submit}
      submitLabel="Ajouter le bien"
      submitPending={pending}
      testId="property-wizard"
    >
      {step === 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Nom du bien"
            htmlFor="prop-name"
            error={errors.name}
            hint="Comment vous l'appelez au quotidien"
            className="sm:col-span-2"
          >
            <input
              id="prop-name"
              className="input mt-1 w-full"
              placeholder="ex. Appartement Marseille 2e"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              data-testid="property-name"
            />
          </Field>

          <Field label="Type de bien" htmlFor="prop-type">
            <select
              id="prop-type"
              className="input mt-1 w-full"
              value={form.propertyType}
              onChange={(e) => set("propertyType", e.target.value)}
              data-testid="property-type"
            >
              {Object.entries(PROPERTY_TYPES).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Usage" htmlFor="prop-usage">
            <select
              id="prop-usage"
              className="input mt-1 w-full"
              value={form.usage}
              onChange={(e) => set("usage", e.target.value)}
              data-testid="property-usage"
            >
              {Object.entries(PROPERTY_USAGES).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label="Surface habitable"
            htmlFor="prop-area"
            error={errors.livingAreaM2}
            optional={!needsArea}
            hint={
              needsArea
                ? "Loi Carrez — base de l'estimation au m²"
                : undefined
            }
          >
            <input
              id="prop-area"
              type="number"
              min={0}
              className="input mt-1 w-full"
              placeholder="m²"
              value={form.livingAreaM2}
              onChange={(e) => set("livingAreaM2", e.target.value)}
              data-testid="property-area"
            />
          </Field>

          <Field label="Terrain" htmlFor="prop-land" optional>
            <input
              id="prop-land"
              type="number"
              min={0}
              className="input mt-1 w-full"
              placeholder="m²"
              value={form.landAreaM2}
              onChange={(e) => set("landAreaM2", e.target.value)}
            />
          </Field>

          <Field label="Nombre de pièces" htmlFor="prop-rooms" optional>
            <input
              id="prop-rooms"
              type="number"
              min={0}
              className="input mt-1 w-full"
              placeholder="ex. 3"
              value={form.rooms}
              onChange={(e) => set("rooms", e.target.value)}
            />
          </Field>

          <Field label="Année de construction" htmlFor="prop-year" optional>
            <input
              id="prop-year"
              type="number"
              className="input mt-1 w-full"
              placeholder="ex. 1974"
              value={form.constructionYear}
              onChange={(e) => set("constructionYear", e.target.value)}
            />
          </Field>

          <Field
            label="Adresse"
            htmlFor="prop-address"
            className="sm:col-span-2"
            optional={!estimable}
            hint="Sert à retrouver les ventes comparables autour du bien"
          >
            <input
              id="prop-address"
              className="input mt-1 w-full"
              placeholder="12 rue de la République"
              value={form.addressLine}
              onChange={(e) => set("addressLine", e.target.value)}
              data-testid="property-address"
            />
          </Field>

          <Field label="Code postal" htmlFor="prop-zip" optional>
            <input
              id="prop-zip"
              className="input mt-1 w-full"
              placeholder="13002"
              value={form.postalCode}
              onChange={(e) => set("postalCode", e.target.value)}
            />
          </Field>

          <Field label="Ville" htmlFor="prop-city" optional>
            <input
              id="prop-city"
              className="input mt-1 w-full"
              placeholder="Marseille"
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
            />
          </Field>

          {!estimable && (
            <p className="text-meta sm:col-span-2">
              Ce type de bien ne se valorise pas au mètre carré habitable :
              l&apos;estimation automatique ne s&apos;y applique pas, vous saisirez la
              valeur vous-même.
            </p>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <DateField
            label="Date d'achat"
            value={form.purchaseDate}
            error={errors.purchaseDate}
            onChange={(e) => set("purchaseDate", e.target.value)}
            data-testid="property-date"
          />

          <Field
            label="Prix d'achat"
            htmlFor="prop-price"
            error={errors.purchasePriceEur}
            hint="Prix du bien entier, hors frais"
          >
            <input
              id="prop-price"
              className="input mt-1 w-full"
              inputMode="decimal"
              placeholder="300000"
              value={form.purchasePriceEur}
              onChange={(e) => set("purchasePriceEur", e.target.value)}
              data-testid="property-price"
            />
          </Field>

          <Field
            label="Frais d'acquisition"
            htmlFor="prop-fees"
            optional
            error={errors.acquisitionFeesEur}
            hint="Notaire et agence — entrent dans le coût de revient"
          >
            <input
              id="prop-fees"
              className="input mt-1 w-full"
              inputMode="decimal"
              placeholder="24000"
              value={form.acquisitionFeesEur}
              onChange={(e) => set("acquisitionFeesEur", e.target.value)}
              data-testid="property-fees"
            />
          </Field>

          <Field
            label="Quote-part détenue"
            htmlFor="prop-share"
            error={errors.ownershipSharePct}
            hint="100 % si vous êtes seul propriétaire"
          >
            <div className="mt-1 flex items-center gap-2">
              <input
                id="prop-share"
                type="number"
                min={0}
                max={100}
                step="0.01"
                className="input w-full"
                value={form.ownershipSharePct}
                onChange={(e) => set("ownershipSharePct", e.target.value)}
                data-testid="property-share"
              />
              <span className="text-sm text-[var(--muted-foreground)]">%</span>
            </div>
          </Field>

          {loans.length > 0 && (
            <Field
              label="Prêt associé"
              htmlFor="prop-loan"
              optional
              className="sm:col-span-2"
              hint="Permet d'afficher le net sur ce bien (valeur − capital restant dû)"
            >
              <select
                id="prop-loan"
                className="input mt-1 w-full"
                value={form.liabilityId}
                onChange={(e) => set("liabilityId", e.target.value)}
                data-testid="property-loan"
              >
                <option value="">Aucun</option>
                {loans.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} — {formatCurrency(l.remainingAmountEur, "EUR")}{" "}
                    restant dû
                  </option>
                ))}
              </select>
            </Field>
          )}

          {price > 0 && (
            <div
              className="card sm:col-span-2 space-y-1 p-3 text-xs"
              data-testid="property-acquisition-recap"
            >
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">
                  Valeur de votre part ({formatOwnershipShare(share)})
                </span>
                <span className="font-medium">
                  {formatCurrency(String(shareValue), "EUR")}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">
                  Coût de revient, frais inclus
                </span>
                <span className="font-medium">
                  {formatCurrency(String(costBasis), "EUR")}
                </span>
              </div>
              {share < 1 && (
                <p className="text-meta pt-1">
                  Le prêt reste saisi pour le montant que vous devez
                  réellement — il n&apos;est pas réduit à votre quote-part.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="card sm:col-span-2 space-y-1 p-3 text-xs">
            <p className="font-medium">
              {estimable
                ? "Estimation automatique activée"
                : "Valorisation manuelle"}
            </p>
            <p className="text-[var(--muted-foreground)]">
              {estimable
                ? "Le bien démarre à son prix d'achat. Une estimation sera proposée à partir des ventes réelles alentour ; vous pourrez l&apos;accepter, la corriger, ou saisir votre propre valeur — auquel cas elle ne sera plus jamais écrasée."
                : "Vous fixerez la valeur de ce bien vous-même, depuis sa fiche."}
            </p>
          </div>

          {rental && (
            <>
              <Field
                label="Loyer mensuel"
                htmlFor="prop-rent"
                optional
                hint="Bien entier, charges non comprises"
              >
                <input
                  id="prop-rent"
                  className="input mt-1 w-full"
                  inputMode="decimal"
                  placeholder="1100"
                  value={form.monthlyRentEur}
                  onChange={(e) => set("monthlyRentEur", e.target.value)}
                  data-testid="property-rent"
                />
              </Field>

              <Field label="Charges mensuelles" htmlFor="prop-charges" optional>
                <input
                  id="prop-charges"
                  className="input mt-1 w-full"
                  inputMode="decimal"
                  placeholder="120"
                  value={form.monthlyChargesEur}
                  onChange={(e) => set("monthlyChargesEur", e.target.value)}
                />
              </Field>

              <Field label="Taxe foncière annuelle" htmlFor="prop-tax" optional>
                <input
                  id="prop-tax"
                  className="input mt-1 w-full"
                  inputMode="decimal"
                  placeholder="900"
                  value={form.annualPropertyTaxEur}
                  onChange={(e) => set("annualPropertyTaxEur", e.target.value)}
                />
              </Field>

              {form.usage === "LOCATIF_SAISONNIER" && (
                <Field
                  label="Taux d'occupation moyen"
                  htmlFor="prop-occupancy"
                  optional
                  hint="Sans valeur, le bien est considéré loué toute l'année"
                >
                  <input
                    id="prop-occupancy"
                    type="number"
                    min={0}
                    max={100}
                    className="input mt-1 w-full"
                    placeholder="65"
                    value={form.occupancyRatePct}
                    onChange={(e) => set("occupancyRatePct", e.target.value)}
                  />
                </Field>
              )}

              <Field
                label="Jour d'encaissement du loyer"
                htmlFor="prop-rent-day"
                optional
                hint="Renseigné, Patrimo proposera chaque mois l'écriture à confirmer"
              >
                <input
                  id="prop-rent-day"
                  type="number"
                  min={1}
                  max={31}
                  className="input mt-1 w-full"
                  placeholder="5"
                  value={form.rentDay}
                  onChange={(e) => set("rentDay", e.target.value)}
                  data-testid="property-rent-day"
                />
              </Field>

              <DateField
                label="Début du bail"
                optional
                value={form.rentalStartDate}
                onChange={(e) => set("rentalStartDate", e.target.value)}
                hint="Première échéance possible"
              />

              {form.rentDay && !form.rentalStartDate && (
                <p className="text-meta sm:col-span-2">
                  Sans date de début, seule l&apos;échéance du mois en cours sera
                  proposée — précisez-la pour rattraper les mois écoulés.
                </p>
              )}

              {yieldPct != null && (
                <p
                  className="text-meta sm:col-span-2"
                  data-testid="property-yield"
                >
                  Rendement brut estimé :{" "}
                  <span className="font-medium text-[var(--foreground)]">
                    {yieldPct.toLocaleString("fr-FR", {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 2,
                    })}{" "}
                    %
                  </span>{" "}
                  — loyers annuels rapportés au prix d&apos;achat
                </p>
              )}
            </>
          )}

          <Field label="DPE" htmlFor="prop-dpe" optional>
            <select
              id="prop-dpe"
              className="input mt-1 w-full"
              value={form.energyRating}
              onChange={(e) => set("energyRating", e.target.value)}
            >
              <option value="">Non renseigné</option>
              {ENERGY_RATINGS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Étage" htmlFor="prop-floor" optional>
            <input
              id="prop-floor"
              type="number"
              className="input mt-1 w-full"
              placeholder="ex. 3"
              value={form.floor}
              onChange={(e) => set("floor", e.target.value)}
            />
          </Field>

          <Field label="Places de parking" htmlFor="prop-parking" optional>
            <input
              id="prop-parking"
              type="number"
              min={0}
              className="input mt-1 w-full"
              value={form.parkingSpots}
              onChange={(e) => set("parkingSpots", e.target.value)}
            />
          </Field>

          <label
            className={cn(
              "mt-1 flex items-center gap-2 self-end text-xs",
              "text-[var(--muted-foreground)]"
            )}
          >
            <input
              type="checkbox"
              checked={form.hasElevator}
              onChange={(e) => set("hasElevator", e.target.checked)}
            />
            Ascenseur
          </label>

          <Field label="Notes" htmlFor="prop-notes" optional className="sm:col-span-2">
            <textarea
              id="prop-notes"
              className="input mt-1 w-full"
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>

          <p className="text-meta sm:col-span-2">
            Bien rattaché à <span className="font-medium">{platformName}</span>.
          </p>
        </div>
      )}
    </FormWizard>
  );
}
