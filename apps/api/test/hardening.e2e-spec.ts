import "reflect-metadata";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  configureApp,
  resolveCorsOrigins,
  resolveListenHost,
} from "../src/app.config";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";
import {
  createTestApplication,
  TEST_SUPER_ADMIN_TOKEN,
} from "./test-application";

let application: INestApplication;
let baseUrl: string;

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication({
    beforeListen: (app) => configureApp(app),
  });
  application = started.application;
  baseUrl = started.baseUrl;
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("listen host and CORS origins come from the environment", () => {
  assert.equal(resolveListenHost({}), "127.0.0.1");
  assert.equal(resolveListenHost({ API_HOST: "0.0.0.0" }), "0.0.0.0");
  assert.deepEqual(resolveCorsOrigins({}), ["http://127.0.0.1:3002"]);
  assert.deepEqual(
    resolveCorsOrigins({
      WEB_ORIGIN: "https://ignored.example",
      CORS_ORIGINS: "https://a.example, https://b.example",
    }),
    ["https://a.example", "https://b.example"],
  );
});

test("responses carry security headers and no framework banner", async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.ok(response.headers.get("strict-transport-security"));
  assert.equal(response.headers.get("x-powered-by"), null);
});

test("CORS only allows the configured origin", async () => {
  const allowed = await fetch(`${baseUrl}/api/health`, {
    headers: { origin: "http://127.0.0.1:3002" },
  });
  assert.equal(
    allowed.headers.get("access-control-allow-origin"),
    "http://127.0.0.1:3002",
  );
  const denied = await fetch(`${baseUrl}/api/health`, {
    headers: { origin: "https://evil.example" },
  });
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
});

test("auth routes are rate limited per client", async () => {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 35; attempt += 1) {
    statuses.push(
      (await fetch(`${baseUrl}/api/v1/auth/bootstrap-status`)).status,
    );
  }
  assert.equal(
    statuses.slice(0, 30).every((status) => status === 200),
    true,
  );
  assert.equal(
    statuses.slice(30).every((status) => status === 429),
    true,
  );
});

test("with CLIENT_IP_HEADER set, each visitor address has its own limit", async () => {
  process.env.CLIENT_IP_HEADER = "cf-connecting-ip";
  try {
    const call = async (address: string) =>
      (
        await fetch(`${baseUrl}/api/v1/auth/bootstrap-status`, {
          headers: { "cf-connecting-ip": address },
        })
      ).status;
    const first: number[] = [];
    for (let attempt = 0; attempt < 32; attempt += 1) {
      first.push(await call("203.0.113.1"));
    }
    assert.equal(
      first.slice(0, 30).every((status) => status === 200),
      true,
    );
    assert.equal(
      first.slice(30).every((status) => status === 429),
      true,
    );
    // A different visitor behind the same front door is not affected.
    assert.equal(await call("203.0.113.2"), 200);
  } finally {
    delete process.env.CLIENT_IP_HEADER;
  }
});

test("the session lookup is not held to the 30-a-minute auth limit", async () => {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    statuses.push(
      (
        await fetch(`${baseUrl}/api/v1/auth/session`, {
          headers: { authorization: `Bearer ${TEST_SUPER_ADMIN_TOKEN}` },
        })
      ).status,
    );
  }
  assert.equal(
    statuses.every((status) => status === 200),
    true,
  );
});

test("malformed JSON bodies are client errors, not server errors", async () => {
  for (const body of ["{bad", "null", '"text"']) {
    const response = await fetch(`${baseUrl}/api/v1/customers`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-super-admin-token",
        "content-type": "application/json",
      },
      body,
    });
    assert.equal(response.status, 400, body);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      "Malformed request body",
    );
  }
});
