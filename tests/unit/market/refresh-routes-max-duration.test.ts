import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `crypto/defi/valuations/refresh` (boucles séquentielles `recordValuation` /
 * `recordEvent`, une écriture par position) et `prices/refresh` (fetch
 * fournisseurs puis `recordPortfolioSnapshot`) n'avaient pas de `maxDuration`
 * : le défaut Hobby (10 s) coupe avant la fin dès que le compte a plusieurs
 * positions ou plusieurs actifs. Contrôle structurel (lecture du source),
 * même pattern que `backfill-closes.test.ts` : c'est la présence et le
 * plafond déclarés qu'on protège, pas un comportement d'exécution.
 */
describe("routes refresh — maxDuration posé et aligné sur le reste du dépôt", () => {
  const routes = [
    "app/api/crypto/defi/valuations/refresh/route.ts",
    "app/api/prices/refresh/route.ts",
  ];

  it.each(routes)("%s déclare un maxDuration <= 60 (plafond Hobby, 300 interdit)", (relPath) => {
    const source = readFileSync(join(__dirname, "..", "..", "..", relPath), "utf8");
    const m = source.match(/export const maxDuration = (\d+)/);
    expect(m).not.toBeNull();
    const value = Number(m![1]);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(60);
  });
});
