import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  chromiumCandidates,
  defaultBrowsersPool,
  explainChromiumSearch,
  splitExpectedPath,
} from "../../tools/input-cascade/harness.mjs";

/**
 * Trouver le navigateur, et le dire quand on n'y arrive pas.
 *
 * Ces deux tests-là ne demandent aucun navigateur : c'est le point. La
 * résolution ne connaissait que Linux — `chrome-linux/chrome` et
 * `chrome-headless-shell-linux64/…` — et ne consultait `PLAYWRIGHT_BROWSERS_PATH`
 * que si la variable était posée. Sous Windows, où elle ne l'est pas, la
 * fonction se réduisait à « le build exact qu'attend Playwright, ou rien », et
 * son `null` faisait sauter deux mesures sans un mot.
 *
 * La disposition de chaque plateforme se vérifie donc ici, depuis n'importe
 * quelle machine, plutôt qu'au hasard de celle qui exécute la suite.
 */

/** Chemins construits comme l'hôte les écrit, pour que les tests ne dépendent pas de lui. */
const pool = (...segments: string[]) => path.join(...segments);

describe("splitExpectedPath", () => {
  it("apprend la disposition de la plateforme du chemin que Playwright annonce", () => {
    const attendu = pool("C:", "Users", "x", "ms-playwright", "chromium-1228", "chrome-win64", "chrome.exe");
    expect(splitExpectedPath(attendu)).toEqual({
      pool: pool("C:", "Users", "x", "ms-playwright"),
      layout: pool("chrome-win64", "chrome.exe"),
    });
  });

  it("suit une disposition profonde sans la tronquer", () => {
    // macOS enfouit l'exécutable de quatre niveaux — un découpage à nombre de
    // segments fixe s'y tromperait.
    const attendu = pool("/Users/x/Library/Caches/ms-playwright", "chromium-1228", "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium");
    expect(splitExpectedPath(attendu)?.layout).toBe(
      pool("chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium")
    );
  });

  it("rend null quand aucun dossier de build n'apparaît", () => {
    expect(splitExpectedPath(pool("/usr/bin/chromium"))).toBeNull();
  });
});

describe("defaultBrowsersPool", () => {
  /*
    Sans cet emplacement par défaut, l'ancienne boucle de repli ne s'exécutait
    tout simplement pas : `PLAYWRIGHT_BROWSERS_PATH` n'est pas posé sur une
    installation ordinaire.
  */
  it("connaît les trois emplacements par défaut", () => {
    expect(defaultBrowsersPool("win32", { LOCALAPPDATA: pool("C:", "u", "AppData", "Local") })).toBe(
      pool("C:", "u", "AppData", "Local", "ms-playwright")
    );
    expect(defaultBrowsersPool("darwin", { HOME: pool("/Users/x") })).toBe(
      pool("/Users/x", "Library", "Caches", "ms-playwright")
    );
    expect(defaultBrowsersPool("linux", { HOME: pool("/home/x") })).toBe(
      pool("/home/x", ".cache", "ms-playwright")
    );
  });

  it("rend null plutôt qu'un chemin inventé quand l'environnement ne dit rien", () => {
    expect(defaultBrowsersPool("win32", {})).toBeNull();
    expect(defaultBrowsersPool("linux", {})).toBeNull();
  });
});

