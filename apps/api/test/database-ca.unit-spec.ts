import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDatabaseCa } from "../src/database/database.module";

const PEM = "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----";

function recordingLogger() {
  const lines: string[] = [];
  return {
    lines,
    log: (message: string) => lines.push(`log: ${message}`),
    error: (message: string) => lines.push(`error: ${message}`),
  };
}

test("the certificate text in DATABASE_SSL_CA wins over the file", () => {
  const logger = recordingLogger();
  const ca = resolveDatabaseCa(
    logger,
    { DATABASE_SSL_CA: ` ${PEM} `, DATABASE_SSL_CA_PATH: "/etc/secrets/x.crt" },
    () => {
      throw new Error("the file must not be read");
    },
  );
  assert.equal(ca, PEM);
  assert.deepEqual(logger.lines, [
    "log: Supabase root certificate loaded from DATABASE_SSL_CA",
  ]);
});

test("escaped newlines in DATABASE_SSL_CA become real newlines", () => {
  const ca = resolveDatabaseCa(recordingLogger(), {
    DATABASE_SSL_CA: PEM.replace(/\n/g, "\\n"),
  });
  assert.equal(ca, PEM);
});

test("without the variable the file at DATABASE_SSL_CA_PATH is read", () => {
  const logger = recordingLogger();
  const ca = resolveDatabaseCa(
    logger,
    { DATABASE_SSL_CA_PATH: "/etc/secrets/supabase-root.crt" },
    (path) => {
      assert.equal(path, "/etc/secrets/supabase-root.crt");
      return PEM;
    },
  );
  assert.equal(ca, PEM);
  assert.match(logger.lines[0], /^log: .*\/etc\/secrets\/supabase-root\.crt$/);
});

test("a missing file is logged with its path and no certificate is returned", () => {
  const logger = recordingLogger();
  const ca = resolveDatabaseCa(
    logger,
    { DATABASE_SSL_CA_PATH: "/etc/secrets/supabase-root.crt" },
    () => {
      throw new Error("ENOENT");
    },
  );
  assert.equal(ca, undefined);
  assert.match(
    logger.lines[0],
    /^error: .*unavailable at \/etc\/secrets\/supabase-root\.crt/,
  );
});
