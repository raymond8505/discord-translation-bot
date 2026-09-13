import { spawn } from "node:child_process";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { placeholdersOf, protect, restore } from "../src/i18n/segments.js";
import { menuLanguages } from "../src/locale.js";
import { log } from "../src/log.js";

// Fills src/i18n/messages/<code>.json from en.json through the LibreTranslate
// the compose stack runs. Nothing publishes LibreTranslate's port, so each
// request runs as a small program inside the bot container (the same route
// `yarn docker:languages` takes); the program is written to node's stdin and
// carries its payload inline, since stdin is the program itself.
//
//   yarn locales:generate              fill missing keys/files, keep hand edits
//   yarn locales:generate --force      retranslate every key
//   yarn locales:generate --only fr,de limit to these backend codes
//   yarn locales:generate --check      no docker: report missing/stale keys, exit 1 if any missing

const MESSAGES_DIR = path.resolve("src/i18n/messages");
const SOURCE = "en";
const BATCH = 25;

type Table = Record<string, string>;

interface Args {
  readonly force: boolean;
  readonly check: boolean;
  readonly only: ReadonlySet<string> | null;
}

function parseArgs(argv: readonly string[]): Args {
  let only: Set<string> | null = null;
  const onlyIndex = argv.indexOf("--only");
  if (onlyIndex !== -1) {
    const list = argv[onlyIndex + 1];
    if (!list || list.startsWith("--")) throw new Error("--only needs a comma-separated list of codes");
    only = new Set(list.split(",").map((code) => code.trim()).filter(Boolean));
  }
  return { force: argv.includes("--force"), check: argv.includes("--check"), only };
}

function messageFile(code: string): string {
  return path.join(MESSAGES_DIR, `${code}.json`);
}

