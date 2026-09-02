import { describe, expect, it } from "vitest";
import {
  computeLockSummary,
  computeVestingProgress,
  type VestingTranche,
} from "@/app/lib/crypto/vesting";

describe("computeLockSummary — sans contrainte", () => {
  it("aucun champ posé → librement disponible", () => {
    const s = computeLockSummary({});
    expect(s.isLocked).toBe(false);
    expect(s.vestedPct).toBeNull();
    expect(s.nextUnlockAt).toBeNull();
  });
});

describe("computeLockSummary — unlockAt/cliffAt simples", () => {
  const now = new Date("2026-07-28T00:00:00Z");

  it("unlockAt futur → verrouillé, 0 %", () => {
    const s = computeLockSummary({ unlockAt: "2026-12-01T00:00:00Z" }, now);
    expect(s.isLocked).toBe(true);
    expect(s.vestedPct?.toNumber()).toBe(0);
    expect(s.nextUnlockAt?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("unlockAt passé → déverrouillé, 100 %", () => {
    const s = computeLockSummary({ unlockAt: "2026-01-01T00:00:00Z" }, now);
    expect(s.isLocked).toBe(false);
    expect(s.vestedPct?.toNumber()).toBe(100);
    expect(s.nextUnlockAt).toBeNull();
  });

  it("cliffAt seul, futur → verrouillé", () => {
    const s = computeLockSummary({ cliffAt: "2026-08-01T00:00:00Z" }, now);
    expect(s.isLocked).toBe(true);
  });

  it("unlockAt et cliffAt : retient la date la plus tardive", () => {
    const s = computeLockSummary(
      { unlockAt: "2026-08-01T00:00:00Z", cliffAt: "2026-09-01T00:00:00Z" },
      now
    );
    expect(s.nextUnlockAt?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("computeVestingProgress", () => {
  const now = new Date("2026-07-28T00:00:00Z");

  it("schedule vide → null", () => {
    expect(computeVestingProgress([], now)).toBeNull();
  });

  it("tranche sans cliff : tout-ou-rien à l'échéance", () => {
    const schedule: VestingTranche[] = [
      { endAt: "2026-01-01T00:00:00Z", amount: "100" }, // passée
      { endAt: "2026-12-01T00:00:00Z", amount: "100" }, // future
    ];
    const p = computeVestingProgress(schedule, now)!;
    expect(p.totalAmount.toNumber()).toBe(200);
    expect(p.vestedAmount.toNumber()).toBe(100);
    expect(p.vestedPct.toNumber()).toBe(50);
    expect(p.nextUnlockAt?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });

  it("tranche avec cliff : vesting linéaire entre cliff et échéance", () => {
    // Cliff au 1er juillet, échéance au 1er septembre (62 jours) ; `now` est
    // le 28 juillet → 27 jours après le cliff.
    const schedule: VestingTranche[] = [
      {
        cliffAt: "2026-07-01T00:00:00Z",
        endAt: "2026-09-01T00:00:00Z",
        amount: "1000",
      },
    ];
    const p = computeVestingProgress(schedule, now)!;
    const expectedFraction = (now.getTime() - new Date("2026-07-01T00:00:00Z").getTime()) /
      (new Date("2026-09-01T00:00:00Z").getTime() - new Date("2026-07-01T00:00:00Z").getTime());
    expect(p.vestedAmount.toNumber()).toBeCloseTo(1000 * expectedFraction, 6);
  });

  it("avant le cliff : 0 % même proche de l'échéance", () => {
    const schedule: VestingTranche[] = [
      {
        cliffAt: "2026-08-01T00:00:00Z",
        endAt: "2026-08-02T00:00:00Z",
        amount: "500",
      },
    ];
    const p = computeVestingProgress(schedule, now)!;
    expect(p.vestedAmount.toNumber()).toBe(0);
  });

  it("montants nuls ou invalides ignorés", () => {
    const schedule: VestingTranche[] = [
      { endAt: "2026-01-01T00:00:00Z", amount: "0" },
      { endAt: "2026-01-01T00:00:00Z", amount: "-5" },
      { endAt: "2026-01-01T00:00:00Z", amount: "10" },
    ];
    const p = computeVestingProgress(schedule, now)!;
    expect(p.totalAmount.toNumber()).toBe(10);
  });
});

describe("computeLockSummary — délègue à vestingSchedule quand présent", () => {
  const now = new Date("2026-07-28T00:00:00Z");

  it("vestingSchedule prime sur unlockAt/cliffAt", () => {
    const s = computeLockSummary(
      {
        unlockAt: "2020-01-01T00:00:00Z", // serait "déverrouillé" seul
        vestingSchedule: [{ endAt: "2027-01-01T00:00:00Z", amount: "100" }],
      },
      now
    );
    expect(s.isLocked).toBe(true);
    expect(s.vestedPct?.toNumber()).toBe(0);
    expect(s.totalAmount?.toNumber()).toBe(100);
  });

  it("toutes les tranches vestées → isLocked false", () => {
    const s = computeLockSummary(
      { vestingSchedule: [{ endAt: "2020-01-01T00:00:00Z", amount: "100" }] },
      now
    );
    expect(s.isLocked).toBe(false);
    expect(s.vestedPct?.toNumber()).toBe(100);
  });
});
