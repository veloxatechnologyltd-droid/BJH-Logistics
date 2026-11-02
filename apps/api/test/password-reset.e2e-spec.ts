import "reflect-metadata";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
} from "./test-application";
import { EMAIL_PROVIDER } from "../src/notifications/providers";
import type { RecordingEmailProvider } from "../src/notifications/providers";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let email: RecordingEmailProvider;

/** Each test is a different visitor, as behind Render, where the header names the visitor. */
const ask = (body: unknown, visitor = "203.0.113.1") =>
  fetch(`${baseUrl}/api/v1/auth/password-reset`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-ip": visitor },
    body: JSON.stringify(body),
  });

/** The email is sent after the reply, so give it a moment to arrive. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

before(async () => {
  process.env.CLIENT_IP_HEADER = "x-test-ip";
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  email = application.get(EMAIL_PROVIDER);
});

after(async () => {
  delete process.env.CLIENT_IP_HEADER;
  await application.close();
  await endTestDatabase();
});

test("an account gets its own reset link by email, with no sign-in needed", async () => {
  email.sent.length = 0;
  const response = await ask({ email: "Customer-A@example.test " });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  await settle();
  assert.equal(email.sent.length, 1);
  assert.equal(email.sent[0].to, "customer-a@example.test");
  assert.equal(email.sent[0].subject, "Reset your BJH Logistics password");
  assert.match(
    email.sent[0].text,
    /https:\/\/auth\.test\/verify\?token=50000000-0000-4000-8000-000000000003&redirect_to=http[^\s]*set-password/,
  );
});

test("an unknown address gets the same reply and no email", async () => {
  email.sent.length = 0;
  const response = await ask({ email: "nobody@example.test" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  await settle();
  assert.equal(email.sent.length, 0);
});

test("a suspended account gets the same reply and no email", async () => {
  const suspended = await fetch(
    `${baseUrl}/api/v1/admin/staff/${TEST_UNASSIGNED_USER_ID}/suspend`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_SUPER_ADMIN_TOKEN}` },
    },
  );
  assert.equal(suspended.status, 201);
  email.sent.length = 0;
  const response = await ask({ email: "staff@example.test" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  await settle();
  assert.equal(email.sent.length, 0);
});

test("the same address cannot be mailed again within a minute", async () => {
  email.sent.length = 0;
  const twice = { email: "air-import@example.test" };
  assert.equal((await ask(twice, "203.0.113.2")).status, 200);
  assert.equal((await ask(twice, "203.0.113.3")).status, 200);
  await settle();
  assert.equal(email.sent.length, 1);
});

test("a missing or invalid address is refused", async () => {
  for (const body of [{}, { email: "not-an-address" }, { email: 42 }]) {
    assert.equal((await ask(body, "203.0.113.4")).status, 400);
  }
});

test("a visitor is limited to five requests a minute", async () => {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 7; attempt += 1) {
    statuses.push(
      (await ask({ email: "nobody@example.test" }, "203.0.113.5")).status,
    );
  }
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429]);
});
