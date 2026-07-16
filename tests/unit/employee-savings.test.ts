import { describe, expect, it } from "vitest";
import {
  addYears,
  buildUnlockTimeline,
  marketValue,
  resolveUnlock,
} from "../../app/lib/employee-savings/logic";
import { parseEmployeeSavingsCsv } from "../../app/lib/employee-savings/csv";

describe("resolveUnlock PEE", () => {
  it("computes +5 years from contribution date", () => {
    const r = resolveUnlock({
      planType: "PEE",
      unlockMode: "DATE",
      contributionDate: "2020-06-15",
      now: new Date("2024-01-01"),
    });
    expect(r.unlockMode).toBe("DATE");
    expect(r.liquidityStatus).toBe("BLOCKED");
    expect(r.unlockDate?.getFullYear()).toBe(2025);
  });

  it("marks available after unlock date", () => {
    const r = resolveUnlock({
      planType: "PEE",
      unlockMode: "DATE",
      unlockDate: "2020-01-01",
      now: new Date("2024-06-01"),
    });
    expect(r.liquidityStatus).toBe("AVAILABLE");
  });
});

describe("resolveUnlock PER/PERCO", () => {
  it("defaults to retirement lock", () => {
    const r = resolveUnlock({
      planType: "PER",
      now: new Date("2024-01-01"),
    });
    expect(r.unlockMode).toBe("RETIREMENT");
    expect(r.liquidityStatus).toBe("BLOCKED");
    expect(r.unlockLabel).toBe("Retraite");
  });
});

describe("marketValue & timeline", () => {
  it("multiplies units × nav", () => {
    expect(marketValue("10", "2.5")).toBe(25);
  });

  it("builds year buckets", () => {
    const t = buildUnlockTimeline([
      {
        marketValue: 100,
        liquidityStatus: "AVAILABLE",
        unlockMode: "DATE",
        unlockDate: new Date("2020-01-01"),
      },
      {
        marketValue: 50,
        liquidityStatus: "BLOCKED",
        unlockMode: "DATE",
        unlockDate: new Date("2027-06-01"),
      },
      {
        marketValue: 200,
        liquidityStatus: "BLOCKED",
        unlockMode: "RETIREMENT",
        unlockDate: null,
      },
    ]);
    expect(t.find((b) => b.key === "available")?.amount).toBe("100.00");
    expect(t.find((b) => b.key === "2027")?.amount).toBe("50.00");
    expect(t.find((b) => b.key === "retirement")?.amount).toBe("200.00");
  });

  it("addYears preserves month/day", () => {
    const d = addYears(new Date(2020, 5, 15), 5);
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(15);
  });
});

describe("CSV parse", () => {
  it("parses FR semicolon template", () => {
    const csv = `plan_type;manager;fund_name;isin;units;nav;currency;source_type;contribution_date;unlock_date;unlock_mode;notes
PEE;Amundi;FCPE Test;FR001;10;20;EUR;ABONDEMENT;2021-06-15;;;
PER;Natixis;FCPE Ret;;5;10;EUR;VOLUNTARY;;;RETIREMENT;
`;
    const { rows, errors } = parseEmployeeSavingsCsv(csv);
    expect(errors.filter((e) => !e.message.includes("vide")).length).toBe(0);
    expect(rows).toHaveLength(2);
    expect(rows[0].planType).toBe("PEE");
    expect(rows[0].sourceType).toBe("ABONDEMENT");
    expect(rows[0].units).toBe("10");
    expect(rows[1].unlockMode).toBe("RETIREMENT");
  });
});
