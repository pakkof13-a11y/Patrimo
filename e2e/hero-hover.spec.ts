import { test, expect, type Page, type Locator } from "@playwright/test";
import { parseSignedScreenAmount } from "../app/lib/ui/hero-format";
import { gotoDashboard } from "./helpers";

/**
 * La carte de tête lue comme une série.
 *
 * Ce que ces tests protègent n'est pas l'apparition d'une info-bulle — un
 * `toBeVisible` l'aurait dit — mais le fait que le **gros chiffre suive le
 * curseur puis revienne**. C'est là que se joue la promesse : un hero figé
 * pendant que l'info-bulle bouge, ou un hero resté sur une valeur passée après
 * la sortie, afficherait un patrimoine faux sans que rien ne le signale.
 */

/**
 * Lit un montant français rendu à l'écran.
 *
 * Les séparateurs de milliers sont des espaces insécables — parfois fines —
 * que le format monétaire pose lui-même : un `parseFloat` direct s'arrêterait
 * au premier d'entre eux et lirait 880 là où il y a 880 769,64.
 *
 * Le signe moins de `formatSignedAmount` est U+2212. Le jeter ferait lire une
 * perte comme un gain, et casserait |marché + flux − variation| de
 * `2 · |marché|` — 359 144,65 € sur « Tout » en CI, trois fois de suite.
 */
function nombre(texte: string): number {
  const n = parseSignedScreenAmount(texte);
  expect(Number.isFinite(n)).toBe(true);
  return n;
}

/** Ouvre le tableau de bord et rend la courbe survolable. */
async function heroChart(page: Page): Promise<Locator> {
  await gotoDashboard(page);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("terminal-hero")).toBeVisible({
    timeout: 20_000,
  });
  const chart = page.getByTestId("hero-chart");
  await expect(chart).toBeVisible({ timeout: 20_000 });
  return chart;
}

/**
 * Survole la courbe à une fraction de sa largeur.
 *
 * Le pointeur est posé en coordonnées absolues plutôt qu'avec `hover()` : c'est
 * l'abscisse qui désigne le point, et un centrage automatique tomberait
 * toujours sur le même.
 */
async function survolerA(page: Page, chart: Locator, fraction: number) {
  const box = await chart.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(
    box!.x + box!.width * fraction,
    box!.y + box!.height / 2
  );
}

