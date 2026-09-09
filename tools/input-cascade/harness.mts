/**
 * Harnais de non-régression de la cascade `.input`.
 *
 * ## Pourquoi il existe
 *
 * `app/globals.css` est déclaré hors couche CSS : ses classes l'emportent donc
 * sur les utilitaires Tailwind, qui sont en couche. `.input` déclare `width`,
 * `padding` et `font-size` ; un `text-xs` posé sur le même élément n'a jamais
 * eu d'effet. Corriger cela — en rendant `.input` à `@layer components` — rend
 * la main aux utilitaires, donc change le rendu de champs que personne n'a
 * choisi de changer.
 *
 * Ce harnais mesure ce rendu **avant** la bascule, pour que l'après soit une
 * liste de différences relue une par une plutôt qu'une surprise.
 *
 * ## Comment il mesure
 *
 * Le CSS du dépôt est compilé par la chaîne PostCSS du projet — la même que
 * Next emploie — puis appliqué à une page statique portant les combinaisons de
 * classes réellement écrites dans les composants. Chromium calcule les styles ;
 * on relève ce qu'il calcule.
 *
 * Pas de base de données, pas de session, pas d'écran métier : la question
 * posée est celle de la cascade, et rien d'autre ne doit pouvoir y répondre à
 * sa place. Un écran réel donnerait la même réponse, plus lentement, et
 * échouerait pour dix raisons étrangères au sujet.
 *
 * Les combinaisons ne sont pas une liste figée : elles sont relues dans les
 * sources à chaque exécution. Un champ ajouté demain entre de lui-même dans la
 * référence — et son absence de la référence enregistrée le signale.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type Page } from "@playwright/test";

const ROOT = path.resolve(import.meta.dirname, "../..");

/* ── 1. Les combinaisons réellement écrites dans le produit ──────────── */

const SOURCE_DIRS = ["components", "app"];

/** Attrape `className="… input …"` — la seule forme employée dans le dépôt. */
const CLASS_ATTR = /className="([^"]*)"/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

export type Combination = {
  /** La valeur exacte de `class`, telle qu'elle atteint le navigateur. */
  classes: string;
  /** Nombre d'occurrences dans le dépôt — donne le poids d'une différence. */
  count: number;
};

