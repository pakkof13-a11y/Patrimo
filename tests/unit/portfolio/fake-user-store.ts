import { Prisma } from "@/app/lib/prisma-client/client";

/**
 * Faux client Prisma EN MÉMOIRE pour les tests de wipe / suppression de
 * compte (AUTH-02, JOU-04). Même patron que
 * `tests/unit/import/imp-11-imp-04-atomic-row.test.ts` : un magasin de
 * tableaux, un `$transaction` qui prend un instantané et le restaure si le
 * callback lève (sémantique ROLLBACK), et — en plus — la reproduction des
 * contraintes `onDelete` réelles de `prisma/schema.prisma` qui comptent pour
 * ces deux tickets :
 *
 *  - `Restrict` : `Asset.platformId`, `Transaction.platformId`,
 *    `Transaction.toPlatformId`, `Transaction.assetId`,
 *    `SecuritiesAccount.platformId`, `NftItemDetail.nftAssetId` → la
 *    suppression du parent lève `P2003` tant qu'un enfant le référence.
 *  - `Cascade` : enfants sans relation directe à `User` emportés par leur
 *    parent (`BlockchainOnchainTx`, `AssetEnvelopeEvent`, `NftItemDetail`,
 *    `SecuritiesAccountContribution`, `LiabilityEvent`, …).
 *  - `user.delete` : cascade DB depuis `User` vers tout ce qui porte une FK
 *    vers lui — donc PAS `Transaction`, qui n'en a aucune — puis vérification
 *    des `Restrict` ci-dessus, exactement comme Postgres.
 *
 * Aucun `DATABASE_URL` n'est lu : rien ne sort du processus de test.
 */

export type Row = Record<string, unknown> & { id: string };

type Where = Record<string, unknown>;

type Edge = { child: string; fk: string };

/** FK `onDelete: Restrict` (prisma/schema.prisma), indexées par le parent. */
const RESTRICT: Record<string, Edge[]> = {
  platform: [
    { child: "asset", fk: "platformId" },
    { child: "transaction", fk: "platformId" },
    { child: "transaction", fk: "toPlatformId" },
    { child: "securitiesAccount", fk: "platformId" },
  ],
  asset: [{ child: "transaction", fk: "assetId" }],
  nftAsset: [{ child: "nftItemDetail", fk: "nftAssetId" }],
};

/** FK `onDelete: Cascade` utiles ici (enfants sans FK directe vers `User`). */
const CASCADE: Record<string, Edge[]> = {
  platform: [{ child: "blockchainOnchainTx", fk: "platformId" }],
  asset: [
    { child: "nftItemDetail", fk: "assetId" },
    { child: "assetEnvelopeEvent", fk: "assetId" },
  ],
  securitiesAccount: [
    { child: "securitiesAccountContribution", fk: "securitiesAccountId" },
  ],
  liability: [{ child: "liabilityEvent", fk: "liabilityId" }],
  lifeInsurance: [{ child: "lifeInsuranceProduct", fk: "lifeInsuranceId" }],
  tangibleAsset: [{ child: "tangibleValuation", fk: "tangibleId" }],
  envelopeCash: [{ child: "envelopeCashEvent", fk: "envelopeCashId" }],
};

/**
 * Modèles qui portent une colonne `userId` SANS relation vers `User`
 * (cf. schéma) : la cascade DB depuis `User` ne les touche jamais.
 */
const NO_FK_TO_USER = new Set([
  "transaction",
  "blockchainOnchainTx",
  "assetEnvelopeEvent",
  "tangibleValuation",
  "envelopeCashEvent",
]);

/**
 * Modèles rattachés à `User` que le wipe conserve à dessein (identité de
 * connexion) mais que `user.delete` emporte en cascade.
 */
export const AUTH_IDENTITY_MODELS = new Set(["account", "session"]);

const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function p2003(constraint: string) {
  return new Prisma.PrismaClientKnownRequestError(
    `Foreign key constraint violated on the constraint: \`${constraint}\``,
    { code: "P2003", clientVersion: "test" }
  );
}

