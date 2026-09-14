/**
 * Journal des enveloppes fiscales — résolution historique.
 *
 * La question posée à chaque test : **à quelle enveloppe cette ligne
 * appartenait-elle à cette date, et le sait-on vraiment ?**
 *
 * Le piège que ce module existe pour éviter tient en une phrase : attribuer
 * l'enveloppe d'aujourd'hui à tout le passé. Une ligne passée du CTO au PEA
 * en 2026 n'a pas été PEA en 2024, et aucune courbe ne doit l'affirmer.
 *
 * Fixtures construites en mémoire. Aucun seed, aucune base, aucun réseau.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@/app/lib/prisma-client/client";
import {
  envelopeOfEvent,
  familyOfAccount,
  resolveEnvelopeAt,
  resolveEnvelopeFromEvents,
  stateAfterAttachment,
  type ResolvedEnvelope,
} from "@/app/lib/securities/envelope-history";

/**
 * Un faux lecteur n'implémente que `findMany` — le reste du délégué Prisma
 * (`create`, `update`…) n'a pas de sens pour une lecture pure. Le cast rend
 * ce choix explicite plutôt que de faire mine d'implémenter les 30 méthodes
 * du délégué réel.
 */
type FakeReader = Pick<PrismaClient, "assetEnvelopeEvent">;

const J = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

/**
 * Un événement du journal.
 *
 * `createdAt` — désormais requis par le type de la fonction pure — vaut par
 * défaut la date métier : les tests qui ne s'intéressent pas au départage
 * entre deux événements simultanés n'ont pas à s'en soucier. `ecritLe` ne sert
 * qu'aux tests qui vérifient explicitement ce départage.
 */
function evt(
  jour: string,
  accountType: string,
  compte?: { id: string; envelopeType: string },
  ecritLe?: string
) {
  return {
    occurredAt: J(jour),
    createdAt: ecritLe ? J(ecritLe) : J(jour),
    accountType,
    securitiesAccountId: compte?.id ?? null,
    envelopeType: compte?.envelopeType ?? null,
  };
}

const PEA = { id: "acc-pea", envelopeType: "PEA" };
const PEA_PME = { id: "acc-pme", envelopeType: "PEA_PME" };
const CTO = { id: "acc-cto", envelopeType: "CTO" };

const resoudre = (
  events: Parameters<typeof resolveEnvelopeFromEvents>[0],
  jour: string
): ResolvedEnvelope => resolveEnvelopeFromEvents(events, J(jour));

describe("création : l'enveloppe de départ est connue", () => {
  it("créée en PEA", () => {
    expect(resoudre([evt("2024-01-10", "PEA", PEA)], "2024-06-01")).toBe("PEA");
  });

  it("créée en CTO", () => {
    expect(resoudre([evt("2024-01-10", "CTO", CTO)], "2024-06-01")).toBe("CTO");
  });

  it("créée en PEA-PME — le compte distingue ce que la famille fiscale confond", () => {
    /*
      `accountType` vaut « PEA » pour les deux plans : c'est la famille
      fiscale. Seul le compte sait lequel des deux détient la ligne.
    */
    expect(resoudre([evt("2024-01-10", "PEA", PEA_PME)], "2024-06-01")).toBe(
      "PEA_PME"
    );
  });

  it("créée sans rattachement : la famille reste connue", () => {
    // Une ligne CTO non rattachée est bien du CTO — l'ignorer serait perdre
    // une information vraie.
    expect(resoudre([evt("2024-01-10", "CTO")], "2024-06-01")).toBe("CTO");
  });
});