export function extractCombinations(): Combination[] {
  const counts = new Map<string, number>();
  for (const dir of SOURCE_DIRS) {
    for (const file of walk(path.join(ROOT, dir))) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(CLASS_ATTR)) {
        const classes = m[1];
        const tokens = classes.split(/\s+/);
        if (!tokens.includes("input")) continue;
        counts.set(classes, (counts.get(classes) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([classes, count]) => ({ classes, count }))
    // Tri stable et indépendant de l'ordre du système de fichiers : sans lui,
    // la référence enregistrée bougerait sans qu'aucun style ait changé.
    .sort((a, b) => a.classes.localeCompare(b.classes));
}

/* ── 2. Le CSS du produit, compilé par la chaîne du produit ──────────── */

export async function compileCss(): Promise<string> {
  const entry = path.join(ROOT, "app/globals.css");
  const result = await postcss([tailwind()]).process(readFileSync(entry, "utf8"), {
    from: entry,
  });
  return result.css;
}

/* ── 3. Ce qu'on relève ──────────────────────────────────────────────── */

/**
 * Les propriétés que `.input` déclare, plus celles que ses conflits déplacent.
 *
 * Volontairement court : une propriété de plus, ce sont soixante valeurs de
 * plus à relire dans un diff, et l'essentiel s'y noierait.
 */
const MEASURED = [
  "fontSize",
  "lineHeight",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
] as const;

/**
 * La largeur, relevée à part — elle dépend de la plateforme.
 *
 * Tout le reste de ce relevé est commun : mêmes tailles de police, mêmes
 * interlignes, mêmes remplissages, même peau, sur Windows comme sur Linux.
 * Seule la largeur d'un champ qui n'en déclare pas diverge, parce que Chrome
 * la calcule sur la largeur moyenne de caractère et que les deux systèmes ne
 * l'arrondissent pas pareil. Voir `tools/input-cascade/fonts/README.md`.
 */
const WIDTH = "width";

/**
 * La « peau » : ce qui ne doit jamais bouger, dans aucun des quatre états.
 *
 * `outlineWidth` en a été retiré. Tant qu'`outlineStyle` vaut `none` — ce que
 * `.input` déclare — la largeur ne décrit rien, et les moteurs ne s'accordent
 * pas sur ce qu'ils en calculent : mesuré sur un `<input>` sans une ligne de
 * CSS, Chromium 149, Chrome 152 et Edge 152 rendent tous `3px`, la valeur du
 * mot-clé `medium`, là où la référence enregistrée porte `0px`. Huit entrées
 * du relevé ne parlaient donc pas de la cascade mais du moteur qui la lisait.
 *
 * `outlineStyle` reste, et suffit : c'est lui que la cascade décide, et une
 * bordure de mise au point qui apparaîtrait s'y verrait aussitôt.
 */
const SKIN = [
  "borderTopWidth",
  "borderTopStyle",
  "borderTopColor",
  "borderTopLeftRadius",
  "backgroundColor",
  "color",
  "outlineStyle",
  "boxShadow",
  "opacity",
  "cursor",
] as const;

export type Measurement = Record<string, string>;
/**
 * Ce que le harnais a chargé comme police, et ce que les champs en ont fait.
 */
export type FontReport = {
  /** Famille déclarée par la fixture — celle que tout champ mesuré doit résoudre. */
  declared: string;
  /** Famille annoncée aux champs qui demandent du monospace, volontairement absente. */
  monoPlaceholder: string;
  file: string;
  sha256: string;
  /** Les deux graisses mesurées sont-elles réellement chargées ? */
  loaded: Record<string, boolean>;
  /** Police physique retenue par le moteur, sur un témoin porteur de texte. */
  platformFonts: string[];
  /** Combien de largeurs dépendent réellement de la police. */
  fontDependent: number;
  /**
   * Champs dont la largeur dépend de la police **et** qui n'ont pas résolu la
   * fixture. Vide en régime normal ; non vide, c'est une mesure qui décrit
   * autre chose que ce qu'elle prétend.
   */
  unresolved: Array<{ classes: string; resolved: string }>;
};

/**
 * Sous quelle clé ranger les largeurs d'une plateforme.
 *
 * Le système seul — `win32`, `linux`, `darwin` — et non le couple
 * système/architecture. La cause établie est le moteur de texte du système,
 * pas le processeur : DirectWrite d'un côté, FreeType de l'autre. Découper
 * plus fin multiplierait les entrées à tenir sans preuve qu'elles diffèrent.
 *
 * Si une architecture divergeait un jour, elle échouerait contre l'entrée de
 * sa plateforme, avec le détail de l'écart — exactement comme Linux a
 * divergé de Windows. C'est ainsi qu'on l'apprendrait.
 */
export function platformKey(platform: string): string {
  return platform;
}

/** Les conditions de la prise. Consignées, jamais comparées. */
export type EnvironmentReport = {
  engine: string;
  platform: string;
  arch: string;
  recordedAt: string;
  /** Ce qu'il ne faut pas redécouvrir. Voir `FONT_NOTE`. */
  note: string;
};

export type Snapshot = {
  /**
   * Typographie et remplissages, une entrée par combinaison de classes.
   *
   * Commun à toutes les plateformes, et vérifié comme tel : ces valeurs sont
   * comparées partout, sans distinction de système.
   */
  combinations: Array<{ classes: string; count: number; computed: Measurement }>;
  /** Peau du champ témoin, par palette et par état (`light.hover`…). Commune. */
  skin: Record<string, Measurement>;
  /**
   * Largeurs, **par plateforme** : `widths.win32[classes]['light.width']`.
   *
   * Une mesure ne remplit que l'entrée de sa propre plateforme ;
   * `capture.mts` fusionne au lieu d'écraser, sans quoi enregistrer depuis
   * Windows effacerait le relevé Linux.
   */
  widths?: Record<string, Record<string, Measurement>>;
  /** Conditions de prise, par plateforme, dans la même clé que `widths`. */
  environments?: Record<string, EnvironmentReport>;
  /** Facultatif : une référence enregistrée avant D34 n'en porte pas. */
  fonts?: FontReport;
};

/* ── 4. Le navigateur ────────────────────────────────────────────────── */

/**
 * Emplacement de l'exécutable **à l'intérieur** d'un dossier de build.
 *
 * Playwright range chaque build sous `<pool>/chromium-<révision>/`, et la
 * suite du chemin dépend du système. Cette table n'est qu'un dernier recours :
 * quand Playwright répond, on lui emprunte sa propre disposition
 * (`splitExpectedPath`), ce qui vaut mieux que de la deviner.
 *
 * Relevé sur la machine où ce correctif a été écrit (Windows) :
 *   chromium-1228/chrome-win64/chrome.exe
 *   chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe
 *
 * Les entrées macOS et Linux viennent de la disposition publiée par
 * Playwright et n'ont **pas** pu être vérifiées ici. Elles ne sont atteintes
 * que si `chromium.executablePath()` échoue — installation incomplète — ce qui
 * est justement le cas où deviner reste préférable à abandonner.
 */
const LAYOUTS: Record<string, readonly string[]> = {
  win32: [
    "chrome-win64/chrome.exe",
    "chrome-win/chrome.exe",
    "chrome-headless-shell-win64/chrome-headless-shell.exe",
  ],
  darwin: [
    "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
    "chrome-headless-shell-mac-arm64/chrome-headless-shell",
    "chrome-headless-shell-mac-x64/chrome-headless-shell",
  ],
  linux: [
    "chrome-linux/chrome",
    "chrome-headless-shell-linux64/chrome-headless-shell",
  ],
};

/** `chromium-1228`, `chromium_headless_shell-1228` — le dossier d'un build. */
const BUILD_DIR = /^chromium(?:_headless_shell)?-(\d+)$/;

/**
 * Les seules variables que la résolution lit.
 *
 * Déclarées plutôt que `NodeJS.ProcessEnv` : la signature dit exactement ce
 * qui est consulté, et un appelant peut lui passer un environnement de test
 * sans reconstituer celui du processus.
 */
export type BrowserEnv = {
  PLAYWRIGHT_CHROMIUM_EXECUTABLE?: string;
  PLAYWRIGHT_BROWSERS_PATH?: string;
  LOCALAPPDATA?: string;
  HOME?: string;
  USERPROFILE?: string;
  /*
    L'indice ouvert n'est pas de la complaisance : sans lui, un type dont
    toutes les propriétés sont facultatives refuse `process.env`, qui ne les
    déclare pas nommément. Les noms au-dessus restent la documentation de ce
    qui est réellement lu.
  */
  [key: string]: string | undefined;
};

/**
 * Le dossier où Playwright range ses navigateurs faute de
 * `PLAYWRIGHT_BROWSERS_PATH`.
 *
 * Ce cas n'est pas marginal, c'est le cas courant : la variable n'était pas
 * posée sur la machine où ces tests se sont ignorés trois semaines durant, si
 * bien que l'ancienne boucle de repli ne s'exécutait même pas.
 */
export function defaultBrowsersPool(
  platform: string,
  env: BrowserEnv
): string | null {
  if (platform === "win32") {
    return env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, "ms-playwright") : null;
  }
  const home = env.HOME ?? env.USERPROFILE;
  if (!home) return null;
  if (platform === "darwin") return path.join(home, "Library/Caches/ms-playwright");
  return path.join(home, ".cache/ms-playwright");
}

/**
 * Coupe le chemin attendu en (pool, disposition).
 *
 * `…/ms-playwright/chromium-1228/chrome-win64/chrome.exe` donne le pool d'un
 * côté et `chrome-win64/chrome.exe` de l'autre. C'est Playwright lui-même qui
 * nous apprend ainsi la disposition de la plateforme courante — aucune table à
 * tenir à jour, et le résultat est juste par construction là où une table
 * vieillit.
 */
export function splitExpectedPath(
  expected: string
): { pool: string; layout: string } | null {
  const parts = expected.split(/[\\/]/);
  const i = parts.findIndex((part) => BUILD_DIR.test(part));
  if (i <= 0 || i >= parts.length - 1) return null;
  return {
    pool: parts.slice(0, i).join(path.sep),
    layout: parts.slice(i + 1).join(path.sep),
  };
}

export type ChromiumCandidate = {
  path: string;
  /** D'où vient ce chemin — c'est ce qu'un message d'échec doit nommer. */
  origin: string;
};

export type ChromiumSearch = {
  platform: string;
  pools: string[];
  candidates: ChromiumCandidate[];
};

/**
 * Les chemins à essayer, dans l'ordre — sans toucher au disque.
 *
 * Séparé de la recherche elle-même pour être vérifiable : la disposition
 * Windows ou macOS se teste depuis n'importe quelle machine, ce qui est
 * exactement ce qui manquait quand la fonction ne connaissait que Linux.
 */
export function chromiumCandidates(input: {
  platform: string;
  /** `chromium.executablePath()`, ou `null` s'il a jeté. */
  expected: string | null;
  env: BrowserEnv;
  listPool: (pool: string) => string[];
}): ChromiumSearch {
  const { platform, expected, env, listPool } = input;
  const candidates: ChromiumCandidate[] = [];
  const seen = new Set<string>();
  const add = (candidate: string, origin: string) => {
    if (seen.has(candidate)) return;
    seen.add(candidate);
    candidates.push({ path: candidate, origin });
  };

  /*
    Le chemin imposé à la main d'abord. `playwright.config.ts` honore déjà
    `PLAYWRIGHT_CHROMIUM_EXECUTABLE` ; ce harnais l'ignorait, si bien que la
    même machine pouvait faire tourner les recettes E2E et refuser celle-ci.
  */
  const forced = env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (forced) add(forced, "PLAYWRIGHT_CHROMIUM_EXECUTABLE");

  const split = expected ? splitExpectedPath(expected) : null;
  if (expected) add(expected, "chromium.executablePath()");

  // La disposition apprise de Playwright passe avant celle de la table.
  const layouts = [...(split ? [split.layout] : []), ...(LAYOUTS[platform] ?? [])];

  /*
    Les trois sources donnent souvent le même dossier sous deux écritures —
    `C:/…/pool` par la variable d'environnement, `C:\…\pool` par le chemin
    que Playwright annonce. Sans normalisation, il est scanné deux fois et le
    message d'échec le nomme deux fois : le lecteur croit à deux emplacements.
  */
  const pools: string[] = [];
  const seenPools = new Set<string>();
  for (const pool of [
    split?.pool,
    env.PLAYWRIGHT_BROWSERS_PATH,
    defaultBrowsersPool(platform, env),
  ]) {
    if (!pool) continue;
    const normalized = path.normalize(pool);
    const key = platform === "win32" ? normalized.toLowerCase() : normalized;
    if (seenPools.has(key)) continue;
    seenPools.add(key);
    pools.push(normalized);
  }

  for (const pool of pools) {
    /*
      Décroissant sur la révision, et numériquement : à défaut du build
      attendu, on prend le plus récent des présents. Un tri alphabétique
      placerait `chromium-999` après `chromium-1228`.

      À révision égale, le navigateur complet passe avant le shell sans
      interface. Les deux savent calculer un style, mais `chromium-` est ce
      que ce harnais a toujours lancé : à défaut de raison de changer, on ne
      change pas ce qui est mesuré.
    */
    const builds = listPool(pool)
      .map((dir) => ({
        dir,
        revision: Number(BUILD_DIR.exec(dir)?.[1] ?? NaN),
        complet: dir.startsWith("chromium-") ? 0 : 1,
      }))
      .filter((b) => Number.isFinite(b.revision))
      .sort(
        (a, b) =>
          b.revision - a.revision || a.complet - b.complet || a.dir.localeCompare(b.dir)
      );
    for (const build of builds) {
      for (const layout of layouts) {
        add(path.join(pool, build.dir, layout), `${build.dir} · ${pool}`);
      }
    }
  }

  return { platform, pools, candidates };
}

/**
 * Chromium, ou rien — mais jamais sans dire ce qui a été cherché.
 *
 * L'exécutable épinglé par Playwright manque dans certains environnements : la
 * version installée diffère de celle attendue. On tente alors les versions
 * présentes plutôt que d'échouer, car un harnais qu'on ne peut pas lancer
 * localement finit par ne plus être lancé du tout.
 *
 * La recherche est rendue avec le résultat : un appelant qui ne trouve rien
 * dispose de la liste exacte des chemins essayés. C'est ce qui manquait — le
 * `null` seul a laissé passer trois semaines de faux vert.
 */
export function findChromium(): { path: string | null; search: ChromiumSearch } {
  let expected: string | null = null;
  try {
    expected = chromium.executablePath();
  } catch {
    /* Playwright ne sait pas où il l'a mis — les autres pistes restent. */
  }
  const search = chromiumCandidates({
    platform: process.platform,
    expected,
    env: process.env,
    listPool: (pool) => {
      try {
        return readdirSync(pool);
      } catch {
        return [];
      }
    },
  });
  for (const candidate of search.candidates) {
    try {
      statSync(candidate.path);
      return { path: candidate.path, search };
    } catch {
      /* candidat suivant */
    }
  }
  return { path: null, search };
}

/** Le chemin seul. `null` fait passer le test en « ignoré », jamais en « vert ». */
export function resolveChromium(): string | null {
  return findChromium().path;
}

/**
 * Ce que la recherche a tenté, et où.
 *
 * Un test qui ne peut pas s'exécuter doit le dire. Le message nomme la
 * plateforme, les dossiers consultés et chaque chemin essayé avec son origine,
 * pour qu'on sache si le build manque, si le dossier est ailleurs, ou si
 * Playwright n'a rien à répondre.
 */
export function explainChromiumSearch(search: ChromiumSearch): string {
  const lines = [`Aucun Chromium utilisable (plateforme ${search.platform}).`];
  lines.push(
    search.pools.length
      ? `Dossiers de navigateurs consultés :\n${search.pools.map((p) => `  ${p}`).join("\n")}`
      : "Aucun dossier de navigateurs connu — ni PLAYWRIGHT_BROWSERS_PATH, ni emplacement par défaut."
  );
  lines.push(
    search.candidates.length
      ? `Chemins essayés, dans l'ordre :\n${search.candidates
          .map((c) => `  ${c.path}\n      ← ${c.origin}`)
          .join("\n")}`
      : "Aucun chemin candidat."
  );
  lines.push(
    "Pour l'exécuter : poser PLAYWRIGHT_CHROMIUM_EXECUTABLE sur un binaire existant, " +
      "ou installer le build attendu (npx playwright install chromium)."
  );
  return lines.join("\n");
}

/* ── 5. La mesure ────────────────────────────────────────────────────── */

/* ── 4 bis. La police du produit ─────────────────────────────────────── */

/**
 * Le fichier embarqué, et pourquoi il l'est.
 *
 * La page du harnais ne charge pas `next/font` : `--font-plex-sans` y était
 * indéfinie, `--font-sans` — qui vaut `var(--font-plex-sans), ui-sans-serif,
 * …` — devenait invalide à la valeur calculée, et le rendu retombait sur la
 * pile générique du système. La largeur d'un champ `w-auto` décrivait donc la
 * machine qui exécutait la mesure, pas la cascade du dépôt.
 *
 * Provenance et métriques : `fonts/README.md`. En deux mots — c'est le
 * fichier que Google Fonts distribue et que `next/font` réémet pour
 * l'application, et non celui qu'IBM publie, dont les métriques diffèrent.
 */
const FONT_FILE = path.join(import.meta.dirname, "fonts/ibm-plex-sans-latin.woff2");

/** Famille déclarée par la fixture — celle que tout champ mesuré doit résoudre. */
const FONT_FAMILY = "IBM Plex Sans";

/**
 * Famille annoncée aux champs qui demandent du monospace — et qui n'existe pas.
 *
 * Le harnais n'embarque que le Sans : c'est le seul dont une largeur mesurée
 * dépende aujourd'hui, les deux champs `font-mono` du dépôt étant en `w-full`,
 * donc à 600 px imposés par leur conteneur.
 *
 * Le laisser indéfini serait pourtant le piège de D33 rejoué : `--font-mono`
 * deviendrait invalide à la valeur calculée, et `font-family` étant héritée,
 * un champ monospace retomberait **silencieusement** sur le Sans. En pointant
 * une famille impossible, on le rend visible : `measure()` voit ce nom, et le
 * signale si la largeur de ce champ dépend de la police.
 */
const MONO_PLACEHOLDER = "IBM Plex Mono absente du harnais";

/**
 * Ce qu'il ne faut pas redécouvrir.
 *
 * La partie la plus périssable de ce chantier : sans cette trace, le prochain
 * qui voudra « simplifier » en prenant un fichier publié par IBM refera
 * l'enquête depuis zéro — et conclura probablement l'inverse.
 */
const FONT_NOTE =
  "Police servie par Google Fonts via next/font, et non celle publiée par IBM. " +
  "Sur un <input> vide, Google rend 149 px à 13 px là où @ibm/plex-sans@1.1.0 " +
  "et @ibm/plex-sans-variable@0.2.0 rendent 153 px. L'écart est proportionnel " +
  "à la taille (4 px à 13 px, 8 px à 26 px, 32 px à 104 px) et les chasses de " +
  "glyphes sont identiques (78,000 px pour 0123456789). Prendre un fichier " +
  "d'IBM ferait donc mesurer une largeur que l'application n'affiche jamais. " +
  "Voir tools/input-cascade/fonts/README.md.";

/**
 * La règle `@font-face`, police incluse en base64.
 *
 * Une seule face pour les deux graisses : le fichier est une police
 * **variable**, et un intervalle `font-weight` évite d'embarquer deux fois
 * les mêmes 39 Ko dans la page. L'empreinte accompagne la règle — c'est elle
 * qui, consignée dans la référence, permettra de voir qu'un fichier a changé.
 */
function fontFaceCss(): { css: string; sha256: string } {
  const bytes = readFileSync(FONT_FILE);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const css =
    `@font-face{font-family:"${FONT_FAMILY}";font-style:normal;` +
    `font-weight:100 700;font-stretch:100%;` +
    `src:url(data:font/woff2;base64,${bytes.toString("base64")}) format("woff2");` +
    `font-display:block}`;
  return { css, sha256 };
}

/**
 * La police physique réellement retenue par le moteur.
 *
 * Le protocole de débogage est le seul à pouvoir répondre : `fontFamily`
 * calculée ne rend que la liste demandée, pas ce qui a servi. Son absence ne
 * doit pas faire échouer une mesure — c'est une trace, pas une assertion.
 */
async function platformFontsOf(page: Page, selector: string): Promise<string[]> {
  try {
    const client = await page.context().newCDPSession(page);
    await client.send("DOM.enable");
    await client.send("CSS.enable");
    const { root } = (await client.send("DOM.getDocument")) as {
      root: { nodeId: number };
    };
    const { nodeId } = (await client.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector,
    })) as { nodeId: number };
    const { fonts } = (await client.send("CSS.getPlatformFontsForNode", {
      nodeId,
    })) as { fonts: Array<{ familyName: string }> };
    await client.detach();
    return fonts.map((f) => f.familyName);
  } catch {
    return [];
  }
}

