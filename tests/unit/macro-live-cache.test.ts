import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetMacroLiveCache,
  resolveMacroCalendarToday,
} from "@/app/lib/news/macro-live";

describe("macro-live e2e / rate-limit", () => {
  beforeEach(() => {
    __resetMacroLiveCache();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    __resetMacroLiveCache();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("E2E=1 n’appelle pas l’API externe (évite 429 Playwright)", async () => {
    vi.stubEnv("E2E", "1");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await resolveMacroCalendarToday();
    expect(r.source).toBe("mock");
    expect(r.events.length).toBeGreaterThan(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("PLAYWRIGHT=1 → mock sans fetch", async () => {
    vi.stubEnv("PLAYWRIGHT", "1");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await resolveMacroCalendarToday();
    expect(r.source).toBe("mock");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