describe("changements d'enveloppe", () => {
  it("CTO → PEA : chaque période garde la sienne", () => {
    const journal = [evt("2024-01-01", "CTO", CTO), evt("2025-06-15", "PEA", PEA)];

    expect(resoudre(journal, "2024-08-01")).toBe("CTO");
    expect(resoudre(journal, "2025-12-01")).toBe("PEA");
  });

  it("PEA → CTO", () => {
    const journal = [evt("2024-01-01", "PEA", PEA), evt("2025-06-15", "CTO", CTO)];

    expect(resoudre(journal, "2024-08-01")).toBe("PEA");
    expect(resoudre(journal, "2025-12-01")).toBe("CTO");
  });

  it("PEA → PEA-PME : même famille fiscale, comptes distincts", () => {
    const journal = [
      evt("2024-01-01", "PEA", PEA),
      evt("2025-06-15", "PEA", PEA_PME),
    ];

    expect(resoudre(journal, "2024-08-01")).toBe("PEA");
    expect(resoudre(journal, "2025-12-01")).toBe("PEA_PME");
  });

  it("PEA-PME → PEA", () => {
    const journal = [
      evt("2024-01-01", "PEA", PEA_PME),
      evt("2025-06-15", "PEA", PEA),
    ];

    expect(resoudre(journal, "2024-08-01")).toBe("PEA_PME");
    expect(resoudre(journal, "2025-12-01")).toBe("PEA");
  });

  it("la suite complète du chantier, période par période", () => {
    /*
      01/01/2024 → CTO
      15/06/2025 → PEA
      20/03/2026 → CTO
      01/08/2026 → détachée
    */
    const journal = [
      evt("2024-01-01", "CTO", CTO),
      evt("2025-06-15", "PEA", PEA),
      evt("2026-03-20", "CTO", CTO),
      evt("2026-08-01", "CTO"),
    ];

    expect(resoudre(journal, "2024-06-01")).toBe("CTO");
    expect(resoudre(journal, "2025-06-14")).toBe("CTO");
    expect(resoudre(journal, "2025-06-15")).toBe("PEA");
    expect(resoudre(journal, "2026-03-19")).toBe("PEA");
    expect(resoudre(journal, "2026-03-20")).toBe("CTO");
    expect(resoudre(journal, "2026-07-31")).toBe("CTO");
    // Détachée mais toujours en enveloppe CTO : la famille survit au
    // rattachement.
    expect(resoudre(journal, "2026-08-01")).toBe("CTO");
  });

  it("l'ordre d'écriture ne réordonne pas l'histoire", () => {
    /*
      Les deux événements sont fournis à l'envers de leur chronologie. Seul
      `occurredAt` doit compter : un journal réordonné par la vitesse du
      disque décrirait une autre histoire.
    */
    const desordre = [evt("2025-06-15", "PEA", PEA), evt("2024-01-01", "CTO", CTO)];

    expect(resoudre(desordre, "2024-08-01")).toBe("CTO");
    expect(resoudre(desordre, "2025-12-01")).toBe("PEA");
  });
});

describe("détachement et rattachement", () => {
  it("un détachement est un fait, pas une absence de fait", () => {
    const journal = [evt("2024-01-01", "PEA", PEA), evt("2025-06-15", "PEA")];

    expect(resoudre(journal, "2024-08-01")).toBe("PEA");
    // Toujours PEA par la famille fiscale, mais sans compte : le futur
    // chantier saura distinguer les deux par `securitiesAccountId`.
    expect(resoudre(journal, "2025-12-01")).toBe("PEA");
  });

  it("un rattachement après détachement rétablit le compte", () => {
    const journal = [
      evt("2024-01-01", "PEA", PEA),
      evt("2025-06-15", "PEA"),
      evt("2025-09-01", "PEA", PEA_PME),
    ];

    expect(resoudre(journal, "2025-08-01")).toBe("PEA");
    expect(resoudre(journal, "2025-10-01")).toBe("PEA_PME");
  });

  it("sortir des enveloppes titres se lit comme un détachement", () => {
    // Une ligne devenue AV ou CRYPTO n'appartient plus à aucune enveloppe
    // titres, et le dire est exact.
    const journal = [evt("2024-01-01", "CTO", CTO), evt("2025-06-15", "AV")];

    expect(resoudre(journal, "2024-08-01")).toBe("CTO");
    expect(resoudre(journal, "2025-12-01")).toBe("UNATTACHED");
  });
});

