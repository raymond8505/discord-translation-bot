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
    const file = join(dir, "healthy");
    const heartbeat = startHeartbeat({ isReady: () => true }, { file, intervalMs: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);
    const first = (await stat(file)).mtimeMs;

    heartbeat.stop();
    await rm(file);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
    expect(first).toBeGreaterThan(0);
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
