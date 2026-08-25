import { test, expect, type APIRequestContext } from "@playwright/test";

/**
 * Lire les passifs ne doit rien changer — ni en base, ni au chiffre suivant.
 *
 * Le module Crédits amortissait en base avant de répondre. Un simple GET
 * écrivait 79 `LiabilityEvent` sur le compte de démonstration, et le patrimoine
 * net perdait 64 020 € au passage : il valait 733 379,70 € avant la visite,
 * 797 399,70 € après. L'assiette IFI bougeait de 57 820 € par le même chemin.
 *
 * Ces tests verrouillent les deux propriétés qui manquaient : l'ordre de
 * navigation n'a aucun effet sur les totaux, et une lecture n'écrit pas.
 *
 * Ils ne présument aucun montant : ils comparent des séquences entre elles.
 * Une valeur figée se périmerait au premier changement de seed, alors que
 * l'invariant, lui, doit tenir quelles que soient les données.
 */

const num = (v: unknown) => Number(v ?? 0);

async function json(request: APIRequestContext, path: string) {
  const res = await request.get(path);
  expect(res.ok(), `${path} → ${res.status()}`).toBeTruthy();
  return res.json();
}

const liabilitiesOf = async (r: APIRequestContext) =>
  num((await json(r, "/api/portfolio")).summary?.totalLiabilitiesEur);

const netWorthOf = async (r: APIRequestContext) =>
  num((await json(r, "/api/portfolio")).summary?.netWorthEur);

/** Nombre d'échéances matérialisées, tous crédits confondus. */
async function eventCount(request: APIRequestContext) {
  const data = await json(request, "/api/liabilities");
  return (data.liabilities ?? []).reduce(
    (acc: number, l: { events?: unknown[] }) => acc + (l.events?.length ?? 0),
    0
  );
}

test.describe("Passifs — la lecture est pure", () => {
  test("le total des passifs ne dépend pas de l'ordre de navigation", async ({
    request,
  }) => {
    const avant = await liabilitiesOf(request);

    // L'écran qui écrivait autrefois.
    await json(request, "/api/liabilities");

    const apres = await liabilitiesOf(request);
    expect(
      apres,
      `Passifs : ${avant} € avant la visite du module Crédits, ${apres} € après. ` +
        `Une lecture a déplacé le total.`
    ).toBeCloseTo(avant, 2);
  });

  test("le patrimoine net ne dépend pas de l'ordre de navigation", async ({
    request,
  }) => {
    const avant = await netWorthOf(request);
    await json(request, "/api/liabilities");
    const apres = await netWorthOf(request);

    expect(
      apres,
      `Patrimoine net : ${avant} € avant la visite du module Crédits, ${apres} € après.`
    ).toBeCloseTo(avant, 2);
  });

  test("/api/holdings et /api/liabilities commutent", async ({ request }) => {
    // Séquence A : holdings puis crédits.
    const a = num((await json(request, "/api/holdings")).summary?.totalLiabilitiesEur);
    await json(request, "/api/liabilities");

    // Séquence B : crédits puis holdings.
    await json(request, "/api/liabilities");
    const b = num((await json(request, "/api/holdings")).summary?.totalLiabilitiesEur);

    expect(b, `holdings→crédits ${a} € contre crédits→holdings ${b} €`).toBeCloseTo(
      a,
      2
    );
  });

  test("un GET n'écrit aucune échéance", async ({ request }) => {
    const avant = await eventCount(request);

    await json(request, "/api/portfolio");
    await json(request, "/api/liabilities");
    await json(request, "/api/holdings");
    await json(request, "/api/real-estate/properties");

    const apres = await eventCount(request);
    expect(
      apres,
      `${avant} échéance(s) matérialisée(s) avant les lectures, ${apres} après : ` +
        `un GET a écrit en base.`
    ).toBe(avant);
  });

  test("le module Crédits et la fiche du bien affichent le même prêt", async ({
    request,
  }) => {
    const [credits, biens] = await Promise.all([
      json(request, "/api/liabilities"),
      json(request, "/api/real-estate/properties"),
    ]);

    const parId = new Map<string, number>(
      (credits.liabilities ?? []).map((l: { id: string; remainingAmount: string }) => [
        l.id,
        num(l.remainingAmount),
      ])
    );

    const prets = (biens.properties ?? []).flatMap(
      (p: { loans?: Array<{ id: string; name: string; remainingAmountEur: string }> }) =>
        p.loans ?? []
    );

    // Le compte de démonstration porte un crédit immobilier rattaché à un bien.
    // Si ce n'était plus le cas, le test ne prouverait rien — on le dit.
    expect(
      prets.length,
      "Aucun prêt rattaché à un bien : ce scénario n'est plus couvert par les données."
    ).toBeGreaterThan(0);

    for (const pret of prets) {
      const attendu = parId.get(pret.id);
      expect(attendu, `Prêt « ${pret.name} » absent du module Crédits`).toBeDefined();
      expect(
        num(pret.remainingAmountEur),
        `Prêt « ${pret.name} » : fiche du bien ${pret.remainingAmountEur} €, ` +
          `module Crédits ${attendu} €.`
      ).toBeCloseTo(attendu as number, 2);
    }
  });

  test("l'assiette IFI ne dépend pas de l'ordre de navigation", async ({
    request,
  }) => {
    const dette = async () =>
      num((await json(request, "/api/real-estate/tax")).ifi?.totalDeductibleDebtEur);

    const avant = await dette();
    await json(request, "/api/liabilities");
    const apres = await dette();

    expect(
      apres,
      `Dette déductible IFI : ${avant} € avant la visite du module Crédits, ${apres} € après.`
    ).toBeCloseTo(avant, 2);
  });
});