/**
 * Largeur du conteneur de chaque champ.
 *
 * Fixe et généreuse : `width: 100%` doit se distinguer d'une largeur naturelle
 * ou fixe. À 600 px, `w-full` donne 600, `w-36` donne 144, `w-auto` donne la
 * largeur intrinsèque du contrôle — trois valeurs qu'on ne peut pas confondre.
 */
const HOST_WIDTH = 600;

/**
 * Les deux palettes.
 *
 * `@custom-variant dark (&:where(.dark, .dark *))` : la palette sombre tient à
 * une classe sur la racine. Rien ne la pose aujourd'hui dans le produit — la
 * mesure claire est donc celle qui décrit l'écran réel. La sombre est relevée
 * quand même : trois combinaisons portent des utilitaires `dark:`, et une
 * référence qui les ignorerait laisserait passer une bascule qui les casse.
 */
const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

function buildPage(
  css: string,
  fontCss: string,
  combinations: Combination[],
  theme: Theme
): string {
  const fields = combinations
    .map(
      (c, i) =>
        `<div class="host"><input id="c${i}" class="${c.classes.replace(/"/g, "&quot;")}"></div>`
    )
    .join("");
  return `<!doctype html><html class="${theme === "dark" ? "dark" : ""}"><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0}
    .host{width:${HOST_WIDTH}px}
    ${fontCss}
    ${css}
    /*
      La police du produit, déclarée là où next/font la déclare dans
      l'application : sur la racine, et après le CSS du dépôt pour l'emporter.
      Sans elle, --font-sans devient invalide à la valeur calculée et le rendu
      retombe sur la pile générique du système — ce qui faisait mesurer au
      harnais la police de l'hôte plutôt que la sienne.

      --font-plex-mono pointe une famille impossible : voir MONO_PLACEHOLDER
      dans ce fichier.
    */
    :root{--font-plex-sans:"${FONT_FAMILY}";--font-plex-mono:"${MONO_PLACEHOLDER}"}
    /*
      Sans cela, les états sont mesurés en cours d'interpolation : la classe
      anime border-color et box-shadow sur 0,12 s, et une lecture immédiate
      après le survol renvoie une couleur intermédiaire — donc une référence
      qui change à chaque exécution. La valeur d'arrivée est celle qui compte.
    */
    *,*::before,*::after{transition:none!important;animation:none!important}
  </style></head><body>
    ${fields}
    <div class="host"><input id="witness" class="input"></div>
    <div class="host"><input id="witness-disabled" class="input" disabled></div>
    <!--
      Un témoin porteur de texte : un champ vide ne dessine aucun glyphe, et
      le protocole ne peut donc pas dire quelle police a réellement servi.
    -->
    <span id="font-witness">0123456789 Montant net</span>
  </body></html>`;
}

