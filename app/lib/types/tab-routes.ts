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
      return "/positions/crypto";
    case "immobilier":
      return "/positions/immobilier";
    case "cfd":
      return "/positions/cfd";
    case "banques":
      return "/banques";
    case "epargne-salariale":
      return "/epargne-salariale";
    case "alternatifs":
      return "/alternatifs";
    case "transactions":
      return "/transactions";
    case "fiscal":
      return "/fiscalite";
    case "liabilities":
      return "/passifs";
    case "platforms":
      return "/plateformes";
    default:
      return "/positions";
  }
}

/**
 * Parse un slug catch-all Next.js → MainTab.
 * ex. undefined → holdings, ["positions","pea"] → pea, ["dashboard"] → dashboard
 */
export function pathToTab(slug?: string[] | null): MainTab {
  if (!slug || slug.length === 0) return "holdings";

  const [a, b] = slug;
  const head = (a ?? "").toLowerCase();
  const sub = (b ?? "").toLowerCase();

  if (head === "dashboard" || head === "tableau-de-bord") return "dashboard";
  if (head === "transactions") return "transactions";
  if (head === "fiscalite" || head === "fiscal" || head === "tax") return "fiscal";
  if (head === "passifs" || head === "liabilities") return "liabilities";
  if (head === "plateformes" || head === "platforms") return "platforms";
  if (head === "banques" || head === "banks") return "banques";
  if (head === "epargne-salariale" || head === "epargne") {
    return "epargne-salariale";
  }
  if (head === "alternatifs" || head === "alternatives") return "alternatifs";

  if (head === "positions" || head === "holdings" || head === "portefeuille") {
    if (!sub || sub === "all" || sub === "tout") return "holdings";
    if (sub === "cto" || sub === "compte-titres") return "cto";
    if (sub === "pea") return "pea";
    if (sub === "av" || sub === "assurance-vie") return "av";
    if (sub === "crypto" || sub === "cryptomonnaies") return "crypto";
    if (sub === "immobilier" || sub === "immo") return "immobilier";
    if (sub === "cfd") return "cfd";
    if (isMainTab(sub)) return sub;
    return "holdings";
  }

  // Anciens / liens directs type /pea
  if (isMainTab(head)) return head;

  return "holdings";
}

/** Segment pathname sans query/hash. */
export function pathnameToTab(pathname: string): MainTab {
  const clean = pathname.split("?")[0]?.split("#")[0] ?? "/";
  const parts = clean.split("/").filter(Boolean);
  return pathToTab(parts);
}