describe("chromiumCandidates", () => {
  const RACINE = pool("C:", "u", "AppData", "Local", "ms-playwright");

  /*
    Le cas exact qui a produit trois semaines de faux vert : Playwright attend
    le build 1228, seul le 1234 est installé. L'ancienne fonction ne proposait
    que `chrome-linux/chrome` — introuvable sous Windows — et rendait null.
  */
  it("Windows : retombe sur le build présent quand l'attendu manque", () => {
    const search = chromiumCandidates({
      platform: "win32",
      expected: pool(RACINE, "chromium-1228", "chrome-win64", "chrome.exe"),
      env: {},
      listPool: () => ["chromium-1234", "chromium_headless_shell-1234", "ffmpeg-1011"],
    });
    expect(search.candidates.map((c) => c.path)).toContain(
      pool(RACINE, "chromium-1234", "chrome-win64", "chrome.exe")
    );
    // Et l'entrée d'à côté reste atteignable : le shell sans interface suffit à
    // relever des styles calculés.
    expect(search.candidates.map((c) => c.path)).toContain(
      pool(RACINE, "chromium_headless_shell-1234", "chrome-headless-shell-win64", "chrome-headless-shell.exe")
    );
    // `ffmpeg-1011` n'est pas un navigateur : il ne doit rien engendrer.
    expect(search.candidates.some((c) => c.path.includes("ffmpeg"))).toBe(false);
  });

  it("macOS : propose l'exécutable enfoui dans le paquet applicatif", () => {
    const racine = pool("/Users/x/Library/Caches/ms-playwright");
    const search = chromiumCandidates({
      platform: "darwin",
      expected: null,
      env: { HOME: pool("/Users/x") },
      listPool: (p) => (p === racine ? ["chromium-1234"] : []),
    });
    expect(search.candidates.map((c) => c.path)).toContain(
      pool(racine, "chromium-1234", "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium")
    );
  });

  it("Linux : la disposition d'origine reste servie", () => {
    const racine = pool("/home/x/.cache/ms-playwright");
    const search = chromiumCandidates({
      platform: "linux",
      expected: null,
      env: { HOME: pool("/home/x") },
      listPool: (p) => (p === racine ? ["chromium-1194"] : []),
    });
    expect(search.candidates.map((c) => c.path)).toContain(
      pool(racine, "chromium-1194", "chrome-linux", "chrome")
    );
  });

  it("le chemin imposé à la main passe avant tout le reste", () => {
    /*
      `playwright.config.ts` honore déjà `PLAYWRIGHT_CHROMIUM_EXECUTABLE` ; ce
      harnais l'ignorait, si bien qu'une même machine pouvait faire tourner les
      recettes E2E et refuser cette mesure.
    */
    const impose = pool("D:", "chrome", "chrome.exe");
    const search = chromiumCandidates({
      platform: "win32",
      expected: pool(RACINE, "chromium-1228", "chrome-win64", "chrome.exe"),
      env: { PLAYWRIGHT_CHROMIUM_EXECUTABLE: impose },
      listPool: () => [],
    });
    expect(search.candidates[0]).toEqual({
      path: impose,
      origin: "PLAYWRIGHT_CHROMIUM_EXECUTABLE",
    });
  });

  it("classe les builds par révision décroissante, et non par ordre alphabétique", () => {
    // `chromium-999` passerait après `chromium-1228` sur un tri de chaînes.
    const search = chromiumCandidates({
      platform: "linux",
      expected: null,
      env: { PLAYWRIGHT_BROWSERS_PATH: pool("/pool") },
      listPool: () => ["chromium-999", "chromium-1228", "chromium-1010"],
    });
    const revisions = search.candidates
      .map((c) => /chromium-(\d+)/.exec(c.path)?.[1])
      .filter((r): r is string => Boolean(r))
      .filter((r, i, all) => all.indexOf(r) === i);
    expect(revisions).toEqual(["1228", "1010", "999"]);
  });

  it("ne compte qu'une fois un dossier écrit de deux façons", () => {
    /*
      Les trois sources donnent souvent le même dossier sous deux écritures :
      séparateurs avant par la variable d'environnement, arrière par le chemin
      que Playwright annonce. Scanné deux fois, il apparaissait deux fois dans
      le message d'échec — le lecteur y voyait deux emplacements distincts.
    */
    const search = chromiumCandidates({
      platform: "win32",
      expected: pool("C:", "pool", "chromium-1228", "chrome-win64", "chrome.exe"),
      env: { PLAYWRIGHT_BROWSERS_PATH: "C:/pool" },
      listPool: () => [],
    });
    expect(search.pools).toEqual([pool("C:", "pool")]);
  });

  it("essaie le navigateur complet avant le shell sans interface", () => {
    // Les deux savent calculer un style ; `chromium-` est ce que ce harnais a
    // toujours lancé, et rien ne justifie de changer ce qui est mesuré.
    const search = chromiumCandidates({
      platform: "linux",
      expected: null,
      env: { PLAYWRIGHT_BROWSERS_PATH: pool("/pool") },
      listPool: () => ["chromium_headless_shell-1228", "chromium-1228"],
    });
    const premier = search.candidates[0]!.path;
    expect(premier).toContain(pool("chromium-1228", "chrome-linux", "chrome"));
  });

  it("n'invente aucun chemin quand rien n'est connu", () => {
    const search = chromiumCandidates({
      platform: "linux",
      expected: null,
      env: {},
      listPool: () => [],
    });
    expect(search.candidates).toEqual([]);
    expect(search.pools).toEqual([]);
  });
});

describe("explainChromiumSearch", () => {
  /*
    Le message est le livrable de ce chantier : c'est lui qui remplace un saut
    muet. Il doit nommer la plateforme, les dossiers consultés, et chaque chemin
    essayé avec sa provenance.
  */
  it("nomme ce qui a été cherché et où", () => {
    const search = chromiumCandidates({
      platform: "win32",
      expected: pool("C:", "ms-playwright", "chromium-1228", "chrome-win64", "chrome.exe"),
      env: {},
      listPool: () => ["chromium-1234"],
    });
    const message = explainChromiumSearch(search);
    expect(message).toContain("win32");
    expect(message).toContain(pool("C:", "ms-playwright"));
    expect(message).toContain(pool("chromium-1234", "chrome-win64", "chrome.exe"));
    expect(message).toContain("chromium.executablePath()");
    expect(message).toContain("PLAYWRIGHT_CHROMIUM_EXECUTABLE");
  });

  it("dit l'absence de dossier plutôt que de laisser une ligne vide", () => {
    const message = explainChromiumSearch({ platform: "linux", pools: [], candidates: [] });
    expect(message).toContain("Aucun dossier de navigateurs connu");
    expect(message).toContain("Aucun chemin candidat");
  });
});
