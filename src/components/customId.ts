/**
 * Select-menu customIds: `lang:<role>:<menuIndex>:<other>:<sourceId>`.
 *
 * - `role` is `s` (pick the source language) or `t` (pick the target).
 * - `other` is the counterpart's current value, so a source pick keeps the
 *   target and a target pick keeps the (possibly forced) source: a backend
 *   code, or `auto` for detection.
 * - Only the source id travels (Discord caps customIds at 100 chars); the
 *   text itself comes back from the cache or a message re-fetch.
 */
const PREFIX = "lang";
const PATTERN = /^lang:([st]):(\d):([a-z]{2,3}|auto):([A-Za-z0-9_]{1,80})$/;

export type SelectRole = "source" | "target";

export const AUTO_VALUE = "auto";

export interface SelectCustomId {
  readonly role: SelectRole;
  readonly menuIndex: number;
  /** The counterpart's current value: a code, or `auto`. */
  readonly other: string;
  readonly sourceId: string;
}

export function buildSelectCustomId(id: SelectCustomId): string {
  const role = id.role === "source" ? "s" : "t";
  return `${PREFIX}:${role}:${id.menuIndex}:${id.other}:${id.sourceId}`;
}

export function parseSelectCustomId(customId: string): SelectCustomId | null {
  const match = PATTERN.exec(customId);
  if (!match) return null;
  return {
    role: match[1] === "s" ? "source" : "target",
    menuIndex: Number(match[2]),
    other: match[3] ?? AUTO_VALUE,
    sourceId: match[4] ?? "",
  };
}

export function isSelectCustomId(customId: string): boolean {
  return customId.startsWith(`${PREFIX}:`);
}
