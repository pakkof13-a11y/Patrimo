import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, toErrorMessage } from "@/app/lib/api-client";

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

describe("fetchJson empty body", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejette un 200 sans corps JSON (pas de {} silencieux)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("", {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        })
      )
    );
    await expect(fetchJson<{ ok: boolean }>("/api/x")).rejects.toThrow(
      /vide ou non-JSON/i
    );
  });

  it("accepte un 204 sans corps", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(null, {
          status: 204,
        })
      )
    );
    await expect(fetchJson<void>("/api/x")).resolves.toBeUndefined();
  });

  it("retourne le JSON 200 valide", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    await expect(fetchJson<{ ok: boolean }>("/api/x")).resolves.toEqual({
      ok: true,
    });
  });
});

