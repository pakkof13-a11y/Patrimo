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

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser } from "@playwright/test";

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
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
] as const;

/** La « peau » : ce qui ne doit jamais bouger, dans aucun des quatre états. */
const SKIN = [
  "borderTopWidth",
  "borderTopStyle",
  "borderTopColor",
  "borderTopLeftRadius",
  "backgroundColor",
  "color",
  "outlineStyle",
  "outlineWidth",
  "boxShadow",
  "opacity",
  "cursor",
] as const;

export type Measurement = Record<string, string>;
export type Snapshot = {
  /** Géométrie et typographie, une entrée par combinaison de classes. */
  combinations: Array<{ classes: string; count: number; computed: Measurement }>;
  /** Peau du champ témoin, par palette et par état (`light.hover`…). */
  skin: Record<string, Measurement>;
};

/* ── 4. Le navigateur ────────────────────────────────────────────────── */

/**
 * Chromium, ou rien.
 *
 * L'exécutable pointé par Playwright manque dans certains environnements
 * (conteneur dont la version diffère de celle épinglée). On tente alors les
 * versions présentes plutôt que d'échouer : un harnais qu'on ne peut pas
 * lancer localement finit par ne plus être lancé du tout. `null` fait passer
 * le test en « ignoré », jamais en « vert ».
 */
export function resolveChromium(): string | null {
  const candidates: string[] = [];
  try {
    candidates.push(chromium.executablePath());
  } catch {
    /* Playwright ne sait pas où il l'a mis — les chemins ci-dessous restent. */
  }
  const pool = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (pool) {
    let entries: string[] = [];
    try {
      entries = readdirSync(pool);
    } catch {
      entries = [];
    }
    for (const dir of entries.sort().reverse()) {
      if (dir.startsWith("chromium-")) {
        candidates.push(path.join(pool, dir, "chrome-linux/chrome"));
      } else if (dir.startsWith("chromium_headless_shell-")) {
        candidates.push(
          path.join(pool, dir, "chrome-headless-shell-linux64/chrome-headless-shell")
        );
      }
    }
  }
  for (const c of candidates) {
    try {
      statSync(c);
      return c;
    } catch {
      /* candidat suivant */
    }
  }
  return null;
}

/* ── 5. La mesure ────────────────────────────────────────────────────── */

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

function buildPage(css: string, combinations: Combination[], theme: Theme): string {
  const fields = combinations
    .map(
      (c, i) =>
        `<div class="host"><input id="c${i}" class="${c.classes.replace(/"/g, "&quot;")}"></div>`
    )
    .join("");
  return `<!doctype html><html class="${theme === "dark" ? "dark" : ""}"><head><meta charset="utf-8"><style>
    html,body{margin:0;padding:0}
    .host{width:${HOST_WIDTH}px}
    ${css}
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
  </body></html>`;
}

export async function measure(): Promise<Snapshot> {
  const executablePath = resolveChromium();
  if (!executablePath) {
    throw new Error("Aucun Chromium utilisable — voir resolveChromium().");
  }
  const combinations = extractCombinations();
  const css = await compileCss();

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ executablePath });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

    const snapshot: Snapshot = {
      combinations: combinations.map((c) => ({ ...c, computed: {} })),
      skin: {} as Snapshot["skin"],
    };

    for (const theme of THEMES) {
      await page.setContent(buildPage(css, combinations, theme), { waitUntil: "load" });

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
        { props: [...MEASURED], n: combinations.length }
      );
      computed.forEach((row, i) => {
        for (const [k, v] of Object.entries(row)) {
          snapshot.combinations[i].computed[`${theme}.${k}`] = v;
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
    }

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
  return out;
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

export const BASELINE_PATH = path.join(import.meta.dirname, "baseline.json");

export function readBaseline(): Snapshot {
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Snapshot;
}