describe("ce qu'on ne sait pas reste inconnu", () => {
  it("avant le premier événement, l'enveloppe est inconnue", () => {
    /*
      Le cœur du chantier. Une ligne dont le journal commence en 2026 ne dit
      rien de 2024 — et surtout pas qu'elle valait déjà son enveloppe
      actuelle.
    */
    const journal = [evt("2026-08-30", "PEA", PEA)];

    expect(resoudre(journal, "2024-01-01")).toBe("UNKNOWN");
    expect(resoudre(journal, "2026-08-29")).toBe("UNKNOWN");
    expect(resoudre(journal, "2026-08-30")).toBe("PEA");
  });

  it("sans aucun événement, tout est inconnu", () => {
    expect(resoudre([], "2024-01-01")).toBe("UNKNOWN");
    expect(resoudre([], "2030-01-01")).toBe("UNKNOWN");
  });

  it("l'enveloppe actuelle ne remplit jamais le passé", () => {
    /*
      La régression que ce module interdit : une ligne aujourd'hui en PEA,
      journalisée depuis peu, ne doit pas se présenter comme PEA depuis
      toujours.
    */
    const journal = [evt("2026-01-01", "PEA", PEA)];
    const avant = ["2020-01-01", "2023-06-15", "2025-12-31"];

    for (const jour of avant) {
      expect(resoudre(journal, jour)).toBe("UNKNOWN");
    }
  });

  it("une date pile sur l'événement prend cet événement", () => {
    // Le changement vaut à partir de l'instant qu'il porte, pas après.
    const journal = [evt("2024-01-01", "CTO", CTO), evt("2025-06-15", "PEA", PEA)];
    expect(resolveEnvelopeFromEvents(journal, J("2025-06-15"))).toBe("PEA");
  });
});

describe("le journal survit à la suppression du compte", () => {
  it("un compte supprimé laisse son type dans l'événement", () => {
    /*
      `envelopeType` est dénormalisé pour cette raison précise : le
      rattachement pointe vers un compte que l'utilisateur peut supprimer.
      Sans copie, `SetNull` effacerait le passé avec le compte.
    */
    const journal = [evt("2024-01-01", "PEA", PEA_PME)];
    expect(resoudre(journal, "2025-01-01")).toBe("PEA_PME");
  });

  it("un type de compte inconnu ne se devine pas", () => {
    // Valeur héritée : on retombe sur la famille fiscale, seule chose
    // affirmable.
    const journal = [
      evt("2024-01-01", "PEA", { id: "x", envelopeType: "PLAN_INCONNU" }),
    ];
    expect(resoudre(journal, "2025-01-01")).toBe("PEA");
  });
});

describe("aides d'écriture", () => {
  it("stateAfterAttachment compose le triplet à journaliser", () => {
    expect(stateAfterAttachment("PEA", PEA_PME)).toEqual({
      accountType: "PEA",
      securitiesAccountId: "acc-pme",
      envelopeType: "PEA_PME",
    });
    expect(stateAfterAttachment("CTO", null)).toEqual({
      accountType: "CTO",
      securitiesAccountId: null,
      envelopeType: null,
    });
  });

  it("familyOfAccount réutilise la correspondance existante", () => {
    // PEA et PEA-PME partagent la famille fiscale : c'est la règle du
    // chantier précédent, et ce module n'en introduit pas une seconde.
    expect(familyOfAccount("PEA")).toBe("PEA");
    expect(familyOfAccount("PEA_PME")).toBe("PEA");
    expect(familyOfAccount("CTO")).toBe("CTO");
    expect(familyOfAccount(null)).toBeNull();
    expect(familyOfAccount("INCONNU")).toBeNull();
  });

  it("envelopeOfEvent privilégie le compte sur la famille", () => {
    // Sans cette priorité, un PEA-PME se lirait « PEA » et la distinction
    // disparaîtrait des courbes futures.
    expect(
      envelopeOfEvent({
        accountType: "PEA",
        securitiesAccountId: "acc-pme",
        envelopeType: "PEA_PME",
      })
    ).toBe("PEA_PME");
  });
});

