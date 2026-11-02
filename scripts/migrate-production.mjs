// Applies pending supabase/migrations/ to the hosted (production) database.
// Run by a person, never from an agent session or a host build:
//   corepack pnpm db:migrate:production
// Reads DATABASE_URL from .env. Host names are resolved over HTTPS because the
// local resolver can hang on IPv6 lookups and time the connection out.
// TLS is always required (sslmode=require).
//
// It applies every pending migration. To release in steps (a migration the
// running API does not yet understand must wait), name the last one to apply:
//   corepack pnpm db:migrate:production --to 20261102000100
// Only migrations up to and including that version are listed and applied.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let limit = null;
const toAt = process.argv.indexOf("--to");
if (toAt !== -1) {
  limit = process.argv[toAt + 1] ?? "";
  if (!/^\d{14}$/.test(limit)) {
    console.error(
      "--to takes a migration version of 14 digits, e.g. 20261102000100.",
    );
    process.exit(1);
  }
}

let url;
try {
  url = new URL(process.env.DATABASE_URL?.trim() ?? "");
} catch {
  console.error(
    "DATABASE_URL in .env is missing or not a valid connection string.",
  );
  process.exit(1);
}
if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
  console.error(
    "DATABASE_URL points at this machine; use pnpm supabase:prepare for local.",
  );
  process.exit(1);
}
url.searchParams.set("sslmode", "require");
const dbUrl = url.toString();

// With --to, push from a temporary copy that holds only the migrations up to
// that version, so the CLI cannot see (and so cannot apply) the later ones.
let workdir = null;
if (limit) {
  const source = join(root, "supabase", "migrations");
  const all = readdirSync(source)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const versionOf = (name) => name.split("_")[0];
  if (!all.some((name) => versionOf(name) === limit)) {
    console.error(`No migration has the version ${limit}.`);
    process.exit(1);
  }
  const chosen = all.filter((name) => versionOf(name) <= limit);
  workdir = mkdtempSync(join(tmpdir(), "bjh-migrate-"));
  mkdirSync(join(workdir, "supabase", "migrations"), { recursive: true });
  const config = join(root, "supabase", "config.toml");
  if (existsSync(config)) {
    copyFileSync(config, join(workdir, "supabase", "config.toml"));
  }
  for (const name of chosen) {
    copyFileSync(
      join(source, name),
      join(workdir, "supabase", "migrations", name),
    );
  }
  console.log(
    `Limited to migrations up to ${limit}: ${chosen.length} of ${all.length}; the later ones are left alone.\n`,
  );
  process.on("exit", () => rmSync(workdir, { recursive: true, force: true }));
}

function push(extraArgs) {
  const result = spawnSync(
    "corepack",
    [
      "pnpm",
      "exec",
      "supabase",
      ...(workdir ? ["--workdir", workdir] : []),
      "db",
      "push",
      "--db-url",
      dbUrl,
      "--skip-vault",
      "--dns-resolver",
      "https",
      ...extraArgs,
    ],
    {
      stdio: "inherit",
      env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: "1" },
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(
  `Target: ${url.username}@${url.hostname}:${url.port || "5432"}${url.pathname}\n`,
);
console.log("Pending migrations (dry run):");
push(["--dry-run"]);

const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question('\nType "apply production" to apply them: ');
rl.close();
if (answer.trim() !== "apply production") {
  console.log("Nothing applied.");
  process.exit(0);
}

push(["--yes"]);
console.log(
  "Done. Applied migrations are recorded in supabase_migrations.schema_migrations.",
);
