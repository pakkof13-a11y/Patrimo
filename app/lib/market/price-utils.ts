/** Décimales d'affichage/stockage adaptées à l'ordre de grandeur du prix. */
export function pricePrecision(price: number): number {
  if (price > 0 && price < 0.01) return 12;
  if (price < 1) return 10;
  return 8;
}