async function readTable(code: string): Promise<Table | null> {
  try {
    return JSON.parse(await readFile(messageFile(code), "utf8")) as Table;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function writeTable(code: string, table: Table): Promise<void> {
  await writeFile(messageFile(code), `${JSON.stringify(table, null, 2)}\n`, "utf8");
}

async function tableCodesOnDisk(): Promise<string[]> {
  const files = await readdir(MESSAGES_DIR);
  return files
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort((a, b) => (a === SOURCE ? -1 : b === SOURCE ? 1 : a.localeCompare(b, "en")));
}

type WorkerInput =
  | { readonly kind: "languages" }
  | { readonly kind: "translate"; readonly target: string; readonly batches: readonly (readonly string[])[] };

// Plain JS for the container's node: no imports, LT_URL from the bot's env_file.
function workerProgram(input: WorkerInput): string {
  return `
const input = ${JSON.stringify(input)};
const base = (process.env.LT_URL ?? "http://libretranslate:5000").replace(/\\/+$/, "");
async function call(path, init) {
  const res = await fetch(base + path, init);
  if (!res.ok) throw new Error(path + " responded " + res.status + ": " + (await res.text()));
  return res.json();
}
if (input.kind === "languages") {
  process.stdout.write(JSON.stringify(await call("/languages")));
} else {
  const out = [];
  for (const batch of input.batches) {
    const body = await call("/translate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: batch, source: "${SOURCE}", target: input.target, format: "text" }),
    });
    out.push(...body.translatedText);
  }
  process.stdout.write(JSON.stringify(out));
}
`;
}

function runWorker(input: WorkerInput): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "exec", "-T", "bot", "node", "--input-type=module", "-"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`worker exited ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`worker printed non-JSON: ${stdout.slice(0, 200)}`));
      }
    });
    child.stdin.end(workerProgram(input));
  });
}

interface LibreLanguage {
  readonly code: string;
  readonly targets: readonly string[];
}

async function fetchLanguages(): Promise<LibreLanguage[]> {
  const body = await runWorker({ kind: "languages" });
  if (!Array.isArray(body)) throw new Error("/languages did not return a list");
  return body.map((entry: { code?: unknown; targets?: unknown }) => {
    if (typeof entry.code !== "string" || !Array.isArray(entry.targets)) {
      throw new Error("/languages entry is missing code or targets");
    }
    return { code: entry.code, targets: entry.targets.filter((t): t is string => typeof t === "string") };
  });
}

async function translateBatch(target: string, texts: readonly string[]): Promise<string[]> {
  const batches: string[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) batches.push(texts.slice(i, i + BATCH));
  const body = await runWorker({ kind: "translate", target, batches });
  if (!Array.isArray(body) || body.length !== texts.length || !body.every((t) => typeof t === "string")) {
    throw new Error(`/translate returned ${Array.isArray(body) ? body.length : "no"} texts for ${texts.length}`);
  }
  return body;
}

interface LanguageReport {
  readonly translated: string[];
  readonly keptEnglish: string[];
  readonly dropped: string[];
}

async function generateLanguage(target: string, en: Table, args: Args): Promise<LanguageReport | null> {
  const existing = (await readTable(target)) ?? {};
  const enKeys = Object.keys(en);
  const todo = enKeys.filter((key) => args.force || !(key in existing));
  const dropped = Object.keys(existing).filter((key) => !(key in en));
  if (todo.length === 0 && dropped.length === 0) return null;

  const shielded = todo.map((key) => protect(en[key] ?? ""));
  const translated = todo.length > 0 ? await translateBatch(target, shielded.map((s) => s.text)) : [];

  const next: Table = {};
  const report: LanguageReport = { translated: [], keptEnglish: [], dropped };
  for (const key of enKeys) {
    const index = todo.indexOf(key);
    if (index === -1) {
      next[key] = existing[key] ?? "";
      continue;
    }
    const english = en[key] ?? "";
    const restored = restore((translated[index] ?? "").trim(), shielded[index]?.slots ?? []);
    const intact =
      restored !== null &&
      restored.length > 0 &&
      [...placeholdersOf(restored)].sort().join() === [...placeholdersOf(english)].sort().join();
    next[key] = intact ? restored : english;
    (intact ? report.translated : report.keptEnglish).push(key);
  }
  await writeTable(target, next);
  return report;
}

function identifierFor(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, "");
}

async function writeIndex(codes: readonly string[]): Promise<void> {
  const imports = codes.map((code) => `import ${identifierFor(code)} from "./${code}.json" with { type: "json" };`);
  const entries = codes.map((code) => (/^[A-Za-z0-9]+$/.test(code) ? code : `"${code}": ${identifierFor(code)}`));
  const content = [
    "// Generated by scripts/generate-locales.ts; run `yarn locales:generate` rather than editing.",
    ...imports,
    "",
    "/** Every message key, with the English wording as the type's source of truth. */",
    "export type Messages = typeof en;",
    "",
    `export const messages = { ${entries.join(", ")} } satisfies Record<string, Partial<Messages>>;`,
    "",
  ].join("\n");
  const file = path.join(MESSAGES_DIR, "index.ts");
  const current = await readFile(file, "utf8").catch(() => "");
  if (current !== content) await writeFile(file, content, "utf8");
}

async function check(en: Table): Promise<number> {
  let missingTotal = 0;
  for (const code of await tableCodesOnDisk()) {
    if (code === SOURCE) continue;
    const table = (await readTable(code)) ?? {};
    const missing = Object.keys(en).filter((key) => !(key in table));
    const stale = Object.keys(table).filter((key) => !(key in en));
    missingTotal += missing.length;
    log.info(`${code}: ${missing.length} missing, ${stale.length} stale${missing.length ? ` — missing: ${missing.join(", ")}` : ""}`);
  }
  return missingTotal;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const en = await readTable(SOURCE);
  if (!en) throw new Error(`${messageFile(SOURCE)} is missing`);

  if (args.check) {
    const missing = await check(en);
    if (missing > 0) process.exitCode = 1;
    return;
  }

  const languages = await fetchLanguages();
  const supported = new Set(languages.map((l) => l.code));
  const fromEnglish = new Set(languages.find((l) => l.code === SOURCE)?.targets ?? []);
  const wanted = menuLanguages(supported)
    .map((l) => l.code)
    .filter((code) => code !== SOURCE && (!args.only || args.only.has(code)));
  const targets = wanted.filter((code) => fromEnglish.has(code));
  const unreachable = wanted.filter((code) => !fromEnglish.has(code));
  if (unreachable.length) log.warn(`LibreTranslate cannot translate en → ${unreachable.join(", ")}; skipped`);
  if (args.only) {
    const unknown = [...args.only].filter((code) => !supported.has(code));
    if (unknown.length) log.warn(`not reported by LibreTranslate: ${unknown.join(", ")}; skipped`);
  }

  for (const target of targets) {
    const report = await generateLanguage(target, en, args);
    if (!report) {
      log.info(`${target}: up to date`);
      continue;
    }
    const parts = [`${report.translated.length} translated`];
    if (report.keptEnglish.length) parts.push(`kept English (fix by hand): ${report.keptEnglish.join(", ")}`);
    if (report.dropped.length) parts.push(`dropped stale: ${report.dropped.join(", ")}`);
    log.info(`${target}: ${parts.join("; ")}`);
  }

  await writeIndex(await tableCodesOnDisk());
}

main().catch((err: unknown) => {
  log.error("locale generation failed", err);
  process.exit(1);
});
