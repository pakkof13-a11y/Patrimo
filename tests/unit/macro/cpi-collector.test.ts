import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
const upsert = vi.fn();

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    cpiObservation: {
      findMany: (...a: unknown[]) => findMany(...a),
      upsert: (...a: unknown[]) => upsert(...a),
    },
  },
}));

import {
  collectCpiObservations,
  type CpiProvider,
} from "@/app/lib/macro/cpi-collector";
import { mergeSeries, parseSdmxSeries } from "@/app/lib/macro/providers/insee-cpi";

/**
 * Ingestion de l'IPC.
 *
 * Les observations utilisées ici sont des **fixtures**. Le fournisseur INSEE
 * n'a jamais été exécuté contre l'API réelle : l'environnement n'a pas d'accès
 * sortant vers `bdm.insee.fr`. Ce qui est vérifié est la mécanique — dédoublonnage,
 * révision, panne — pas la conformité du format à une réponse observée.
 */

const provider = (obs: unknown[], throws?: Error): CpiProvider => ({
  id: "TEST",
  fetch: async () => {
    if (throws) throw throws;
    return obs as never;
  },
});

beforeEach(() => {
  findMany.mockReset().mockResolvedValue([]);
  upsert.mockReset().mockResolvedValue({});
});

describe("1 et 2 — ingestion des variations et des glissements", () => {
  it("enregistre un mois avec sa variation mensuelle", async () => {
    const r = await collectCpiObservations({
      provider: provider([{ period: "2026-06", monthlyRate: 0.002 }]),
      source: "TEST",
    });
    expect(r.created).toBe(1);
    const arg = upsert.mock.calls[0][0] as {
      create: { period: string; monthlyRate: number; yearlyRate: number | null };
    };
    expect(arg.create.period).toBe("2026-06");
    expect(arg.create.monthlyRate).toBeCloseTo(0.002, 12);
    expect(arg.create.yearlyRate).toBeNull();
  });

  it("enregistre le glissement annuel quand la source le publie", async () => {
    await collectCpiObservations({
      provider: provider([
        { period: "2026-06", monthlyRate: 0.002, yearlyRate: 0.021 },
      ]),
      source: "TEST",
    });
    const arg = upsert.mock.calls[0][0] as { create: { yearlyRate: number } };
    expect(arg.create.yearlyRate).toBeCloseTo(0.021, 12);
  });

  it("7 — la date de publication est conservée à part du mois décrit", async () => {
    const publiee = new Date("2026-07-15T08:00:00Z");
    await collectCpiObservations({
      provider: provider([
        { period: "2026-06", monthlyRate: 0.002, publishedAt: publiee },
      ]),
      source: "TEST",
    });
    const arg = upsert.mock.calls[0][0] as {
      create: { period: string; publishedAt: Date };
    };
    // Le mois décrit reste juin, quoique publié en juillet.
    expect(arg.create.period).toBe("2026-06");
    expect(arg.create.publishedAt).toEqual(publiee);
  });
});

describe("3 et 9 — idempotence et révisions", () => {
  it("un mois déjà enregistré à l'identique n'est pas réécrit", async () => {
    findMany.mockResolvedValue([
      {
        period: "2026-06",
        monthlyRate: { toString: () => "0.00200000" },
        yearlyRate: { toString: () => "0.02100000" },
      },
    ]);
    const r = await collectCpiObservations({
      provider: provider([
        { period: "2026-06", monthlyRate: 0.002, yearlyRate: 0.021 },
      ]),
      source: "TEST",
    });
    expect(r.unchanged).toBe(1);
    expect(r.created).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("une révision met la ligne à jour, sans créer de doublon", async () => {
    /*
      L'INSEE révise ses indices. La valeur la plus récente gagne, sur la même
      ligne : deux enregistrements pour le même mois se contrediraient.
    */
    findMany.mockResolvedValue([
      {
        period: "2026-06",
        monthlyRate: { toString: () => "0.00200000" },
        yearlyRate: null,
      },
    ]);
    const r = await collectCpiObservations({
      provider: provider([{ period: "2026-06", monthlyRate: 0.0025 }]),
      source: "TEST",
    });
    expect(r.revised).toBe(1);
    expect(r.created).toBe(0);
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0] as {
      where: { source_period: { source: string; period: string } };
    };
    expect(arg.where.source_period).toEqual({ source: "TEST", period: "2026-06" });
  });

  it("un glissement annuel qui apparaît plus tard est une révision", async () => {
    findMany.mockResolvedValue([
      {
        period: "2026-06",
        monthlyRate: { toString: () => "0.00200000" },
        yearlyRate: null,
      },
    ]);
    const r = await collectCpiObservations({
      provider: provider([
        { period: "2026-06", monthlyRate: 0.002, yearlyRate: 0.021 },
      ]),
      source: "TEST",
    });
    expect(r.revised).toBe(1);
  });
});

describe("4 et 5 — rattrapage et panne", () => {
  it("plusieurs mois sont comblés en une exécution", async () => {
    const r = await collectCpiObservations({
      provider: provider([
        { period: "2026-04", monthlyRate: 0.003 },
        { period: "2026-05", monthlyRate: 0.001 },
        { period: "2026-06", monthlyRate: 0.002 },
      ]),
      source: "TEST",
    });
    expect(r.created).toBe(3);
  });

  it("une source indisponible n'écrit rien et le dit", async () => {
    const r = await collectCpiObservations({
      provider: provider([], new Error("INSEE BDM 503")),
      source: "TEST",
    });
    expect(r.errors[0]).toContain("503");
    expect(r.created).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("une observation malformée est écartée sans faire tomber le reste", async () => {
    const r = await collectCpiObservations({
      provider: provider([
        { period: "juin 2026", monthlyRate: 0.002 },
        { period: "2026-06", monthlyRate: Number.NaN },
        { period: "2026-07", monthlyRate: 0.001 },
      ]),
      source: "TEST",
    });
    expect(r.fetched).toBe(1);
    expect(r.created).toBe(1);
  });
});

describe("format INSEE — analyse défensive", () => {
  it("une réponse inattendue rend une liste vide plutôt qu'une exception", () => {
    expect(parseSdmxSeries({})).toEqual([]);
    expect(parseSdmxSeries(null)).toEqual([]);
    expect(parseSdmxSeries({ dataSets: [] })).toEqual([]);
  });

  it("les pourcentages publiés deviennent des fractions", () => {
    const fusion = mergeSeries(
      [{ period: "2026-06", value: 0.2 }],
      [{ period: "2026-06", value: 2.1 }]
    );
    expect(fusion[0]!.monthlyRate).toBeCloseTo(0.002, 12);
    expect(fusion[0]!.yearlyRate).toBeCloseTo(0.021, 12);
  });

  it("un mois sans glissement annuel garde sa variation mensuelle", () => {
    // Les douze premiers mois d'une base n'ont pas de glissement annuel : la
    // fenêtre courte reste calculable, seule la longue attendra.
    const fusion = mergeSeries([{ period: "2026-06", value: 0.2 }], []);
    expect(fusion[0]!.monthlyRate).toBeCloseTo(0.002, 12);
    expect(fusion[0]!.yearlyRate).toBeNull();
  });

  it("une valeur absente est ignorée, jamais lue comme zéro", () => {
    expect(mergeSeries([{ period: "2026-06", value: null }], [])).toEqual([]);
  });
});
