// Tests the production migration script without any database: a fake
// `corepack` first on PATH records what the script would have run.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts", "migrate-production.mjs");
const migrations = readdirSync(join(root, "supabase", "migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const versionOf = (name) => name.split("_")[0];

function run(
  args,
  input,
  url = "postgresql://u:p@db.example.invalid:5432/postgres",
) {
  const dir = mkdtempSync(join(tmpdir(), "bjh-migrate-test-"));
  const log = join(dir, "calls.log");
  const fake = join(dir, "corepack");
  // Records the arguments, and what the --workdir holds at that moment.
  writeFileSync(
    fake,
    `#!/bin/bash
echo "ARGS $*" >> "${log}"
prev=""
for a in "$@"; do
  if [ "$prev" = "--workdir" ]; then ls "$a/supabase/migrations" | sed 's/^/MIGRATION /' >> "${log}"; echo "WORKDIR $a" >> "${log}"; fi
  prev="$a"
done
exit 0
`,
  );
  chmodSync(fake, 0o755);
  const result = spawnSync("node", [script, ...args], {
    input,
    encoding: "utf8",
    env: {
      PATH: `${dir}:${process.env.PATH}`,
      DATABASE_URL: url,
      HOME: process.env.HOME,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8").split("\n") : [];
  rmSync(dir, { recursive: true, force: true });
  return { ...result, calls };
}

const pushes = (calls) => calls.filter((line) => line.startsWith("ARGS"));

test("without --to every pending migration is pushed from the repository itself", () => {
  const { status, calls } = run([], "apply production\n");
  assert.equal(status, 0);
  assert.equal(pushes(calls).length, 2);
  assert.match(pushes(calls)[0], /db push .*--dry-run/);
  assert.match(pushes(calls)[1], /db push .*--yes/);
  assert.equal(
    calls.some((line) => line.includes("--workdir")),
    false,
  );
});

test("--to pushes only migrations up to that version, from a temporary copy", () => {
  const limit = migrations[migrations.length - 3];
  const wanted = migrations.filter(
    (name) => versionOf(name) <= versionOf(limit),
  );
  const { status, stdout, calls } = run(
    ["--to", versionOf(limit)],
    "apply production\n",
  );
  assert.equal(status, 0);
  assert.match(
    stdout,
    new RegExp(`Limited to migrations up to ${versionOf(limit)}`),
  );
  assert.equal(pushes(calls).length, 2);
  for (const line of pushes(calls)) assert.match(line, /--workdir \S+/);
  const listed = calls
    .filter((line) => line.startsWith("MIGRATION "))
    .map((line) => line.slice("MIGRATION ".length));
  // The dry run and the real push each saw exactly the wanted files.
  assert.deepEqual(listed, [...wanted, ...wanted]);
  assert.equal(listed.includes(migrations[migrations.length - 1]), false);
  // The temporary copy is removed afterwards.
  const workdir = calls.find((line) => line.startsWith("WORKDIR "))?.slice(8);
  assert.ok(workdir && !existsSync(workdir));
});

test("an answer other than the confirmation applies nothing", () => {
  const { status, calls } = run(["--to", versionOf(migrations[0])], "no\n");
  assert.equal(status, 0);
  assert.equal(pushes(calls).length, 1);
  assert.match(pushes(calls)[0], /--dry-run/);
});

test("a bad or unknown --to version is refused before anything runs", () => {
  for (const args of [["--to"], ["--to", "abc"], ["--to", "20991231235959"]]) {
    const { status, stderr, calls } = run(args, "apply production\n");
    assert.equal(status, 1, args.join(" "));
    assert.match(stderr, /--to takes|No migration has the version/);
    assert.equal(pushes(calls).length, 0);
  }
});

test("a database on this machine is still refused", () => {
  const { status, calls } = run(
    [],
    "apply production\n",
    "postgresql://u:p@127.0.0.1:54322/postgres",
  );
  assert.equal(status, 1);
  assert.equal(pushes(calls).length, 0);
});