/** Un champ mesuré, vu sous l'angle de la police. */
export type FieldFontRow = {
  classes: string;
  /** Première famille de la liste calculée — celle que le moteur essaie. */
  resolved: string;
  /** Sa largeur bouge-t-elle quand la police change ? */
  dependent: boolean;
};

/**
 * La seule règle qui vaille : **tout champ dont la largeur dépend de la
 * police doit avoir résolu la fixture**.
 *
 * Un champ monospace en `w-full` ne dépend de rien et ne gêne personne — le
 * harnais n'embarque que le Sans, et c'est assez. Le jour où ce même champ
 * passe en `w-auto`, sa largeur se met à dépendre d'une police absente : il
 * est alors signalé, au lieu d'hériter du Sans en silence et de faire
 * enregistrer une largeur que l'application n'affiche pas.
 *
 * Séparée du navigateur pour être vérifiable sans lui — la leçon de D33.
 */
export function unresolvedFields(
  rows: FieldFontRow[],
  declared: string
): Array<{ classes: string; resolved: string }> {
  return rows
    .filter((r) => r.dependent && r.resolved !== declared)
    .map(({ classes, resolved }) => ({ classes, resolved }));
}

/** `"IBM Plex Sans", ui-sans-serif, …` → `IBM Plex Sans`. */
export function firstFamily(list: string): string {
  return (list.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
}

/**
 * Ce que les champs ont fait de la police, et lesquels en dépendent.
 *
 * La dépendance n'est pas devinée, elle est **mesurée** : on substitue une
 * autre famille aux deux variables, on relit les largeurs, et celles qui
 * bougent sont celles dont la police décide. Un `w-full` ne bouge pas, un
 * `w-auto` bouge. Aucune liste à tenir à jour : le jour où un champ change de
 * classe, la mesure change de réponse toute seule.
 *
 * De là, la seule règle qui vaille : **tout champ dont la largeur dépend de la
 * police doit avoir résolu la fixture**. Un champ monospace en `w-full` ne
 * dépend de rien et ne gêne personne ; le jour où il passe en `w-auto`, il
 * dépend d'une police que le harnais n'embarque pas, et il est signalé.
 */
async function collectFontReport(
  page: Page,
  combinations: Combination[],
  loaded: Record<string, boolean>,
  sha256: string
): Promise<FontReport> {
  const nominal = await page.evaluate(
    ({ n }) => {
      const rows: Array<{ family: string; width: string }> = [];
      for (let i = 0; i < n; i++) {
        const cs = getComputedStyle(document.getElementById(`c${i}`)!);
        rows.push({ family: cs.fontFamily, width: cs.width });
      }
      return rows;
    },
    { n: combinations.length }
  );

  /*
    La police physique se lit **avant** la substitution qui suit.

    Elle était lue après, et la valeur rendue dépendait alors du moment où le
    navigateur relayait : le témoin pouvait encore porter la police de
    substitution. Constaté — `platformFonts` a rendu `Times New Roman` là où
    la même mesure rendait `IBM Plex Sans` la veille, sans qu'une ligne de ce
    fichier ait changé entre les deux.

    Lire dans l'état nominal supprime la question au lieu de la temporiser.
  */
  const platformFonts = await platformFontsOf(page, "#font-witness");

  const substitue = await page.evaluate(
    ({ n }) => {
      const root = document.documentElement;
      const widths: string[] = [];
      root.style.setProperty("--font-plex-sans", "serif");
      root.style.setProperty("--font-plex-mono", "serif");
      for (let i = 0; i < n; i++) {
        widths.push(getComputedStyle(document.getElementById(`c${i}`)!).width);
      }
      root.style.removeProperty("--font-plex-sans");
      root.style.removeProperty("--font-plex-mono");
      return widths;
    },
    { n: combinations.length }
  );

  const lignes: FieldFontRow[] = combinations.map((c, i) => ({
    classes: c.classes,
    resolved: firstFamily(nominal[i].family),
    dependent: nominal[i].width !== substitue[i],
  }));

  return {
    declared: FONT_FAMILY,
    monoPlaceholder: MONO_PLACEHOLDER,
    file: path.basename(FONT_FILE),
    sha256,
    loaded,
    platformFonts,
    fontDependent: lignes.filter((l) => l.dependent).length,
    unresolved: unresolvedFields(lignes, FONT_FAMILY),
  };
}

export async function measure(): Promise<Snapshot> {
  const found = findChromium();
  if (!found.path) {
    // Le détail plutôt qu'un renvoi vers la fonction : c'est ici qu'on a
    // besoin de savoir ce qui a été cherché, pas dans le code source.
    throw new Error(explainChromiumSearch(found.search));
  }
  const executablePath = found.path;
  const combinations = extractCombinations();
  const css = await compileCss();
  const font = fontFaceCss();

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ executablePath });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    // Une mesure ne parle que de la plateforme qui l'exécute.
    const key = platformKey(process.platform);
    const snapshot: Snapshot = {
      combinations: combinations.map((c) => ({ ...c, computed: {} })),
      skin: {} as Snapshot["skin"],
      widths: { [key]: {} },
      environments: {},
    };

    for (const theme of THEMES) {
      await page.setContent(buildPage(css, font.css, combinations, theme), {
        waitUntil: "load",
      });

      /*
        La police est chargée avant toute lecture.

        `document.fonts.ready` seul ne suffit pas : une face n'est demandée
        qu'à son premier usage, et une largeur relevée avant l'arrivée du
        fichier serait celle du repli — précisément l'erreur que ce chantier
        corrige.
      */
      const loaded = await page.evaluate(
        async ({ family }) => {
          await document.fonts.load(`400 13px "${family}"`);
          await document.fonts.load(`600 13px "${family}"`);
          await document.fonts.ready;
          return {
            "400": document.fonts.check(`400 13px "${family}"`),
            "600": document.fonts.check(`600 13px "${family}"`),
          };
        },
        { family: FONT_FAMILY }
      );

      /*
        Le corps passé au navigateur reste sans fonction nommée intermédiaire :
        esbuild, qui transpile ce fichier, réécrit les fonctions déclarées en y
        injectant un appel à son propre `__name`, absent de la page.
      */
      const computed = await page.evaluate(
        ({ props, n }) => {
          const rows: Record<string, string>[] = [];
          for (let i = 0; i < n; i++) {
            const cs = getComputedStyle(document.getElementById(`c${i}`)!);
            const out: Record<string, string> = {};
            for (const k of props) out[k] = cs[k as never] as string;
            rows.push(out);
          }
          return rows;
        },
        { props: [...MEASURED, WIDTH], n: combinations.length }
      );
      /*
        Un seul passage dans le navigateur, deux destinations : le commun va
        dans `computed`, comparé partout ; la largeur va dans la carte de sa
        plateforme, comparée seulement à sa semblable.
      */
      computed.forEach((row, i) => {
        const classes = snapshot.combinations[i].classes;
        for (const [k, v] of Object.entries(row)) {
          if (k === WIDTH) {
            const carte = (snapshot.widths![key][classes] ??= {});
            carte[`${theme}.${k}`] = v;
          } else {
            snapshot.combinations[i].computed[`${theme}.${k}`] = v;
          }
        }
      });

      const readSkin = (id: string) =>
        page.$eval(
          id,
          (el, keys) => {
            const cs = getComputedStyle(el);
            const out: Record<string, string> = {};
            for (const k of keys) out[k] = cs[k as never] as string;
            return out;
          },
          [...SKIN]
        );

      snapshot.skin[`${theme}.base`] = await readSkin("#witness");
      await page.hover("#witness");
      snapshot.skin[`${theme}.hover`] = await readSkin("#witness");
      // Le survol doit quitter le champ avant la mise au point : `:hover` et
      // `:focus` se recouvriraient, et `.input:hover` s'exclut justement de
      // `:focus`. Mesurer les deux ensemble ne dirait ni l'un ni l'autre.
      await page.mouse.move(0, 0);
      await page.focus("#witness");
      snapshot.skin[`${theme}.focus`] = await readSkin("#witness");
      await page.mouse.move(0, 0);
      snapshot.skin[`${theme}.disabled`] = await readSkin("#witness-disabled");

      /*
        Le relevé de police une seule fois : il ne dépend pas de la palette, et
        la substitution qu'il opère vaut mieux hors de la boucle de mesure.
      */
      if (theme === "light") {
        snapshot.fonts = await collectFontReport(
          page,
          combinations,
          loaded,
          font.sha256
        );
      }
    }

    snapshot.environments = {
      [key]: {
        engine: browser.version(),
        platform: process.platform,
        arch: process.arch,
        recordedAt: new Date().toISOString(),
        note: FONT_NOTE,
      },
    };

    return snapshot;
  } finally {
    await browser?.close();
  }
}

