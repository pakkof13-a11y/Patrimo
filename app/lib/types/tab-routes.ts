/**
 * Mapping MainTab ↔ URL App Router.
 * Source de vérité navigation : le pathname (partageable / refresh-safe).
 */

import { isMainTab, type MainTab } from "@/app/lib/types/ui";

/** Chemin canonique pour chaque onglet. */
export function tabToPath(tab: MainTab): string {
  switch (tab) {
    case "dashboard":
      return "/dashboard";
    case "holdings":
      return "/positions";
    case "cto":
      return "/positions/cto";
    case "pea":
      return "/positions/pea";
    case "av":
      return "/positions/av";
    case "crypto":
      return "/cryptos";
    case "securities":
      return "/pea-cto";
    case "immobilier":
      return "/immobilier";
    case "cfd":
      return "/positions/cfd";
    case "banques":
      return "/banques";
    case "assurance-vie":
      return "/assurance-vie";
    case "epargne-salariale":
      return "/epargne-salariale";
    case "alternatifs":
      return "/alternatifs";
    case "trading":
      return "/trading";
    case "transactions":
      return "/transactions";
    case "fiscal":
      return "/fiscalite";
    case "liabilities":
      return "/passifs";
    case "platforms":
      return "/comptes";
    default:
      return "/dashboard";
  }
}

/**
 * Parse un slug catch-all Next.js → MainTab.
 * ex. undefined → dashboard, ["positions","pea"] → pea, ["dashboard"] → dashboard
 */
export function pathToTab(slug?: string[] | null): MainTab {
  if (!slug || slug.length === 0) return "dashboard";

  const [a, b] = slug;
  const head = (a ?? "").toLowerCase();
  const sub = (b ?? "").toLowerCase();

  if (head === "dashboard" || head === "tableau-de-bord") return "dashboard";
  if (head === "transactions") return "transactions";
  if (head === "fiscalite" || head === "fiscal" || head === "tax") return "fiscal";
  if (head === "passifs" || head === "liabilities") return "liabilities";
  if (
    head === "plateformes" ||
    head === "platforms" ||
    head === "comptes" ||
    head === "mes-comptes"
  ) {
    return "platforms";
  }
  if (head === "banques" || head === "banks") return "banques";
  // Écran de saisie des contrats. `/positions/assurance-vie` reste l'enveloppe
  // `av` — c'est la branche `positions` plus bas qui le résout.
  if (head === "assurance-vie" || head === "life-insurance") {
    return "assurance-vie";
  }
  if (head === "epargne-salariale" || head === "epargne") {
    return "epargne-salariale";
  }
  if (head === "alternatifs" || head === "alternatives") return "alternatifs";
  if (head === "trading") return "trading";
  // `/cryptos` est l'URL canonique ; `/crypto` reste accepté (anciens liens,
  // favoris) et redirige vers le même onglet.
  if (head === "cryptos" || head === "crypto" || head === "cryptomonnaies") {
    return "crypto";
  }
  // `/pea-cto` est l'URL canonique des comptes titres ; les autres formes
  // restent acceptées pour les liens directs et les favoris.
  if (head === "pea-cto" || head === "titres" || head === "securities") {
    return "securities";
  }

  if (head === "positions" || head === "holdings" || head === "portefeuille") {
    if (!sub || sub === "all" || sub === "tout") return "holdings";
    // Anciennes URL d'enveloppe : elles mènent désormais à l'onglet dédié,
    // exactement comme `/positions/crypto` mène à l'onglet Cryptos. Une seule
    // destination par sujet, et aucun lien existant ne casse.
    if (sub === "cto" || sub === "compte-titres") return "securities";
    if (sub === "pea") return "securities";
    if (sub === "av" || sub === "assurance-vie") return "av";
    if (sub === "crypto" || sub === "cryptomonnaies") return "crypto";
    if (sub === "immobilier" || sub === "immo") return "immobilier";
    if (sub === "cfd") return "cfd";
    if (isMainTab(sub)) return sub;
    return "holdings";
  }

  // Anciens / liens directs type /pea
  if (isMainTab(head)) return head;

  return "dashboard";
}

/** Segment pathname sans query/hash. */
export function pathnameToTab(pathname: string): MainTab {
  const clean = pathname.split("?")[0]?.split("#")[0] ?? "/";
  const parts = clean.split("/").filter(Boolean);
  return pathToTab(parts);
}
