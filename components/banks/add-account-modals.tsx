"use client";

/**
 * Création d'un produit bancaire.
 *
 * Les trois formulaires occupaient en permanence le haut de chaque section —
 * une page consultée cent fois pour comprendre son patrimoine, et qui affichait
 * cent fois trois formulaires de création. Ils sont ici, derrière un bouton :
 * mêmes champs, mêmes routes, même validation. Rien n'a été retiré, seulement
 * déplacé hors du chemin de lecture.
 */

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import {
  BankNameCombobox,
  CurrencySelect,
  FieldLabel,
  DOW_LABELS,
  MONTH_LABELS,
} from "@/components/banks/atoms";
import {
  REGULATED_PRODUCT_INFO,
  REGULATED_PRODUCT_LABELS,
  isRateSuspicious,
  type RegulatedProductType,
} from "@/app/lib/cash/regulated-products";

export type AddKind = "CHECKING" | "SAVINGS" | "TERM_DEPOSIT";

/** Payloads envoyés aux routes existantes — inchangés. */
export type CheckingPayload = {
  bankName: string;
  balance: string;
  currency: string;
  isPro: boolean;
  ownershipPct: string | null;
};

export type SavingsPayload = {
  name: string;
  bankName: string | null;
  productType: string;
  ceilingAmount: string | null;
  balance: string;
  apyPercent: string;
  rateType: "APR" | "APY";
  payoutFrequency: string;
  payoutDayOfWeek: number | null;
  payoutDayOfMonth: number | null;
  payoutMonth: number | null;
  currency: string;
  isPro: boolean;
  ownershipPct: string | null;
};

export type TermDepositPayload = {
  bankName: string | null;
  principal: string;
  ratePercent: string;
  currency: string;
  openedAt: string;
  maturityDate: string;
  earlyWithdrawalPenaltyPct: string | null;
};

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <FieldLabel hint={hint}>{label}</FieldLabel>
      {children}
    </label>
  );
}

/* ── Compte courant ──────────────────────────────────────────────────── */

