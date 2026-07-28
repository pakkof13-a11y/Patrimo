import { describe, expect, it } from "vitest";
import {
  DefiInputError,
  validateVestingSchedule,
  type VestingTrancheInput,
} from "@/app/lib/crypto/defi-manual-service";

describe("validateVestingSchedule", () => {
  it("accepte un vesting sans erreur", () => {
    const schedule: VestingTrancheInput[] = [
      { endAt: "2026-12-01T00:00:00Z", amount: "100" },
      { cliffAt: "2026-06-01T00:00:00Z", endAt: "2027-06-01T00:00:00Z", amount: "900" },
    ];
    expect(() => validateVestingSchedule(schedule)).not.toThrow();
  });

  it("accepte une liste vide", () => {
    expect(() => validateVestingSchedule([])).not.toThrow();
  });

  it("rejette une échéance invalide", () => {
    const schedule: VestingTrancheInput[] = [{ endAt: "pas une date", amount: "100" }];
    expect(() => validateVestingSchedule(schedule)).toThrow(DefiInputError);
  });

  it("rejette un cliff postérieur à l'échéance", () => {
    const schedule: VestingTrancheInput[] = [
      { cliffAt: "2027-01-01T00:00:00Z", endAt: "2026-01-01T00:00:00Z", amount: "100" },
    ];
    expect(() => validateVestingSchedule(schedule)).toThrow(/précéder/i);
  });

  it("rejette un montant nul ou négatif", () => {
    expect(() =>
      validateVestingSchedule([{ endAt: "2026-12-01T00:00:00Z", amount: "0" }])
    ).toThrow(DefiInputError);
    expect(() =>
      validateVestingSchedule([{ endAt: "2026-12-01T00:00:00Z", amount: "-1" }])
    ).toThrow(DefiInputError);
  });
});