/* ── 6. La comparaison ───────────────────────────────────────────────── */

export type Difference = {
  scope: string;
  property: string;
  before: string;
  after: string;
  /** Occurrences concernées dans le dépôt. */
  count: number;
};

export function diff(before: Snapshot, after: Snapshot): Difference[] {
  const out: Difference[] = [];

  for (const state of new Set([...Object.keys(before.skin), ...Object.keys(after.skin)])) {
    const b = before.skin[state] ?? {};
    const a = after.skin[state] ?? {};
    for (const prop of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (b[prop] !== a[prop]) {
        out.push({
          scope: `peau · ${state}`,
          property: prop,
          before: b[prop] ?? "—",
          after: a[prop] ?? "—",
          count: 1,
        });
      }
    }
  }

  const byClass = new Map(after.combinations.map((c) => [c.classes, c]));
  for (const b of before.combinations) {
    const a = byClass.get(b.classes);
    if (!a) {
      out.push({
        scope: b.classes,
        property: "(combinaison disparue du dépôt)",
        before: "présente",
        after: "absente",
        count: b.count,
      });
      continue;
    }
    byClass.delete(b.classes);
    for (const prop of new Set([...Object.keys(b.computed), ...Object.keys(a.computed)])) {
      if (b.computed[prop] !== a.computed[prop]) {
        out.push({
          scope: b.classes,
          property: prop,
          before: b.computed[prop],
          after: a.computed[prop],
          count: a.count,
        });
      }
    }
  }
  for (const a of byClass.values()) {
    out.push({
      scope: a.classes,
      property: "(combinaison nouvelle)",
      before: "absente",
      after: "présente",
      count: a.count,
    });
  }

  /*
    Les largeurs, contre celles de la même plateforme.

    `after` n'en porte qu'une : celle du système qui vient de mesurer. Les
    comparer à celles d'un autre système n'aurait pas de sens — c'est
    exactement ce que faisait la référence unique, et ce qui a fait échouer la
    CI Linux sur cinq combinaisons alors que le moteur, la police et le CSS
    étaient les mêmes.

    Plateforme absente de la référence : on ne compare rien ici, et
    `missingPlatformWidths` le dit bien mieux qu'une avalanche de différences.
  */
  const key = Object.keys(after.widths ?? {})[0];
  const attendues = key ? before.widths?.[key] : undefined;
  const obtenues = key ? after.widths?.[key] : undefined;
  if (attendues && obtenues) {
    const countOf = new Map(after.combinations.map((c) => [c.classes, c.count]));
    for (const classes of new Set([
      ...Object.keys(attendues),
      ...Object.keys(obtenues),
    ])) {
      const b = attendues[classes] ?? {};
      const a = obtenues[classes] ?? {};
      for (const prop of new Set([...Object.keys(b), ...Object.keys(a)])) {
        if (b[prop] !== a[prop]) {
          out.push({
            scope: classes,
            property: prop,
            before: b[prop] ?? "—",
            after: a[prop] ?? "—",
            count: countOf.get(classes) ?? 1,
          });
        }
      }
    }
  }

  return out;
}

