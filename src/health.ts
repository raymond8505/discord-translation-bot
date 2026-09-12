import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { log, type Logger } from "./log.js";

/**
 * The bot has no HTTP port, so liveness is a file whose mtime the Docker
 * HEALTHCHECK compares against the clock. `/tmp/<name>` inside the container.
 */
export const HEALTH_FILE_NAME = "discord-translation-bot.healthy";
export const HEALTH_FILE = join(tmpdir(), HEALTH_FILE_NAME);
export const HEARTBEAT_INTERVAL_MS = 30_000;

export interface HeartbeatSource {
  /** discord.js `Client#isReady()`: true only while the gateway session is up. */
  isReady(): boolean;
}

export interface HeartbeatOptions {
  file?: string;
  intervalMs?: number;
  logger?: Logger;
}

export interface Heartbeat {
  /** Touches the file now if the source is ready. */
  beat(): Promise<void>;
  stop(): void;
}

export function startHeartbeat(source: HeartbeatSource, options: HeartbeatOptions = {}): Heartbeat {
  const file = options.file ?? HEALTH_FILE;
  const logger = options.logger ?? log;

  const beat = async (): Promise<void> => {
    if (!source.isReady()) return;
    try {
      await writeFile(file, new Date().toISOString());
    } catch (err) {
      logger.error(`could not write health file ${file}`, err);
    }
  };

  const timer = setInterval(() => void beat(), options.intervalMs ?? HEARTBEAT_INTERVAL_MS);
  timer.unref();

  return {
    beat,
    stop: () => clearInterval(timer),
  };
}
