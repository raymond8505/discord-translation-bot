import type { CacheEntry } from "../cache.js";

export const cacheEntry: CacheEntry = {
  text: "Hello, how are you?",
  backend: "libretranslate",
  source_lang: "es",
  created_at: "2026-09-12T12:00:00.000Z",
};

export function makeCacheEntry(overrides: Partial<CacheEntry> = {}): CacheEntry {
  return { ...cacheEntry, ...overrides };
}