describe("resolveEnvelopeAt — périmètre de tenant", () => {
  /**
   * Faux lecteur Prisma : reproduit `where` + `orderBy` + `take` en mémoire,
   * assez fidèlement pour vérifier que la fonction filtre bien par `userId` et
   * départage comme la base le ferait — sans base réelle.
   */
  type Row = {
    assetId: string;
    userId: string;
    occurredAt: Date;
    createdAt: Date;
    accountType: string;
    securitiesAccountId: string | null;
    envelopeType: string | null;
  };

  function fakeReader(rows: Row[]) {
    return {
      assetEnvelopeEvent: {
        findMany: async (args: {
          where: { assetId: string; userId: string; occurredAt: { lte: Date } };
          orderBy: unknown;
          take: number;
        }) => {
          const { assetId, userId, occurredAt } = args.where;
          const filtres = rows
            .filter(
              (r) =>
                r.assetId === assetId &&
                r.userId === userId &&
                r.occurredAt.getTime() <= occurredAt.lte.getTime()
            )
            .sort((a, b) => {
              const parOccurredAt = b.occurredAt.getTime() - a.occurredAt.getTime();
              return parOccurredAt !== 0
                ? parOccurredAt
                : b.createdAt.getTime() - a.createdAt.getTime();
            });
          return filtres.slice(0, args.take);
        },
      },
    } as unknown as FakeReader;
  }

  const ROW: Row = {
    assetId: "asset-1",
    userId: "user-A",
    occurredAt: J("2024-01-10"),
    createdAt: J("2024-01-10"),
    accountType: "PEA",
    securitiesAccountId: "acc-pea",
    envelopeType: "PEA",
  };

  it("rend l'enveloppe au propriétaire de la ligne", async () => {
    const reader = fakeReader([ROW]);
    expect(
      await resolveEnvelopeAt(reader, "asset-1", "user-A", J("2024-06-01"))
    ).toBe("PEA");
  });

  it("un assetId d'un autre utilisateur ne rend rien — UNKNOWN, pas une fuite", () => {
    /*
      La régression que ce test verrouille : sans filtre `userId` dans la
      requête, un `assetId` deviné ou fuité par un autre canal rendrait
      l'enveloppe d'une ligne qui n'appartient pas à l'appelant. Le faux
      lecteur applique le même filtre que la vraie requête Prisma — c'est donc
      la fonction elle-même qui est mise en défaut si le filtre disparaît.
    */
    const reader = fakeReader([ROW]);
    return resolveEnvelopeAt(reader, "asset-1", "user-B", J("2024-06-01")).then(
      (r) => expect(r).toBe("UNKNOWN")
    );
  });

  it("un mauvais assetId pour le bon utilisateur ne rend rien non plus", async () => {
    const reader = fakeReader([ROW]);
    expect(
      await resolveEnvelopeAt(reader, "asset-2", "user-A", J("2024-06-01"))
    ).toBe("UNKNOWN");
  });
});

describe("départage à occurredAt égal — même poche, quel que soit l'appelant", () => {
  /*
    Les `AssetEnvelopeEvent` du seed ont été créés en lot, donc à des instants
    `occurredAt` voisins ou identiques. Sans départage explicite sur
    `createdAt`, `resolveEnvelopeFromEvents` retenait le dernier élément
    rencontré dans le tableau — donc l'ordre de la requête qui l'a produit,
    que Postgres ne garantit pas sans clé de tri secondaire.
  */
  const MEME_INSTANT = J("2025-06-15");

  // Deux événements au même `occurredAt`, écrits à quelques secondes d'écart.
  const ecritEnPremier = evt("2025-06-15", "PEA", PEA, "2025-06-15");
  const ecritEnSecond = {
    ...evt("2025-06-15", "PEA", PEA_PME),
    createdAt: new Date(MEME_INSTANT.getTime() + 5_000),
  };

  it("la fonction pure départage sur createdAt, pas sur la position dans le tableau", () => {
    const dansLOrdre = [ecritEnPremier, ecritEnSecond];
    const enDesordre = [ecritEnSecond, ecritEnPremier];

    // Le plus récemment écrit (`ecritEnSecond`, PEA-PME) doit l'emporter dans
    // les deux sens de lecture du tableau.
    expect(resolveEnvelopeFromEvents(dansLOrdre, MEME_INSTANT)).toBe("PEA_PME");
    expect(resolveEnvelopeFromEvents(enDesordre, MEME_INSTANT)).toBe("PEA_PME");
  });

  it("resolveEnvelopeAt départage pareil, en lisant directement la base", async () => {
    const rows = [
      { ...ecritEnPremier, assetId: "asset-1", userId: "user-A" },
      { ...ecritEnSecond, assetId: "asset-1", userId: "user-A" },
    ];
    const reader = {
      assetEnvelopeEvent: {
        findMany: async (args: {
          where: { assetId: string; userId: string; occurredAt: { lte: Date } };
          take: number;
        }) => {
          const { assetId, userId, occurredAt } = args.where;
          return rows
            .filter(
              (r) =>
                r.assetId === assetId &&
                r.userId === userId &&
                r.occurredAt.getTime() <= occurredAt.lte.getTime()
            )
            .sort((a, b) => {
              const parOccurredAt = b.occurredAt.getTime() - a.occurredAt.getTime();
              return parOccurredAt !== 0
                ? parOccurredAt
                : b.createdAt.getTime() - a.createdAt.getTime();
            })
            .slice(0, args.take);
        },
      },
    } as unknown as FakeReader;

    expect(
      await resolveEnvelopeAt(reader, "asset-1", "user-A", MEME_INSTANT)
    ).toBe("PEA_PME");
  });
});