/**
 * La référence connaît-elle les largeurs de la plateforme qui mesure ?
 *
 * `null` si oui. Sinon un message, et le test échoue dessus : il ne saute
 * pas, et il ne compare pas aux largeurs d'un autre système. Une plateforme
 * non enregistrée est une plateforme dont personne n'a relu les valeurs, et
 * l'inventer serait la faute que tout cet arc a passé son temps à fermer.
 *
 * Le message porte les largeurs mesurées, prêtes à être relues puis
 * enregistrées. C'est ce qui rend une plateforme adoptable sans y lancer
 * `input:baseline` — la CI, par exemple, où on ne veut surtout pas qu'un
 * enregistrement se produise.
 */
export function missingPlatformWidths(
  before: Snapshot,
  after: Snapshot
): string | null {
  const key = Object.keys(after.widths ?? {})[0];
  if (!key) {
    return "La mesure n'a produit aucune largeur — le harnais lui-même est en cause.";
  }
  if (before.widths?.[key]) return null;

  const connues = Object.keys(before.widths ?? {});
  const env = after.environments?.[key];
  const lines = [
    `La référence ne connaît pas les largeurs de la plateforme « ${key} ».`,
    "",
    connues.length
      ? `Plateformes enregistrées : ${connues.join(", ")}.`
      : "Aucune plateforme n'est enregistrée dans la référence.",
  ];
  if (env) {
    lines.push(`Mesuré ici sous ${env.platform}/${env.arch}, moteur ${env.engine}.`);
  }
  lines.push(
    "",
    "Le test échoue plutôt que de sauter, et plutôt que de comparer aux",
    "largeurs d'un autre système : les deux reviendraient à valider ce que",
    "personne n'a relu.",
    "",
    `Largeurs mesurées, à relire avant de les enregistrer sous widths.${key}`,
    "dans tools/input-cascade/baseline.json :",
    "",
    JSON.stringify(after.widths![key], null, 2)
  );
  return lines.join("\n");
}