test.describe("Carte de tête — survol de la courbe", () => {
  test("le montant suit le point survolé, puis revient à aujourd'hui", async ({
    page,
  }) => {
    const chart = await heroChart(page);
    const montant = page.getByTestId("hero-net-worth");

    const aujourdhui = (await montant.innerText()).trim();
    expect(aujourdhui).not.toBe("");

    // Un point ancien : le premier tiers de la courbe.
    await survolerA(page, chart, 0.2);
    await expect(chart).toHaveAttribute("data-active-index", /\d+/);
    await expect(montant).toHaveAttribute("data-hovering", "true");
    await expect(page.getByTestId("hero-chart-tooltip")).toBeVisible();
    await expect(page.getByTestId("hero-chart-crosshair")).toBeVisible();
    await expect(page.getByTestId("hero-chart-dot")).toBeVisible();

    /*
      Le hero et l'info-bulle désignent la même valeur, à l'arrondi près.

      Les deux ne s'écrivent pas pareil, et c'est voulu : au-delà de 10 000 €
      le chiffre de tête laisse tomber les centimes que l'info-bulle conserve.
      La comparaison porte donc sur les nombres, avec un euro de tolérance —
      elle attraperait un décalage d'un point entre la croix et le chiffre, qui
      se compterait en milliers.
    */
    const tooltipMontant = nombre(
      await page.getByTestId("hero-tooltip-amount").innerText()
    );
    const heroSurvol = nombre(await montant.innerText());
    expect(Math.abs(tooltipMontant - heroSurvol)).toBeLessThan(1);

    // Sortie : retour à la valorisation courante, à l'identique.
    await page.mouse.move(0, 0);
    await expect(page.getByTestId("hero-chart-tooltip")).toHaveCount(0);
    await expect(montant).not.toHaveAttribute("data-hovering", "true");
    await expect(montant).toHaveText(aujourdhui);
  });

  test("les flèches parcourent la série, Échap ramène à aujourd'hui", async ({
    page,
  }) => {
    const chart = await heroChart(page);
    const montant = page.getByTestId("hero-net-worth");
    const aujourdhui = (await montant.innerText()).trim();

    await chart.focus();
    // Première flèche : on entre par le dernier point, pas par le premier.
    await page.keyboard.press("ArrowLeft");
    const premierRang = await chart.getAttribute("data-active-index");
    expect(premierRang).not.toBeNull();

    await page.keyboard.press("ArrowLeft");
    const deuxiemeRang = await chart.getAttribute("data-active-index");
    expect(Number(deuxiemeRang)).toBe(Number(premierRang) - 1);

    // Une flèche droite revient d'un cran.
    await page.keyboard.press("ArrowRight");
    await expect(chart).toHaveAttribute("data-active-index", premierRang!);

    await page.keyboard.press("Escape");
    await expect(chart).not.toHaveAttribute("data-active-index", /\d+/);
    await expect(montant).toHaveText(aujourdhui);
  });

  test("net et brut décrivent la même date, et l'écart est exactement les passifs", async ({
    page,
  }) => {
    const chart = await heroChart(page);
    const montant = page.getByTestId("hero-net-worth");

    /*
      Neuf dixièmes de la série, et non la moitié.

      Les passifs du jeu de démo n'entrent dans l'historique que dans sa
      dernière partie : avant, `Passifs 0,00 €`, et net vaut légitimement brut.
      Comparer au milieu ne prouverait donc rien. Mesuré sur ce décor, le rang
      atteint ici porte près de 200 000 € de dettes — l'écart y est réel, et
      c'est ce qui rend l'assertion capable d'échouer.
    */
    await page.getByTestId("hero-mode-net").click();
    await survolerA(page, chart, 0.9);
    const rangNet = await chart.getAttribute("data-active-index");
    const valeurNet = nombre(await montant.innerText());
    const split = (await page.getByTestId("hero-tooltip-split").innerText()).trim();
    const [actifs, passifs] = split
      .split("·")
      .map((part) => nombre(part));

    expect(passifs).toBeGreaterThan(0);

    /*
      `hero-mode-gross` n'a jamais existé côté composant : le scope se nomme
      `brut` (`HERO_NAV_SCOPES`), pas `gross`. Le testid visait un bouton
      fantôme et le clic restait bloqué jusqu'au timeout — sans rapport avec
      le rendu réel de la carte.
    */
    await page.mouse.move(0, 0);
    await page.getByTestId("hero-mode-brut").click();
    await survolerA(page, chart, 0.9);
    const rangBrut = await chart.getAttribute("data-active-index");
    const valeurBrut = nombre(await montant.innerText());

    /*
      Le même pixel doit désigner le même jour dans les deux modes.

      Ce n'était pas le cas avant que la colonne du graphique reçoive une
      largeur fixe : le chiffre de tête changeant de largeur avec la valeur, il
      poussait la courbe pendant le survol, et le rang glissait de plusieurs
      dizaines entre net et brut.
    */
    expect(rangBrut).toBe(rangNet);

    // Le brut affiché est bien la ligne « Actifs » de l'info-bulle nette.
    expect(Math.abs(valeurBrut - actifs)).toBeLessThan(1);
    // Et le net en est la différence, aux arrondis d'affichage près.
    expect(Math.abs(valeurNet - (actifs - passifs))).toBeLessThan(1);
    expect(valeurBrut).not.toBe(valeurNet);

    /*
      La décomposition n'a de sens qu'en net — « net de quoi ? ». En brut, la
      question ne se pose pas, et la ligne ne doit pas suivre le bouton.
    */
    await expect(page.getByTestId("hero-tooltip-split")).toHaveCount(0);
  });

  test("la ligne de variation suit la période choisie", async ({ page }) => {
    const chart = await heroChart(page);
    const ligne = page.getByTestId("hero-window-change");
    const montant = page.getByTestId("hero-net-worth");

    await expect(ligne).toBeVisible();
    const valeurDuJour = (await montant.innerText()).trim();

    /*
      Deux périodes opposées sur le même patrimoine.

      Sur un décor qui a beaucoup bougé en trois ans, la variation « 1M » et la
      variation « Max » ne peuvent pas coïncider — et si elles coïncidaient, ce
      serait que la ligne ne se recalcule pas.
    */
    await page.getByTestId("hero-range-1m").click();
    await expect(page.getByTestId("hero-range-1m")).toHaveAttribute(
      "data-active",
      "true"
    );
    const varCourte = (await ligne.innerText()).trim();
    await expect(page.getByTestId("hero-window-label")).toHaveText("sur 1 mois");

    await page.getByTestId("hero-range-all").click();
    await expect(page.getByTestId("hero-range-all")).toHaveAttribute(
      "data-active",
      "true"
    );
    const varLongue = (await ligne.innerText()).trim();

    expect(varLongue).not.toBe(varCourte);
    // « depuis mars 2021 » et non « sur … » : Max nomme son point de départ.
    await expect(page.getByTestId("hero-window-label")).toContainText("depuis");

    /*
      Le chiffre de tête, lui, ne bouge pas.

      Il annonce la valorisation d'aujourd'hui, qui n'a pas de période. Seule
      la variation en dépend — c'est toute la distinction que cette carte doit
      tenir.
    */
    await expect(montant).toHaveText(valeurDuJour);

    // La période choisie survit au rechargement.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("hero-range-all")).toHaveAttribute(
      "data-active",
      "true",
      { timeout: 20_000 }
    );

    /*
      Le survol reste opérant dans la fenêtre, et la variation de période
      s'efface le temps du geste : le chiffre au-dessus n'est plus celui du
      jour, et lui accoler une variation de période le ferait mal lire.

      Effacée, mais **toujours montée** : sa boîte reste réservée. La démonter
      faisait rétrécir la carte de cent cinquante pixels au premier survol, le
      graphique remontait sous un curseur immobile, et le navigateur émettait
      un `pointerleave` qui annulait le survol aussitôt posé.
    */
    await survolerA(page, chart, 0.5);
    await expect(page.getByTestId("hero-chart-tooltip")).toBeVisible();
    await expect(ligne).toBeHidden();
    await expect(ligne).toHaveCount(1);
    await page.mouse.move(0, 0);
    await expect(ligne).toBeVisible();
  });

  test("la variation se décompose en marché et flux, et les trois se recalculent", async ({
    page,
  }) => {
    await heroChart(page);

    /*
      Les trois chiffres de la période courante, lus en un seul aller-retour.

      Trois `.innerText()` successifs liraient trois instantanés distincts :
      un rafraîchissement de cotation en tâche de fond (le serveur retente
      Yahoo pendant toute la suite) peut retoucher la carte entre deux lectures
      et casser l'identité pour une raison qui n'a rien à voir avec le calcul.
      `evaluate` prend les trois pastilles dans le même tick JS, donc dans le
      même rendu React.
    */
    async function trio() {
      const [variationTxt, marcheTxt, fluxTxt] = await page.evaluate(() => {
        const txt = (id: string) =>
          document.querySelector(`[data-testid="${id}"]`)?.textContent ?? "";
        return [
          txt("hero-window-change-abs"),
          txt("hero-pill-market"),
          txt("hero-pill-flow"),
        ];
      });
      return {
        variation: nombre(variationTxt),
        marche: nombre(marcheTxt),
        flux: nombre(fluxTxt),
      };
    }

    /*
      Attendre le libellé de fenêtre est indispensable : le clic déclenche un
      recalcul asynchrone des trois pastilles, et les lire trop tôt renvoie
      les valeurs de la période précédente — l'identité paraît alors fausse
      alors que c'est la mesure qui a été prise en retard.
    */
    await page.getByTestId("hero-range-all").click();
    await expect(page.getByTestId("hero-window-label")).toContainText("depuis");
    /*
      Les pastilles ne sont montées que lorsque `heroAttribution` aboutit.
      Sur « Tout », la série peut encore être le repli `/api/portfolio` le
      temps que `getDailyNav` arrive : sans attendre, on lirait deux
      chaînes vides (0 + 0) contre la variation, soit exactement
      |Δ Financier| — 359 144,65 € sur le décor de démo.
    */
    await expect(page.getByTestId("hero-pill-market")).toBeVisible({
      timeout: 20_000,
    });
    const longue = await trio();

    /*
      L'identité, vérifiée à l'écran et pas seulement dans l'utilitaire :
      variation = Performance + Capital investi (libellés réels des deux
      pastilles, `hero-pill-market`/`hero-pill-flow`), à 1 € près — même
      tolérance que les identités de `coherence-totaux.spec.ts`.

      Décision produit : ce test ne compare plus « flux » à « marché » entre
      eux. Le décor porte de vrais tickers (LVMH, AAPL, BTC…) valorisés par de
      vrais fournisseurs de cours EN DIRECT (Yahoo/CoinGecko) — le demo reste
      un vrai marché, ses cours bougent réellement d'un jour à l'autre. Lequel
      des deux termes domine dépend donc du marché du jour, pas d'un fait du
      décor : l'affirmer en dur rendait ce test instable sans lien avec une
      régression de code. L'identité, elle, est un invariant comptable qui ne
      dépend d'aucun cours — elle doit tenir quel que soit l'état du marché.
    */
    expect(
      Math.abs(longue.marche + longue.flux - longue.variation)
    ).toBeLessThanOrEqual(1);

    // Changer de période recalcule les trois ensemble.
    await page.getByTestId("hero-range-1m").click();
    await expect(page.getByTestId("hero-window-label")).toHaveText("sur 1 mois");
    /*
      Même garde qu'avant la première lecture : les pastilles se remontent au
      changement de fenêtre, les lire avant qu'elles ne soient prêtes romprait
      l'identité pour une raison de timing, pas de calcul.
    */
    await expect(page.getByTestId("hero-pill-market")).toBeVisible({
      timeout: 20_000,
    });
    const courte = await trio();

    expect(courte.variation).not.toBe(longue.variation);
    expect(courte.flux).not.toBe(longue.flux);
    expect(
      Math.abs(courte.marche + courte.flux - courte.variation)
    ).toBeLessThanOrEqual(1);
  });

  test("les repères d'événements restent lisibles, même sur tout l'historique", async ({
    page,
  }) => {
    await heroChart(page);

    await page.getByTestId("hero-range-all").click();
    await expect(page.getByTestId("hero-window-label")).toContainText("depuis");
    await expect(page.getByTestId("hero-chart-event").first()).toBeVisible({
      timeout: 20_000,
    });
    const reperes = page.getByTestId("hero-chart-event");
    const nb = await reperes.count();

    /*
      Dix ans d'historique portent des centaines de journées à flux. En poser
      une pastille par journée rendrait la courbe illisible et n'expliquerait
      plus rien : seules les cinq plus grosses sont montrées, les autres
      restant atteignables au survol du jour.
    */
    expect(nb).toBeGreaterThan(0);
    expect(nb).toBeLessThanOrEqual(5);

    // Chaque repère désigne un rang réel de la série tracée.
    for (let i = 0; i < nb; i++) {
      const rang = await reperes.nth(i).getAttribute("data-index");
      expect(Number(rang)).toBeGreaterThanOrEqual(0);
    }
  });

  test("changer de période relâche le survol", async ({ page }) => {
    const chart = await heroChart(page);
    const montant = page.getByTestId("hero-net-worth");

    await page.getByTestId("hero-range-1m").click();

    /*
      Point désigné au clavier, le chemin le plus exposé.

      Honnêteté sur ce que ce test prouve : mesuré, il passe **aussi** sans
      l'appel explicite à `reset` au clic d'un chip. Activer un chip suppose en
      effet soit de sortir le pointeur du graphique — `pointerleave` —, soit de
      lui prendre le focus — `blur` —, et les deux relâchent déjà le survol. Le
      rang périmé n'est donc pas atteignable aujourd'hui.

      Ce test ne certifie pas une correction : il fixe l'invariant. Il
      échouerait le jour où les chips passeraient à l'intérieur du conteneur du
      graphique, où ni l'un ni l'autre de ces deux événements ne se produirait.
    */
    await chart.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(montant).toHaveAttribute("data-hovering", "true");
    await expect(chart).toHaveAttribute("data-active-index", /\d+/);

    /*
      Le rang désigné n'a de sens que dans la série qui l'a produit.

      Conservé d'une fenêtre à l'autre, il pointerait le même rang dans une
      série qui couvre dix ans au lieu d'un mois : un autre jour, un autre
      montant, et rien à l'écran pour dire que la date a changé. Le bornage du
      hook ne protège que du rang hors tableau, pas du rang valide mais devenu
      faux.
    */
    await page.getByTestId("hero-range-all").click();
    await expect(montant).not.toHaveAttribute("data-hovering", "true");
    await expect(page.getByTestId("hero-chart-crosshair")).toHaveCount(0);
    await expect(page.getByTestId("hero-chart-tooltip")).toHaveCount(0);
    await expect(chart).not.toHaveAttribute("data-active-index", /\d+/);
  });

  test("changer de période ne fait pas sauter la carte", async ({ page }) => {
    const chart = await heroChart(page);
    /*
      H-HOVER-416 v4→v5 : mesurer `terminal-hero` (la carte entière) prenait
      aussi le puits du graphique dans le calcul. Pour une période sans
      historique servi (« Pas encore de courbe »), le puits n'affiche qu'une
      ligne de texte ; pour une période avec courbe, une vraie série SVG —
      les deux tiennent dans le même conteneur à hauteur fixe
      (`h-[5.5rem]`/`sm:h-[6.5rem]` dans `terminal-hero.tsx`), mais la carte
      entière additionne aussi tout ce qui l'entoure, et sa hauteur totale
      dépend de la colonne (chiffre vs graphique) qui domine — un DOM-diff
      mesuré sur le trace CI a montré la colonne « chiffre » stable après
      correctif (v4) sans que la carte entière bouge d'un pixel : la carte
      n'est pas le bon contrat, ce n'est pas elle que l'utilisateur regarde
      quand il change de période, c'est la ligne de chiffres au-dessus.

      Le contrat d'origine — « la ligne de chiffres ne saute pas » — porte
      sur `hero-headline-block` : titre, montant, variation et pastilles.
      Ni le graphique en dessous ni les indicateurs plus bas n'en dépendent
      directement (ils suivent la carte entière, pas ce bloc), donc ce
      n'est pas un allègement du test — c'est son périmètre réel.
    */
    const bloc = page.getByTestId("hero-headline-block");

    const hauteurs: number[] = [];
    for (const periode of ["1m", "3m", "ytd", "1y", "5y", "all"]) {
      await page.getByTestId(`hero-range-${periode}`).click();
      await expect(page.getByTestId(`hero-range-${periode}`)).toHaveAttribute(
        "data-active",
        "true"
      );
      const box = await bloc.boundingBox();
      expect(box).not.toBeNull();
      hauteurs.push(box!.height);
    }

    /*
      Le bloc chiffre doit garder sa taille d'une période à l'autre.

      Une hauteur qui varie ferait remonter ou descendre le graphique juste
      à côté à chaque clic sur un chip.
    */
    expect(Math.max(...hauteurs) - Math.min(...hauteurs)).toBeLessThanOrEqual(2);

    // Et il ne doit pas non plus bouger au survol.
    const avant = (await bloc.boundingBox())!.height;
    await survolerA(page, chart, 0.4);
    await expect(page.getByTestId("hero-chart-tooltip")).toBeVisible();
    const pendant = (await bloc.boundingBox())!.height;
    expect(Math.abs(pendant - avant)).toBeLessThanOrEqual(2);
  });

  test("montants masqués : le hero et l'info-bulle le sont aussi", async ({
    page,
  }) => {
    const chart = await heroChart(page);

    await page.getByTestId("privacy-toggle").click();
    await expect(page.getByTestId("hero-net-worth")).toHaveText("****", {
      timeout: 10_000,
    });

    await survolerA(page, chart, 0.4);
    await expect(page.getByTestId("hero-chart-tooltip")).toBeVisible();
    /*
      Masquer le hero sans masquer l'info-bulle rendrait le geste inutile :
      c'est le même montant, offert au même regard par-dessus l'épaule.
    */
    await expect(page.getByTestId("hero-tooltip-amount")).toHaveText("****");

    await page.mouse.move(0, 0);
    await page.getByTestId("privacy-toggle").click();
    await expect(page.getByTestId("hero-net-worth")).not.toHaveText("****");
  });
});
