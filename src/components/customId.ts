/**
 * Select-menu customIds: `lang:<menuIndex>:<sourceId>`. Only the source id
 * travels in the id (Discord caps customIds at 100 chars); the text itself
 * comes back from the cache or a message re-fetch.
 */
const PREFIX = "lang";
const PATTERN = /^lang:(\d):([A-Za-z0-9_]{1,80})$/;

export interface SelectCustomId {
  readonly menuIndex: number;
  readonly sourceId: string;
}

export function buildSelectCustomId(menuIndex: number, sourceId: string): string {
  return `${PREFIX}:${menuIndex}:${sourceId}`;
}

export function parseSelectCustomId(customId: string): SelectCustomId | null {
  const match = PATTERN.exec(customId);
  if (!match) return null;
  return { menuIndex: Number(match[1]), sourceId: match[2] ?? "" };
}

export function isSelectCustomId(customId: string): boolean {
  return customId.startsWith(`${PREFIX}:`);
}