export function formatDiff(differences: Difference[]): string {
  if (differences.length === 0) return "Aucune différence.";
  const byScope = new Map<string, Difference[]>();
  for (const d of differences) {
    const list = byScope.get(d.scope) ?? [];
    list.push(d);
    byScope.set(d.scope, list);
  }
  const lines: string[] = [];
  let occurrences = 0;
  for (const [scope, list] of byScope) {
    occurrences += list[0].count;
    lines.push(`\n[${list[0].count}×] ${scope}`);
    for (const d of list) lines.push(`      ${d.property}: ${d.before} → ${d.after}`);
  }
  lines.push(
    `\n${byScope.size} entrée(s) modifiée(s), ${occurrences} occurrence(s) dans le dépôt.`
  );
  return lines.join("\n");
}

/**
 * Sous quelles conditions la référence a été prise, et sous lesquelles on
 * mesure.
 *
 * Ajouté au message d'échec. Nomme **toujours** la plateforme dont les
 * largeurs servent de référence : c'est elle que le lecteur doit avoir en
 * tête avant de lire le moindre écart de largeur. Et signale un écart de
 * moteur, qui explique souvent vingt lignes de différences et se lit alors
 * en une.
 */
export function formatEnvironment(before: Snapshot, after: Snapshot): string {
  const key = Object.keys(after.widths ?? {})[0];
  if (!key) return "";
  const b = before.environments?.[key];
  const a = after.environments?.[key];

  const lignes = [`  largeurs comparées à la plateforme « ${key} »`];
  if (!b) {
    lignes.push(
      "  référence sans conditions de prise pour cette plateforme"
    );
  } else {
    lignes.push(`  référence enregistrée le ${b.recordedAt}, moteur ${b.engine}`);
    if (a && b.engine !== a.engine) {
      lignes.push(`  moteur ici ${a.engine} — différent de la référence`);
    }
    if (a && (b.platform !== a.platform || b.arch !== a.arch)) {
      lignes.push(
        `  système référence ${b.platform}/${b.arch} · ici ${a.platform}/${a.arch}`
      );
    }
  }
  return ["", "", "Conditions de prise :", ...lignes].join("\n");
}

export const BASELINE_PATH = path.join(import.meta.dirname, "baseline.json");

export function readBaseline(): Snapshot {
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Snapshot;
}
