import { describe, expect, it } from "vitest";
import { toErrorMessage } from "@/app/lib/api-client";

describe("toErrorMessage", () => {
  it("keeps plain strings", () => {
    expect(toErrorMessage("Non authentifié")).toBe("Non authentifié");
  });

  it("extracts Error.message", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("avoids [object Object] from nested objects", () => {
    expect(toErrorMessage({ error: { message: "Validation échouée" } })).toBe(
      "Validation échouée"
    );
    expect(toErrorMessage({ message: "x" })).toBe("x");
  });

  it("falls back when message is the useless Object string", () => {
    expect(toErrorMessage(new Error("[object Object]"), "fallback")).toBe(
      "fallback"
    );
    expect(toErrorMessage({}, "fallback")).toBe("fallback");
  });
});