export function p2025(model: string) {
  return new Prisma.PrismaClientKnownRequestError(
    "An operation failed because it depends on one or more records that were required but not found. Record to delete does not exist.",
    { code: "P2025", clientVersion: "test", meta: { modelName: pascal(model) } }
  );
}

export type Call = { model: string; op: string; where: Where | undefined };

export function makeFakeUserStore() {
  const tables = new Map<string, Row[]>();
  const calls: Call[] = [];
  /** Panne injectée pour une opération précise (`"user.delete"`), une fois. */
  let injectedFailure: { key: string; error: Error } | null = null;

  function table(model: string): Row[] {
    let rows = tables.get(model);
    if (!rows) {
      rows = [];
      tables.set(model, rows);
    }
    return rows;
  }

  function matches(row: Row, where: Where): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        // Filtre relationnel `{ liability: { userId } }` → la ligne parente
        // désignée par `${k}Id`.
        const parent = table(k).find((r) => r.id === row[`${k}Id`]);
        return parent ? matches(parent, v as Where) : false;
      }
      return row[k] === v;
    });
  }

  /** Supprime des lignes en appliquant Restrict puis Cascade, comme Postgres. */
  function removeRows(model: string, ids: Set<string>) {
    if (ids.size === 0) return;
    for (const r of RESTRICT[model] ?? []) {
      if (table(r.child).some((c) => ids.has(c[r.fk] as string))) {
        throw p2003(`${pascal(r.child)}_${r.fk}_fkey`);
      }
    }
    for (const c of CASCADE[model] ?? []) {
      const childIds = new Set(
        table(c.child)
          .filter((row) => ids.has(row[c.fk] as string))
          .map((row) => row.id)
      );
      removeRows(c.child, childIds);
    }
    tables.set(
      model,
      table(model).filter((r) => !ids.has(r.id))
    );
  }

  /** `DELETE FROM "User" WHERE id = $1` avec cascade DB + FK Restrict. */
  function deleteUser(id: string): Row {
    const user = table("user").find((u) => u.id === id);
    if (!user) throw p2025("user");
    for (const [model, rows] of tables) {
      if (model === "user" || NO_FK_TO_USER.has(model)) continue;
      const ids = new Set(rows.filter((r) => r.userId === id).map((r) => r.id));
      removeRows(model, ids);
    }
    tables.set(
      "user",
      table("user").filter((u) => u.id !== id)
    );
    return user;
  }

  function takeInjectedFailure(key: string): Error | null {
    if (injectedFailure && injectedFailure.key === key) {
      const err = injectedFailure.error;
      injectedFailure = null;
      return err;
    }
    return null;
  }

  function modelHandler(model: string) {
    return {
      deleteMany: async ({ where }: { where: Where }) => {
        calls.push({ model, op: "deleteMany", where });
        const failure = takeInjectedFailure(`${model}.deleteMany`);
        if (failure) throw failure;
        const victims = table(model).filter((r) => matches(r, where));
        removeRows(model, new Set(victims.map((r) => r.id)));
        return { count: victims.length };
      },
      count: async (args?: { where?: Where }) =>
        table(model).filter((r) => matches(r, args?.where ?? {})).length,
      findMany: async (args?: { where?: Where }) =>
        table(model).filter((r) => matches(r, args?.where ?? {})),
      findUnique: async ({ where }: { where: { id: string } }) => {
        calls.push({ model, op: "findUnique", where });
        return table(model).find((r) => r.id === where.id) ?? null;
      },
      create: async ({ data }: { data: Row }) => {
        table(model).push({ ...data });
        return data;
      },
      delete: async ({ where }: { where: { id: string } }) => {
        calls.push({ model, op: "delete", where });
        const failure = takeInjectedFailure(`${model}.delete`);
        if (failure) throw failure;
        if (model === "user") return deleteUser(where.id);
        const row = table(model).find((r) => r.id === where.id);
        if (!row) throw p2025(model);
        removeRows(model, new Set([row.id]));
        return row;
      },
    };
  }

  function snapshot(): Map<string, Row[]> {
    const copy = new Map<string, Row[]>();
    for (const [k, v] of tables) copy.set(k, v.slice());
    return copy;
  }

  function restore(snap: Map<string, Row[]>) {
    tables.clear();
    for (const [k, v] of snap) tables.set(k, v.slice());
  }

  // Proxy : n'importe quel accesseur de modèle (`tx.termDeposit`, …) renvoie
  // un gestionnaire branché sur le magasin — inutile de lister à la main les
  // ~35 modèles que `resetUserData` cible.
  const client: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "$transaction") {
          return async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
            const snap = snapshot();
            try {
              return await fn(client);
            } catch (e) {
              restore(snap);
              throw e;
            }
          };
        }
        // `await client` / `vi.mock` sondent `then` : ne pas se faire passer
        // pour un thenable.
        if (typeof prop !== "string" || prop === "then") return undefined;
        return modelHandler(prop);
      },
    }
  );

  /** Insère une ligne brute (fixture), sans passer par le client. */
  function seed(model: string, row: Row) {
    table(model).push(row);
  }

  /**
   * Nombre de lignes d'un modèle pour un utilisateur donné (pour `user`,
   * la ligne du compte lui-même, identifiée par `id`).
   */
  function countFor(model: string, userId: string): number {
    if (model === "user") return table(model).filter((r) => r.id === userId).length;
    return table(model).filter((r) => r.userId === userId).length;
  }

  /** Tous les modèles présents dans le magasin (seedés). */
  function models(): string[] {
    return [...tables.keys()];
  }

  function failNext(key: string, error: Error) {
    injectedFailure = { key, error };
  }

  return { client, calls, seed, countFor, models, table, failNext, deleteUser };
}

