/**
 * Le seed de démonstration journalise ses enveloppes.
 *
 * Une ligne créée par l'application reçoit un événement `OBSERVED` à sa
 * création. Une ligne créée par le seed n'en recevait aucun : `resolveEnvelopeAt`
 * rendait donc `UNKNOWN` sur tout son passé, y compris sur des périodes où le
 * seed connaît parfaitement l'enveloppe qu'il vient d'établir.
 *
 * Ce fichier vérifie que les données de démonstration portent désormais le même
 * niveau de vérité historique que celles créées via l'application — sans en
 * inventer davantage.
 *
 * ## Ce que le seed contient réellement
 *
 * Neuf lignes CTO et sept lignes PEA. **Aucun compte titres** : le seed n'en
 * crée pas et les supprime tous au nettoyage. `PEA_PME` n'est donc pas
 * représenté — c'est un type de *compte*, pas une valeur d'`accountType`, et
 * fabriquer un compte pour couvrir un test reviendrait à inventer des données.
 *
 * Le contrôle est **structurel** : il lit la source du seed. Exécuter le seed
 * exigerait une base, et ce qu'on veut garantir est l'appel lui-même — un seed
 * qui cesserait de journaliser passerait un test fondé sur un état déjà en
 * place.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveEnvelopeFromEvents } from "@/app/lib/securities/envelope-history";

const racine = join(__dirname, "..", "..", "..");
const seed = readFileSync(join(racine, "prisma/seed-portfolio.ts"), "utf8");

describe("le seed journalise ce qu'il crée", () => {
  it("crée un événement d'enveloppe après chaque actif", () => {
    expect(seed).toMatch(/assetEnvelopeEvent\.create/);
    expect(seed).toMatch(/kind:\s*"OBSERVED"/);
  });

  it("écrit l'actif et son événement dans la même transaction", () => {
    /*
      Le seul état incohérent possible serait un actif créé dont l'événement
      manque. La transaction l'exclut.
    */
    const boucle = seed.slice(seed.indexOf("for (const s of assetSeeds)"));
    const iTransaction = boucle.indexOf("$transaction");
    const iCreation = boucle.indexOf("asset.create");
    const iEvenement = boucle.indexOf("assetEnvelopeEvent.create");

    expect(iTransaction).toBeGreaterThan(-1);
    expect(iTransaction).toBeLessThan(iCreation);
    expect(iCreation).toBeLessThan(iEvenement);
  });

  it("date l'événement sur la création de la ligne, pas sur son acquisition", () => {
    /*
      Le point qui distingue un constat d'une rétro-projection.

      `acquisitionDate` remonte à plusieurs années — 2024 pour des lignes créées
      en 2026. S'en servir affirmerait que l'enveloppe était connue à cette
      date, alors que le seed ne l'établit qu'à l'instant présent.
    */
    const bloc = seed.slice(
      seed.indexOf("assetEnvelopeEvent.create"),
      seed.indexOf("assetEnvelopeEvent.create") + 500
    );
    expect(bloc).toMatch(/occurredAt:\s*cree\.createdAt/);
    expect(bloc).not.toMatch(/acquisitionDate/);
    expect(bloc).not.toMatch(/daysAgo/);
  });

  it("ne journalise que les enveloppes titres", () => {
    /*
      Le périmètre du journal est celui de l'amorçage de sa migration : CTO et
      PEA. Inventer un événement pour une ligne AV, CRYPTO ou IMMOBILIER
      l'élargirait sans que rien ne le demande.
    */
    const bloc = seed.slice(
      seed.indexOf("for (const s of assetSeeds)"),
      seed.indexOf("assetEnvelopeEvent.create")
    );
    expect(bloc).toMatch(/accountType === "CTO" \|\| .*accountType === "PEA"/);
  });

  it("enregistre l'absence de rattachement plutôt que de la taire", () => {
    // Le seed ne crée aucun compte titres : `null` est un constat, pas un oubli.
    const bloc = seed.slice(
      seed.indexOf("assetEnvelopeEvent.create"),
      seed.indexOf("assetEnvelopeEvent.create") + 500
    );
    expect(bloc).toMatch(/securitiesAccountId:\s*null/);
    expect(bloc).toMatch(/envelopeType:\s*null/);
  });
});

describe("le seed reste rejouable sans accumulation", () => {
  it("le nettoyage supprime les actifs, et la cascade emporte leurs événements", () => {
    /*
      L'idempotence est structurelle, pas conditionnelle : `AssetEnvelopeEvent`
      est en cascade sur `Asset`, et le seed supprime les actifs avant de
      recommencer. Aucun garde-fou applicatif n'est nécessaire, et deux reseed
      successifs produisent exactement le même nombre d'événements.
    */
    const nettoyage = readFileSync(join(racine, "prisma/seed.ts"), "utf8");
    expect(nettoyage).toMatch(/asset\.deleteMany/);

    const schema = readFileSync(join(racine, "prisma/schema.prisma"), "utf8");
    const modele = schema.slice(
      schema.indexOf("model AssetEnvelopeEvent"),
      schema.indexOf("model AssetEnvelopeEvent") + 2000
    );
    expect(modele).toMatch(/asset Asset @relation\([^)]*onDelete: Cascade/);
  });
});

describe("ce que la résolution rend sur une ligne seedée", () => {
  /** Un événement tel que le seed le pose : constat, sans compte rattaché. */
  const evenementSeed = (creeLe: Date, accountType: string) => [
    {
      occurredAt: creeLe,
      accountType,
      securitiesAccountId: null,
      envelopeType: null,
    },
  ];

  const CREATION = new Date("2026-08-30T13:55:04.000Z");

  it("l'enveloppe est connue à partir de la création", () => {
    expect(
      resolveEnvelopeFromEvents(evenementSeed(CREATION, "PEA"), CREATION)
    ).toBe("PEA");
    expect(
      resolveEnvelopeFromEvents(
        evenementSeed(CREATION, "CTO"),
        new Date(CREATION.getTime() + 86_400_000)
      )
    ).toBe("CTO");
  });

  it("elle reste inconnue avant, même si la ligne a des opérations plus anciennes", () => {
    /*
      Le cœur du chantier précédent, que celui-ci ne doit pas défaire : une
      ligne seedée porte des transactions de 2024, mais rien ne dit dans quelle
      enveloppe elle se trouvait alors.
    */
    const veille = new Date(CREATION.getTime() - 86_400_000);
    const acquisition = new Date("2024-02-22T10:00:00.000Z");

    expect(resolveEnvelopeFromEvents(evenementSeed(CREATION, "PEA"), veille)).toBe(
      "UNKNOWN"
    );
    expect(
      resolveEnvelopeFromEvents(evenementSeed(CREATION, "PEA"), acquisition)
    ).toBe("UNKNOWN");
  });
});
