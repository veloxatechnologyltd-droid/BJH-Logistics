// Applies pending supabase/migrations/ to the hosted (production) database.
// Run by a person, never from an agent session or a host build:
//   corepack pnpm db:migrate:production
// Reads DATABASE_URL from .env. Host names are resolved over HTTPS because the
// local resolver can hang on IPv6 lookups and time the connection out.
// TLS is always required (sslmode=require).
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";

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

function push(extraArgs) {
  const result = spawnSync(
    "corepack",
    [
      "pnpm",
      "exec",
      "supabase",
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
