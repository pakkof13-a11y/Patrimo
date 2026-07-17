/**
 * Helpers d’affichage pagination — jamais de « Page 0 / 0 ».
 */

/** Libellé « Page X / Y » ; tiret si aucune ligne. */
export function formatPageLabel(
  pageIndex: number,
  pageCount: number,
  totalItems: number
): string {
  if (totalItems <= 0) return "—";
  const pages = Math.max(1, pageCount);
  const current = Math.min(Math.max(1, pageIndex + 1), pages);
  return `Page ${current} / ${pages}`;
}

/** Plage « a–b sur n » ou message vide. */
export function formatRangeLabel(
  pageIndex: number,
  pageSize: number,
  totalItems: number,
  emptyLabel = "Aucune ligne"
): string {
  if (totalItems <= 0) return emptyLabel;
  const from = pageIndex * pageSize + 1;
  const to = Math.min(totalItems, (pageIndex + 1) * pageSize);
  return `${from}–${to} sur ${totalItems}`;
}

/** Afficher les contrôles de navigation uniquement s’il y a des lignes. */
export function shouldShowPaginationNav(totalItems: number): boolean {
  return totalItems > 0;
}
