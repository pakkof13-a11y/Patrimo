import DecimalJS from "decimal.js";

/** Domain money/quantity arithmetic — never use JS number for money. */
DecimalJS.set({
  precision: 28,
  rounding: DecimalJS.ROUND_HALF_UP,
  toExpNeg: -18,
  toExpPos: 28,
});

export type Decimal = DecimalJS;
export type DecimalInput = string | number | DecimalJS;

export const Decimal = DecimalJS;

export function d(value: DecimalInput = 0): Decimal {
  if (value instanceof DecimalJS) return value;
  if (value === null || value === undefined || (value as unknown) === "") {
    return new DecimalJS(0);
  }
  return new DecimalJS(value as string | number);
}

export function zero(): Decimal {
  return new DecimalJS(0);
}

export function isPositive(value: DecimalInput): boolean {
  return d(value).gt(0);
}

export function isNegative(value: DecimalInput): boolean {
  return d(value).lt(0);
}

export function isZero(value: DecimalInput): boolean {
  return d(value).isZero();
}

export function max(a: DecimalInput, b: DecimalInput): Decimal {
  const da = d(a);
  const db = d(b);
  return da.gte(db) ? da : db;
}

export function min(a: DecimalInput, b: DecimalInput): Decimal {
  const da = d(a);
  const db = d(b);
  return da.lte(db) ? da : db;
}

/** Serialize for JSON / Prisma string input */
export function toFixed(value: DecimalInput, places = 8): string {
  return d(value).toFixed(places);
}

export function toNumberSafe(value: DecimalInput): number {
  return d(value).toNumber();
}

export function sum(values: DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(d(v)), zero());
}