describe("invariants d'écriture — les portes journalisent ce qu'elles écrivent", () => {
  /**
   * Contrôle **structurel** : il lit les sources plutôt que d'exécuter les
   * routes.
   *
   * La raison est celle qui vaut ailleurs dans ce dépôt : c'est l'appel
   * lui-même qu'on veut garantir. Un test qui exercerait une route avec une
   * base mockée passerait aussi bien si la journalisation disparaissait d'une
   * seule des cinq portes — et c'est précisément la porte oubliée qui ferait
   * mentir le journal.
   */
  const lire = (p: string) =>
    readFileSync(join(__dirname, "..", "..", "..", p), "utf8");

  const PORTES = [
    ["création manuelle", "app/api/assets/route.ts"],
    ["import CSV", "app/lib/import/commit.ts"],
    ["changement d'enveloppe", "app/api/assets/[id]/account-type/route.ts"],
    ["rattachement / détachement", "app/lib/securities/account-service.ts"],
  ] as const;

  it.each(PORTES)("%s journalise l'enveloppe", (_nom, chemin) => {
    expect(lire(chemin)).toMatch(/recordEnvelopeEvent\s*\(/);
  });

  it.each(PORTES)("%s écrit dans une transaction", (_nom, chemin) => {
    /*
      L'atomicité n'est pas un détail : sans elle, une écriture réussie suivie
      d'une journalisation en échec laisserait durablement un état courant que
      le journal contredit.
    */
    expect(lire(chemin)).toMatch(/\$transaction\s*\(/);
  });

  it("la suppression d'un compte journalise avant de supprimer", () => {
    /*
      Le détachement par suppression n'a aucun code applicatif : il se produit
      dans la base, par `SetNull`. C'était la seule porte capable de changer un
      rattachement sans laisser de trace. L'ordre importe — après la
      suppression, on ne saurait plus quelles lignes le compte portait.
    */
    const src = lire("app/lib/securities/account-service.ts");
    const bloc = src.slice(src.indexOf("export async function deleteAccount"));
    const iJournal = bloc.indexOf("recordEnvelopeEvent");
    const iSuppression = bloc.indexOf("securitiesAccount.deleteMany");

    expect(iJournal).toBeGreaterThan(-1);
    expect(iSuppression).toBeGreaterThan(-1);
    expect(iJournal).toBeLessThan(iSuppression);
  });

  it("aucune migration ne fabrique d'événement daté du passé", () => {
    /*
      L'amorçage pose un constat daté de `NOW()`, jamais de `createdAt` ni de
      la première transaction : ces deux dates ne disent rien de l'entrée dans
      l'enveloppe. Mesuré sur le compte de démonstration — seize lignes créées
      en 2026 pour des opérations de 2023.
    */
    const sql = lire(
      "prisma/migrations/20260830130203_asset_envelope_event/migration.sql"
    );
    expect(sql).toMatch(/'OBSERVED'/);
    expect(sql).toMatch(/NOW\(\)/);
    // Ni la date de création de la ligne, ni celle de ses opérations.
    expect(sql).not.toMatch(/a\."createdAt"/);
    expect(sql).not.toMatch(/FROM "Transaction"/);
  });
});
