/**
 * Export CSV d'un tableau d'amortissement.
 *
 * Déplacé depuis l'ancien panneau de détail de l'onglet Passifs, sans changer
 * une ligne de son format : point-virgule comme séparateur, virgule décimale
 * et BOM UTF-8 — les trois conditions pour qu'un tableur français ouvre le
 * fichier correctement du premier coup.
 *
 * La génération est **pure** et testable ; seul le téléchargement touche au
 * DOM, et vit donc à part.
 */

import { formatDate } from "@/app/lib/utils";
import type { AmortizationRow } from "./amortization";

export function slugifyFilename(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function generateAmortizationCsv(schedule: AmortizationRow[]): string {
  const rows = [
    "﻿", // BOM UTF-8 — sans lui, Excel massacre les accents.
  ];

  rows.push(
    [
      "#",
      "Échéance",
      "Capital remboursé",
      "Intérêts",
      "Assurance",
      "Mensualité",
      "Capital restant",
    ].join(";")
  );

  for (const row of schedule) {
    rows.push(
      [
        row.index.toString(),
        row.dueDate ? formatDate(row.dueDate) : "",
        row.principalPaid.replace(".", ","),
        row.interest.replace(".", ","),
        row.insurance.replace(".", ","),
        row.payment.replace(".", ","),
        row.remainingAfter.replace(".", ","),
      ].join(";")
    );
  }

  return rows.join("\n");
}

/** Nom de fichier : `amortissement-<crédit>-<AAAAMMJJ>.csv`. */
export function amortizationFilename(
  liabilityName: string,
  now = new Date()
): string {
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `amortissement-${slugifyFilename(liabilityName)}-${dateStr}.csv`;
}

/** Déclenche le téléchargement côté navigateur. */
export function downloadAmortizationCsv(
  schedule: AmortizationRow[],
  liabilityName: string
): void {
  const csv = generateAmortizationCsv(schedule);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = amortizationFilename(liabilityName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
