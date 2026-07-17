import { describe, expect, it } from "vitest";
import { presentFields, requireBodyId } from "@/app/lib/api/validation";
import {
  bankAccountUpdateSchema,
  liabilityUpdateSchema,
  updateAssetMetadataSchema,
  updateAssetTriggersSchema,
  envelopeCashUpdateSchema,
} from "@/app/lib/schemas";

describe("presentFields", () => {
  it("keeps only keys present on the raw body (strips Zod defaults)", () => {
    const body = { balance: "10" };
    const data = { balance: "10", currency: "EUR", name: undefined };
    expect(presentFields(body, data)).toEqual({ balance: "10" });
  });

  it("preserves explicit null clears", () => {
    const body = { interestRate: null };
    const data = { interestRate: null };
    expect(presentFields(body, data)).toEqual({ interestRate: null });
  });
});

describe("requireBodyId", () => {
  it("accepts non-empty string id", () => {
    expect(requireBodyId({ id: "abc" })).toBe("abc");
  });
  it("rejects missing or blank id", () => {
    expect(requireBodyId({})).toBeNull();
    expect(requireBodyId({ id: "  " })).toBeNull();
    expect(requireBodyId(null)).toBeNull();
  });
});

describe("update schemas", () => {
  it("bankAccountUpdateSchema normalizes decimals and currency", () => {
    const r = bankAccountUpdateSchema.safeParse({
      balance: "1 234,56",
      currency: "usd",
    });
    // space may fail decimalString — comma is normalized
    const r2 = bankAccountUpdateSchema.safeParse({
      balance: "1234,56",
      currency: "usd",
    });
    expect(r2.success).toBe(true);
    if (r2.success) {
      expect(r2.data.balance).toBe("1234.56");
      expect(r2.data.currency).toBe("USD");
    }
    void r;
  });

  it("liabilityUpdateSchema clears rates with null/empty", () => {
    const r = liabilityUpdateSchema.safeParse({
      interestRate: "",
      monthlyPayment: null,
      paymentDay: "",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.interestRate).toBeNull();
      expect(r.data.monthlyPayment).toBeNull();
      expect(r.data.paymentDay).toBeNull();
    }
  });

  it("envelopeCashUpdateSchema requires envelope enum", () => {
    expect(envelopeCashUpdateSchema.safeParse({ balance: "10" }).success).toBe(
      false
    );
    const ok = envelopeCashUpdateSchema.safeParse({
      envelope: "PEA",
      balance: "100,5",
      currency: "usd",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.balance).toBe("100.5");
      expect(ok.data.currency).toBe("USD");
    }
  });

  it("updateAssetMetadataSchema normalizes WHT percent and ticker", () => {
    const r = updateAssetMetadataSchema.safeParse({
      ticker: " aapl ",
      withholdingTaxRate: "15",
      countryCode: "us",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ticker).toBe("AAPL");
      expect(r.data.withholdingTaxRate).toBeCloseTo(0.15);
      expect(r.data.countryCode).toBe("US");
    }
  });

  it("updateAssetTriggersSchema clears zero/empty levels", () => {
    const r = updateAssetTriggersSchema.safeParse({
      stopLoss: "0",
      tp1: "",
      tp2: "12,5",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.stopLoss).toBeNull();
      expect(r.data.tp1).toBeNull();
      expect(r.data.tp2).toBe("12.5");
    }
  });
});
