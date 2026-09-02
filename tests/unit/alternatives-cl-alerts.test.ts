import { describe, expect, it } from "vitest";
import { crowdlendingAlertCounts } from "@/app/lib/alternatives/types";

describe("crowdlendingAlertCounts", () => {
  it("hasAlerts=false quand tous les prêts sont ACTIVE/REPAID (aucun LATE/DEFAULT)", () => {
    const byStatus = [
      { status: "ACTIVE", label: "En cours", count: 3, capital: 10000 },
      { status: "REPAID", label: "Remboursé", count: 2, capital: 5000 },
    ];
    expect(crowdlendingAlertCounts(byStatus)).toEqual({
      lateCount: 0,
      defaultCount: 0,
      hasAlerts: false,
    });
  });

  it("hasAlerts=false quand byStatus est vide ou absent", () => {
    expect(crowdlendingAlertCounts([])).toEqual({
      lateCount: 0,
      defaultCount: 0,
      hasAlerts: false,
    });
    expect(crowdlendingAlertCounts(undefined)).toEqual({
      lateCount: 0,
      defaultCount: 0,
      hasAlerts: false,
    });
  });

  it("hasAlerts=true et lateCount correct quand au moins un prêt est LATE", () => {
    const byStatus = [
      { status: "ACTIVE", label: "En cours", count: 2, capital: 8000 },
      { status: "LATE", label: "En retard", count: 1, capital: 2000 },
    ];
    expect(crowdlendingAlertCounts(byStatus)).toEqual({
      lateCount: 1,
      defaultCount: 0,
      hasAlerts: true,
    });
  });

  it("hasAlerts=true et defaultCount correct quand au moins un prêt est DEFAULT", () => {
    const byStatus = [
      { status: "REPAID", label: "Remboursé", count: 4, capital: 12000 },
      { status: "DEFAULT", label: "Défaut", count: 2, capital: 3000 },
    ];
    expect(crowdlendingAlertCounts(byStatus)).toEqual({
      lateCount: 0,
      defaultCount: 2,
      hasAlerts: true,
    });
  });

  it("cumule lateCount et defaultCount quand les deux statuts sont présents", () => {
    const byStatus = [
      { status: "LATE", label: "En retard", count: 1, capital: 1000 },
      { status: "DEFAULT", label: "Défaut", count: 1, capital: 500 },
    ];
    expect(crowdlendingAlertCounts(byStatus)).toEqual({
      lateCount: 1,
      defaultCount: 1,
      hasAlerts: true,
    });
  });

  it("repasse à hasAlerts=false une fois tous les prêts en retard remboursés (transition LATE → REPAID)", () => {
    const before = [
      { status: "ACTIVE", label: "En cours", count: 1, capital: 4000 },
      { status: "LATE", label: "En retard", count: 1, capital: 1000 },
    ];
    expect(crowdlendingAlertCounts(before).hasAlerts).toBe(true);

    // Le prêt LATE est remboursé : byStatus ne contient plus que ACTIVE/REPAID
    const after = [
      { status: "ACTIVE", label: "En cours", count: 1, capital: 4000 },
      { status: "REPAID", label: "Remboursé", count: 1, capital: 1000 },
    ];
    expect(crowdlendingAlertCounts(after)).toEqual({
      lateCount: 0,
      defaultCount: 0,
      hasAlerts: false,
    });
  });
});