/**
 * Peuple, pour un utilisateur, une ligne dans chaque modèle rattaché à
 * `User` (+ les enfants sans FK vers `User`), avec des FK cohérentes entre
 * elles : plateforme ← actif ← transaction, plateforme ← compte-titres, etc.
 *
 * `extraUserModels` : modèles supplémentaires (issus du schéma) à peupler
 * avec une simple ligne `{ id, userId }`.
 */
export function seedUserGraph(
  store: ReturnType<typeof makeFakeUserStore>,
  userId: string,
  extraUserModels: Iterable<string> = []
) {
  const id = (model: string) => `${model}-${userId}`;
  const seeded = new Set<string>();
  const put = (model: string, row: Record<string, unknown>) => {
    seeded.add(model);
    store.seed(model, { id: id(model), userId, ...row });
  };

  // La ligne `User` porte l'id de l'utilisateur lui-même (pas `user-<id>`).
  seeded.add("user");
  store.seed("user", {
    id: userId,
    username: userId,
    email: `${userId}@test.local`,
    role: "USER",
  });
  put("account", {});
  put("session", {});

  put("platform", { name: `Plateforme ${userId}` });
  put("asset", { platformId: id("platform"), ticker: "AAPL" });
  put("transaction", {
    platformId: id("platform"),
    assetId: id("asset"),
    type: "ACHAT",
  });
  put("blockchainOnchainTx", { platformId: id("platform") });
  put("assetEnvelopeEvent", { assetId: id("asset") });
  put("securitiesAccount", { platformId: id("platform") });
  put("securitiesAccountContribution", {
    securitiesAccountId: id("securitiesAccount"),
  });
  put("nftAsset", {});
  put("nftItemDetail", { assetId: id("asset"), nftAssetId: id("nftAsset") });
  put("liability", {});
  put("liabilityEvent", { liabilityId: id("liability") });
  put("lifeInsurance", {});
  put("lifeInsuranceProduct", { lifeInsuranceId: id("lifeInsurance") });
  put("tangibleAsset", {});
  put("tangibleValuation", { tangibleId: id("tangibleAsset") });
  put("envelopeCash", {});
  put("envelopeCashEvent", { envelopeCashId: id("envelopeCash") });

  for (const model of extraUserModels) {
    if (!seeded.has(model)) put(model, {});
  }

  return seeded;
}
