type Level = "info" | "warn" | "error";

function write(level: Level, message: string, meta?: unknown): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}`;
  if (meta === undefined) {
    console[level](line);
  } else {
    console[level](line, meta);
  }
}

export const log = {
  info: (message: string, meta?: unknown) => write("info", message, meta),
  warn: (message: string, meta?: unknown) => write("warn", message, meta),
  error: (message: string, meta?: unknown) => write("error", message, meta),
};

export type Logger = typeof log;
