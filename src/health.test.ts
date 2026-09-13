import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeRecordingLogger } from "./fixtures/context.fixture.js";
import { startHeartbeat } from "./health.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dtb-health-"));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

describe("startHeartbeat", () => {
  it("touches the file on beat only while the source is ready", async () => {
    const file = join(dir, "healthy");
    let ready = false;
    const heartbeat = startHeartbeat({ isReady: () => ready }, { file, intervalMs: 60_000 });

    await heartbeat.beat();
    await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });

    ready = true;
    await heartbeat.beat();
    await expect(stat(file)).resolves.toBeTruthy();

    heartbeat.stop();
  });

  it("beats on its interval and stops cleanly", async () => {
    vi.useFakeTimers();
    const touched: string[] = [];
    const heartbeat = startHeartbeat(
      { isReady: () => true },
      { file: "healthy", intervalMs: 1_000, touch: async (file) => void touched.push(file) },
    );

    await vi.advanceTimersByTimeAsync(2_500);
    expect(touched).toEqual(["healthy", "healthy"]);

    heartbeat.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(touched).toHaveLength(2);
  });

  it("logs and keeps going when the file cannot be written", async () => {
    const logger = makeRecordingLogger();
    const heartbeat = startHeartbeat(
      { isReady: () => true },
      { file: join(dir, "missing-dir", "healthy"), intervalMs: 60_000, logger },
    );

    await expect(heartbeat.beat()).resolves.toBeUndefined();

    expect(logger.entries[0]).toMatchObject({ level: "error" });
    heartbeat.stop();
  });
});
