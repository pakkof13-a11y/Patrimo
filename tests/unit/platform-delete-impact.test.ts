import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
  Un inventaire ne se demande pas avec un verbe qui détruit.

  La boîte de confirmation obtenait « combien d'actifs, combien d'écritures,
  quels crédits perdraient leur bien » en appelant `DELETE` sans `force`, en
  comptant sur le 409 pour le lui rendre. Ce 409 n'arrive que si la plateforme
  a des dépendances : sans actif ni transaction — une plateforme qu'on vient de
  créer — la route ne refusait rien, elle supprimait. La boîte s'ouvrait alors
  sur une plateforme déjà détruite, et la confirmation repartait en 404
  « Introuvable », la ligne restant à l'écran.

  Le contrôle est structurel : il lit la source. Exécuter le parcours
  demanderait un rendu, dont ce dépôt n'a pas le harnais ; et ce qu'on veut
  garantir est justement qu'aucun appel destructeur ne serve à décrire.
*/

const racine = join(__dirname, "..", "..");
const lire = (p: string) =>
  readFileSync(join(racine, p), "utf8").replace(/\r\n/g, "\n");

const onglet = lire("components/platforms/platforms-tab.tsx");
const route = lire("app/api/platforms/route.ts");

const handleDelete = onglet.slice(
  onglet.indexOf("async function handleDelete("),
  onglet.indexOf("async function syncSolanaWallet(")
);

describe("ouvrir la boîte de suppression ne supprime rien", () => {
  it("l'inventaire est demandé en lecture", () => {
    expect(handleDelete).toMatch(/\/api\/platforms\?impact=/);
  });

  it("aucun DELETE n'est émis pour remplir la boîte", () => {
    expect(handleDelete).not.toMatch(/method:\s*["']DELETE["']/);
  });

  it("la suppression réelle reste explicite et forcée", () => {
    // Le bouton de confirmation, lui, assume le verbe et le `force`.
    expect(onglet).toMatch(/onDelete\(deleteTarget,\s*\{\s*force:\s*true\s*\}\)/);
  });
});

describe("la route expose l'inventaire sans le détruire", () => {
  it("GET répond à `impact` avant toute autre lecture", () => {
    expect(route).toMatch(/searchParams\.get\("impact"\)/);
    expect(route).toMatch(/async function platformImpact\(/);
  });

  it("l'inventaire ne contient aucune suppression", () => {
    const fn = route.slice(
      route.indexOf("async function platformImpact("),
      route.indexOf("export async function GET(")
    );
    expect(fn).not.toMatch(/delete(Many|\b)/i);
  });

  it("un identifiant inconnu de cet utilisateur reste un 404", () => {
    // Ne jamais décrire l'impact d'une plateforme qu'on ne possède pas.
    expect(route).toMatch(/where: \{ id, userId \}/);
  });
});