export function AddCheckingModal({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (payload: CheckingPayload) => void;
  pending: boolean;
}) {
  const [bankName, setBankName] = useState("Revolut");
  const [balance, setBalance] = useState("0");
  const [currency, setCurrency] = useState("EUR");
  const [isPro, setIsPro] = useState(false);
  const [ownershipPct, setOwnershipPct] = useState("");

  return (
    <Modal title="Nouveau compte courant" onClose={onClose}>
      <div className="space-y-3" data-testid="add-checking-modal">
        <Field label="Banque">
          <BankNameCombobox
            value={bankName}
            onChange={setBankName}
            testId="banks-add-bank-name"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Solde">
            <input
              className="input w-full py-1.5 text-right"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              data-testid="banks-add-balance"
            />
          </Field>
          <Field label="Devise">
            <CurrencySelect
              value={currency}
              onChange={setCurrency}
              className="w-full"
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Part détenue (%)"
            hint="Vide = compte individuel, 100 % implicite."
          >
            <input
              className="input w-full py-1.5 text-right"
              type="number"
              min={0}
              max={100}
              value={ownershipPct}
              onChange={(e) => setOwnershipPct(e.target.value)}
            />
          </Field>
          <label className="flex items-end gap-2 pb-1.5 text-xs text-[var(--foreground)]">
            <input
              type="checkbox"
              checked={isPro}
              onChange={(e) => setIsPro(e.target.checked)}
            />
            Compte professionnel
          </label>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              onSubmit({
                bankName,
                balance: balance || "0",
                currency: currency || "EUR",
                isPro,
                ownershipPct: ownershipPct || null,
              })
            }
            data-testid="banks-add-submit"
          >
            Ajouter
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Livret ──────────────────────────────────────────────────────────── */

export function AddSavingsModal({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (payload: SavingsPayload) => void;
  pending: boolean;
}) {
  const [name, setName] = useState("Livret A");
  const [bankName, setBankName] = useState("Revolut");
  const [productType, setProductType] =
    useState<RegulatedProductType>("LIVRET_A");
  const [ceiling, setCeiling] = useState("");
  const [balance, setBalance] = useState("0");
  const [apy, setApy] = useState("3");
  const [rateType, setRateType] = useState<"APR" | "APY">("APY");
  const [freq, setFreq] = useState("DAILY");
  const [dow, setDow] = useState(1);
  const [dom, setDom] = useState(1);
  const [month, setMonth] = useState(12);
  const [currency, setCurrency] = useState("EUR");
  const [isPro, setIsPro] = useState(false);
  const [ownershipPct, setOwnershipPct] = useState("");

  /*
    Changer de produit réglementé pré-remplit le plafond légal, jamais le taux.

    Le plafond est fixé par décret et vaut pour tout le monde ; le taux servi,
    lui, dépend du contrat — le pré-remplir écrirait une valeur que l'utilisateur
    n'a pas constatée. On se contente de signaler un taux invraisemblable.
  */
  const applyProductType = (next: RegulatedProductType) => {
    setProductType(next);
    const info = REGULATED_PRODUCT_INFO[next];
    if (info?.ceilingAmount) setCeiling(info.ceilingAmount);
    const label = REGULATED_PRODUCT_LABELS[next];
    if (label) setName(label);
  };

  const rateWarning = isRateSuspicious(productType, apy);

  return (
    <Modal title="Nouveau livret" onClose={onClose}>
      <div className="space-y-3" data-testid="add-savings-modal">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type de produit">
            <select
              className="input w-full py-1.5"
              value={productType}
              onChange={(e) =>
                applyProductType(e.target.value as RegulatedProductType)
              }
              data-testid="banks-savings-add-producttype"
            >
              {Object.entries(REGULATED_PRODUCT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nom du livret">
            <input
              className="input w-full py-1.5"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="banks-savings-add-name"
            />
          </Field>
        </div>

        <Field label="Banque">
          <BankNameCombobox
            value={bankName}
            onChange={setBankName}
            testId="banks-savings-add-bank-name"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Solde">
            <input
              className="input w-full py-1.5 text-right"
              value={balance}
              onChange={(e) => setBalance(e.target.value)}
              data-testid="banks-savings-add-balance"
            />
          </Field>
          <Field label="Taux (%)">
            <input
              className="input w-full py-1.5 text-right"
              value={apy}
              onChange={(e) => setApy(e.target.value)}
              data-testid="banks-savings-add-apy"
            />
          </Field>
          <Field label="Nature" hint="APR : linéaire. APY : composé.">
            <select
              className="input w-full py-1.5"
              value={rateType}
              onChange={(e) => setRateType(e.target.value as "APR" | "APY")}
            >
              <option value="APY">APY</option>
              <option value="APR">APR</option>
            </select>
          </Field>
        </div>

        {rateWarning ? (
          <p
            className="text-[11px] text-[var(--danger)]"
            data-testid="banks-savings-rate-warning"
          >
            Ce taux s&apos;écarte nettement du taux de référence de ce produit —
            vérifiez la saisie.
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Plafond de versement"
            hint="Hors intérêts capitalisés. Vide = pas de plafond."
          >
            <input
              className="input w-full py-1.5 text-right"
              value={ceiling}
              onChange={(e) => setCeiling(e.target.value)}
              data-testid="banks-savings-add-ceiling"
            />
          </Field>
          <Field label="Devise">
            <CurrencySelect
              value={currency}
              onChange={setCurrency}
              className="w-full"
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Versement des intérêts">
            <select
              className="input w-full py-1.5"
              value={freq}
              onChange={(e) => setFreq(e.target.value)}
              data-testid="savings-add-frequency"
            >
              <option value="DAILY">Quotidien</option>
              <option value="WEEKLY">Hebdomadaire</option>
              <option value="MONTHLY">Mensuel</option>
              <option value="YEARLY">Annuel</option>
            </select>
          </Field>
          {freq === "WEEKLY" && (
            <Field label="Jour">
              <select
                className="input w-full py-1.5"
                value={dow}
                onChange={(e) => setDow(Number(e.target.value))}
              >
                {DOW_LABELS.slice(1).map((l, i) => (
                  <option key={l} value={i + 1}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {(freq === "MONTHLY" || freq === "YEARLY") && (
            <Field label="Jour du mois">
              <input
                className="input w-full py-1.5 text-right"
                type="number"
                min={1}
                max={31}
                value={dom}
                onChange={(e) => setDom(Number(e.target.value))}
              />
            </Field>
          )}
          {freq === "YEARLY" && (
            <Field label="Mois">
              <select
                className="input w-full py-1.5"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {MONTH_LABELS.slice(1).map((l, i) => (
                  <option key={l} value={i + 1}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Part détenue (%)">
            <input
              className="input w-full py-1.5 text-right"
              type="number"
              min={0}
              max={100}
              value={ownershipPct}
              onChange={(e) => setOwnershipPct(e.target.value)}
            />
          </Field>
          <label className="flex items-end gap-2 pb-1.5 text-xs text-[var(--foreground)]">
            <input
              type="checkbox"
              checked={isPro}
              onChange={(e) => setIsPro(e.target.checked)}
            />
            Livret professionnel
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              onSubmit({
                name,
                bankName: bankName.trim() || null,
                productType,
                ceilingAmount: ceiling || null,
                balance: balance || "0",
                apyPercent: apy || "0",
                rateType,
                payoutFrequency: freq,
                payoutDayOfWeek: freq === "WEEKLY" ? dow : null,
                payoutDayOfMonth:
                  freq === "MONTHLY" || freq === "YEARLY" ? dom : null,
                payoutMonth: freq === "YEARLY" ? month : null,
                currency: currency || "EUR",
                isPro,
                ownershipPct: ownershipPct || null,
              })
            }
            data-testid="banks-savings-add-submit"
          >
            Ajouter
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Dépôt à terme ───────────────────────────────────────────────────── */

export function AddTermDepositModal({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (payload: TermDepositPayload) => void;
  pending: boolean;
}) {
  const [bankName, setBankName] = useState("");
  const [principal, setPrincipal] = useState("10000");
  const [rate, setRate] = useState("3");
  const [currency, setCurrency] = useState("EUR");
  const [openedAt, setOpenedAt] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [maturityDate, setMaturityDate] = useState("");
  const [penalty, setPenalty] = useState("");

  return (
    <Modal title="Nouveau dépôt à terme" onClose={onClose}>
      <div className="space-y-3" data-testid="add-term-deposit-modal">
        <Field label="Banque">
          <BankNameCombobox
            value={bankName}
            onChange={setBankName}
            testId="banks-cat-add-bank-name"
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Principal">
            <input
              className="input w-full py-1.5 text-right"
              value={principal}
              onChange={(e) => setPrincipal(e.target.value)}
              data-testid="banks-cat-add-principal"
            />
          </Field>
          <Field label="Taux (%)">
            <input
              className="input w-full py-1.5 text-right"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              data-testid="banks-cat-add-rate"
            />
          </Field>
          <Field label="Devise">
            <CurrencySelect
              value={currency}
              onChange={setCurrency}
              className="w-full"
            />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Ouverture">
            <input
              type="date"
              className="input w-full py-1.5"
              value={openedAt}
              onChange={(e) => setOpenedAt(e.target.value)}
              data-testid="banks-cat-add-opened"
            />
          </Field>
          <Field label="Échéance">
            <input
              type="date"
              className="input w-full py-1.5"
              value={maturityDate}
              onChange={(e) => setMaturityDate(e.target.value)}
              data-testid="banks-cat-add-maturity"
            />
          </Field>
          <Field
            label="Pénalité (%)"
            hint="Pénalité de retrait anticipé, en % du principal."
          >
            <input
              className="input w-full py-1.5 text-right"
              value={penalty}
              onChange={(e) => setPenalty(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button
            disabled={pending || !maturityDate}
            onClick={() =>
              onSubmit({
                bankName: bankName.trim() || null,
                principal: principal || "0",
                ratePercent: rate || "0",
                currency: currency || "EUR",
                openedAt,
                maturityDate,
                earlyWithdrawalPenaltyPct: penalty || null,
              })
            }
            data-testid="banks-cat-add-submit"
          >
            Ajouter
          </Button>
        </div>
      </div>
    </Modal>
  );
}
