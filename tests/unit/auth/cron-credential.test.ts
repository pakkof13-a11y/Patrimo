import { describe, expect, it } from "vitest";
import {
  hasCronCredential,
  isCronPath,
  readCronCredential,
} from "@/app/lib/auth/cron-credential";

/**
 * La porte des tâches planifiées.
 *
 * Le proxy couvre `/api/**` et redirige vers `/login` toute requête sans
 * session. Une tâche Vercel Cron n'en a pas : elle n'apporte qu'un en-tête.
 * `POST /api/savings/accrue`, pourtant documenté comme le cron des intérêts de
 * livrets, était donc redirigé et n'a jamais pu s'exécuter — constaté en 307
 * avec le bon secret.
 *
 * Ces deux prédicats sont la dispense. Ils décident de *ne pas rediriger* ;
 * ils n'autorisent rien. Le handler vérifie le secret en temps constant et
 * répond 401 s'il est faux.
 */

const req = (headers: Record<string, string>) => ({
  headers: {
    get: (n: string) => headers[n.toLowerCase()] ?? null,
  },
});

describe("lecture de la créance", () => {
  it("lit un jeton Bearer", () => {
    expect(readCronCredential(req({ authorization: "Bearer abc123" }))).toBe("abc123");
  });

  it("accepte la casse libre du schéma", () => {
    expect(readCronCredential(req({ authorization: "bearer abc123" }))).toBe("abc123");
  });

  it("lit l'en-tête dédié pour les ordonnanceurs sans Authorization", () => {
    expect(readCronCredential(req({ "x-cron-secret": "abc123" }))).toBe("abc123");
  });

  it("ignore un Bearer vide et retombe sur l'en-tête dédié", () => {
    expect(
      readCronCredential(req({ authorization: "Bearer   ", "x-cron-secret": "xyz" }))
    ).toBe("xyz");
  });

  it("rend null sans en-tête", () => {
    expect(readCronCredential(req({}))).toBeNull();
    expect(hasCronCredential(req({}))).toBe(false);
  });

  it("ne confond pas une autre autorisation avec un cron", () => {
    expect(readCronCredential(req({ authorization: "Basic dXNlcjpwdw==" }))).toBeNull();
  });
});

describe("périmètre de la dispense", () => {
  it("couvre le répertoire des tâches planifiées", () => {
    expect(isCronPath("/api/cron/collect-intraday")).toBe(true);
  });

  it("couvre la route historique des livrets", () => {
    expect(isCronPath("/api/savings/accrue")).toBe(true);
  });

  it("ne couvre pas le reste de l'API", () => {
    /*
      Le test qui compte. Si la dispense débordait, un en-tête inventé
      suffirait à franchir le proxy sur n'importe quelle route — y compris
      celles qui n'appellent pas `requireUserId`.
    */
    for (const p of [
      "/api/portfolio",
      "/api/savings",
      "/api/transactions",
      "/api/platforms",
      "/api/prices/refresh",
      "/api/savings/accrue/extra",
      "/api/cron",
      "/cron/collect-intraday",
      "/",
    ]) {
      expect(isCronPath(p), `${p} ne doit pas être dispensé`).toBe(false);
    }
  });
});

describe("la dispense n'est pas une autorisation", () => {
  it("une créance fausse franchit le proxy mais reste à vérifier", () => {
    /*
      `hasCronCredential` ne juge que la forme : c'est voulu. Comparer le
      secret ici créerait deux autorités pour une seule décision, et
      `timingSafeEqualSecret` dépend de `node:crypto`, dont la disponibilité
      dans le proxy n'est pas garantie. Le handler tranche — vérifié en bout
      de chaîne : mauvais secret → 401.
    */
    expect(hasCronCredential(req({ authorization: "Bearer n-importe-quoi" }))).toBe(true);
  });
});
