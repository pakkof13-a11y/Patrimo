import { beforeEach, describe, expect, it } from "vitest";
import { __resetKvMemoryForTests } from "@/app/lib/api/kv-store";
import {
  getCollectionStatus,
  recordCollectionRun,
} from "@/app/lib/ops/collection-status";

const JOB = "test-job";

describe("collection-status", () => {
  beforeEach(() => {
    __resetKvMemoryForTests();
  });

  it("rend « never » quand aucun passage n'a encore écrit", async () => {
    const s = await getCollectionStatus(JOB);
    expect(s).toEqual({ status: "never" });
  });

  it("enregistre un succès et le relit", async () => {
    await recordCollectionRun(JOB, "ok");
    const s = await getCollectionStatus(JOB);
    expect(s.status).toBe("ok");
    if (s.status !== "never") {
      expect(typeof s.at).toBe("string");
      expect(Number.isNaN(Date.parse(s.at))).toBe(false);
      expect(s.message).toBeUndefined();
    }
  });

  it("enregistre un échec avec message et le relit", async () => {
    await recordCollectionRun(JOB, "ko", "fournisseur indisponible");
    const s = await getCollectionStatus(JOB);
    expect(s.status).toBe("ko");
    if (s.status !== "never") {
      expect(s.message).toBe("fournisseur indisponible");
    }
  });

  it("écrase l'état précédent au lieu de l'accumuler", async () => {
    await recordCollectionRun(JOB, "ko", "premier échec");
    await recordCollectionRun(JOB, "ok");
    const s = await getCollectionStatus(JOB);
    expect(s.status).toBe("ok");
  });

  it("tronque un message trop long plutôt que de tout porter", async () => {
    const long = "x".repeat(2000);
    await recordCollectionRun(JOB, "ko", long);
    const s = await getCollectionStatus(JOB);
    if (s.status === "ko") {
      expect(s.message?.length).toBeLessThanOrEqual(500);
    }
  });

  it("isole les jobs par clé — deux tâches ne se marchent pas dessus", async () => {
    await recordCollectionRun(JOB, "ok");
    await recordCollectionRun("autre-job", "ko", "boom");
    const a = await getCollectionStatus(JOB);
    const b = await getCollectionStatus("autre-job");
    expect(a.status).toBe("ok");
    expect(b.status).toBe("ko");
  });
});
