import { describe, expect, it } from "vitest";
import { Prisma } from "@/app/lib/prisma-client/client";
import { decFromInput, intFromInput } from "@/app/lib/alternatives/parse-decimal";

describe("decFromInput", () => {
  it("FR : séparateur de milliers espace + décimale virgule", () => {
    expect(decFromInput("45 000,00").toString()).toBe(
      new Prisma.Decimal(45000).toString()
    );
  });

  it("FR : séparateur de milliers point + décimale virgule", () => {
    expect(decFromInput("1.234,56").toString()).toBe(
      new Prisma.Decimal("1234.56").toString()
    );
  });

  it("replie sur le fallback quand la valeur est absente", () => {
    expect(decFromInput(undefined, "42").toString()).toBe(
      new Prisma.Decimal(42).toString()
    );
    expect(decFromInput(null, "42").toString()).toBe(
      new Prisma.Decimal(42).toString()
    );
  });

  it("replie sur le fallback quand la valeur n'est pas interprétable", () => {
    expect(decFromInput("abc", "7").toString()).toBe(
      new Prisma.Decimal(7).toString()
    );
  });

  it("fallback par défaut à 0 quand non précisé", () => {
    expect(decFromInput("").toString()).toBe(new Prisma.Decimal(0).toString());
  });
});

describe("intFromInput", () => {
  it("un cas valide", () => {
    expect(intFromInput("12")).toBe(12);
    expect(intFromInput("12,6")).toBe(13); // arrondi
  });

  it("vide → null", () => {
    expect(intFromInput("")).toBeNull();
    expect(intFromInput(undefined)).toBeNull();
    expect(intFromInput(null)).toBeNull();
  });

  it("non interprétable → null", () => {
    expect(intFromInput("abc")).toBeNull();
  });
});
