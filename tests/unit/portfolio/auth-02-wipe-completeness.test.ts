import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_IDENTITY_MODELS,
  makeFakeUserStore,
  p2003,
  seedUserGraph,
} from "./fake-user-store";

/**
 * AUTH-02 — test « golden » de complétude du wipe (`resetUserData`).
 *
 * L'audit signalait que `TermDeposit`, `PreciousMetalSale`, `DefiMarketRef`
 * et `SecuritiesAccount` échappaient à la réinitialisation. Plutôt que de ne
 * vérifier que ces quatre-là, ce test dérive la liste des modèles rattachés à
 * `User` DEPUIS `prisma/schema.prisma` (les relations inverses `Xxx[]`
 * déclarées dans `model User`) : si un futur modèle est rattaché à `User`
 * sans être ajouté au wipe, il échoue.
 *
 * Magasin Prisma en mémoire (`fake-user-store.ts`) : une ligne par modèle et
 * par utilisateur, deux utilisateurs, FK `Restrict` / `Cascade` du schéma
 * reproduites. Aucune base réelle n'est touchée.
 */

let store: ReturnType<typeof makeFakeUserStore>;

vi.mock("@/app/lib/prisma", () => ({
  get prisma() {
    return store.client;
  },
}));

import { resetUserData } from "@/app/lib/portfolio/clear-user-data";

const VICTIM = "u-victim";
const OTHER = "u-other";

/** Accesseur client Prisma (`TermDeposit` → `termDeposit`). */
const camel = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Relations inverses `xxx Model[]` déclarées dans `model User { … }`. */
function userRelatedModelsFromSchema(): string[] {
  const schema = readFileSync(
    path.resolve(__dirname, "../../../prisma/schema.prisma"),
    "utf8"
  );
  const block = /model User \{([\s\S]*?)\n\}/.exec(schema);
  if (!block) throw new Error("model User introuvable dans schema.prisma");
  const models: string[] = [];
  for (const line of block[1]!.split("\n")) {
    const m = /^\s+\w+\s+(\w+)\[\]/.exec(line);
    if (m) models.push(camel(m[1]!));
  }
  return models;
}

const SCHEMA_USER_MODELS = userRelatedModelsFromSchema();
const WIPE_MODELS = SCHEMA_USER_MODELS.filter((m) => !AUTH_IDENTITY_MODELS.has(m));

beforeEach(() => {
  store = makeFakeUserStore();
  seedUserGraph(store, VICTIM, SCHEMA_USER_MODELS);
  seedUserGraph(store, OTHER, SCHEMA_USER_MODELS);
});

describe("AUTH-02 — resetUserData efface TOUT ce qui est rattaché à User", () => {
  it("le schéma expose bien les relations inverses attendues (garde du parseur)", () => {
    expect(SCHEMA_USER_MODELS.length).toBeGreaterThanOrEqual(25);
    for (const m of [
      "termDeposit",
      "preciousMetalSale",
      "defiMarketRef",
      "securitiesAccount",
      "platform",
      "asset",
      "account",
      "session",
    ]) {
      expect(SCHEMA_USER_MODELS).toContain(m);
    }
  });

  it("chaque modèle rattaché à User (hors identité de connexion) est ciblé par un deleteMany filtré sur userId", async () => {
    await resetUserData(VICTIM);

    const touched = new Set(
      store.calls
        .filter(
          (c) =>
            c.op === "deleteMany" &&
            (c.where as { userId?: string } | undefined)?.userId === VICTIM
        )
        .map((c) => c.model)
    );
    const missing = WIPE_MODELS.filter((m) => !touched.has(m));
    expect(missing).toEqual([]);
  });

  it("après le wipe : 0 ligne pour l'utilisateur sur chaque modèle du magasin, identité conservée", async () => {
    await resetUserData(VICTIM);

    const leftovers = store
      .models()
      .filter(
        (m) => m !== "user" && !AUTH_IDENTITY_MODELS.has(m) && store.countFor(m, VICTIM) > 0
      );
    expect(leftovers).toEqual([]);

    // « Keeps: User account » — le compte et son identité de connexion restent.
    expect(store.countFor("account", VICTIM)).toBe(1);
    expect(store.countFor("session", VICTIM)).toBe(1);
    expect(store.table("user").some((u) => u.id === VICTIM)).toBe(true);
  });

  it("(AUTH-02) TermDeposit, PreciousMetalSale, DefiMarketRef, SecuritiesAccount : count === 0 et compteurs renvoyés", async () => {
    for (const m of ["termDeposit", "preciousMetalSale", "defiMarketRef", "securitiesAccount"]) {
      expect(store.countFor(m, VICTIM)).toBe(1);
    }

    const r = await resetUserData(VICTIM);

    expect(store.countFor("termDeposit", VICTIM)).toBe(0);
    expect(store.countFor("preciousMetalSale", VICTIM)).toBe(0);
    expect(store.countFor("defiMarketRef", VICTIM)).toBe(0);
    expect(store.countFor("securitiesAccount", VICTIM)).toBe(0);
    // Cascade DB depuis SecuritiesAccount.
    expect(store.countFor("securitiesAccountContribution", VICTIM)).toBe(0);

    expect(r.termDepositsDeleted).toBe(1);
    expect(r.preciousMetalSalesDeleted).toBe(1);
    expect(r.defiMarketRefsDeleted).toBe(1);
    expect(r.securitiesAccountsDeleted).toBe(1);
  });

  it("isolation : les lignes de l'AUTRE utilisateur sont intactes sur chaque modèle", async () => {
    const before = Object.fromEntries(store.models().map((m) => [m, store.countFor(m, OTHER)]));
    expect(Object.values(before).every((n) => n === 1)).toBe(true);

    await resetUserData(VICTIM);

    const after = Object.fromEntries(store.models().map((m) => [m, store.countFor(m, OTHER)]));
    expect(after).toMatchObject(before);
    expect(store.table("user").some((u) => u.id === OTHER)).toBe(true);
  });

  it("garde du simulateur : supprimer une plateforme encore référencée lève P2003, et la transaction est rollbackée", async () => {
    // Prouve que le magasin reproduit bien la contrainte Restrict : sans
    // l'ordre imposé par `resetUserData`, l'ancien code aurait échoué ici.
    const tx = store.client as {
      platform: { deleteMany: (a: { where: { userId: string } }) => Promise<unknown> };
      $transaction: <T>(fn: (tx: unknown) => Promise<T>) => Promise<T>;
    };
    await expect(tx.platform.deleteMany({ where: { userId: VICTIM } })).rejects.toMatchObject({
      code: "P2003",
    });

    // Rollback : une suppression partielle suivie d'une panne ne laisse rien.
    await expect(
      tx.$transaction(async () => {
        await (
          store.client as { termDeposit: { deleteMany: (a: unknown) => Promise<unknown> } }
        ).termDeposit.deleteMany({ where: { userId: VICTIM } });
        throw p2003("Simulated_fkey");
      })
    ).rejects.toMatchObject({ code: "P2003" });
    expect(store.countFor("termDeposit", VICTIM)).toBe(1);
  });
});
