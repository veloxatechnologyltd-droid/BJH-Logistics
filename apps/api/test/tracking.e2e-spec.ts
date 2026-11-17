import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let companyId: string;
let jobId: string;
let trackingNumber: string;

function staff(path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${TEST_MATCHING_TOKEN}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** No sign-in header: this is what a visitor on the public site sends. */
function track(value: string) {
  return fetch(`${baseUrl}/api/v1/track/${encodeURIComponent(value)}`);
}

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  companyId = randomUUID();
  await database.createCustomer({
    id: companyId,
    companyName: "Northstar Tracking Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  const opened = await fetch(`${baseUrl}/api/v1/jobs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TEST_SUPER_ADMIN_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      customerCompanyId: companyId,
      serviceLine: "sea_import",
    }),
  });
  const job = (await opened.json()) as {
    id: string;
    trackingNumber: string;
  };
  jobId = job.id;
  trackingNumber = job.trackingNumber;
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("a new job gets a tracking number and the customer is messaged it once", async () => {
  assert.match(trackingNumber, /^BJH-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  const database = application.get(DatabasePort);
  const messages = (await database.listJobNotifications(jobId)).filter(
    (item) => item.event === "job_opened",
  );
  assert.equal(messages.length, 1);
  assert.ok(messages[0].subject.includes(trackingNumber));
  assert.ok(messages[0].body.includes(trackingNumber));
  assert.ok(messages[0].smsText.includes(trackingNumber));
  assert.ok(
    messages[0].smsText.endsWith(
      `Track it on our website: http://127.0.0.1:3003/track/${trackingNumber}`,
    ),
  );
  assert.equal(
    messages[0].linkUrl,
    `http://127.0.0.1:3003/track/${trackingNumber}`,
  );
});

test("anyone holding the number sees only status, steps and ETA, with no sign-in", async () => {
  const response = await track(trackingNumber);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(
    response.headers.get("cross-origin-resource-policy"),
    "cross-origin",
  );
  const body = (await response.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), [
    "etaAt",
    "openedAt",
    "service",
    "status",
    "steps",
    "trackingNumber",
  ]);
  assert.equal(body.service, "Sea import");
  assert.equal(body.status, "In progress");
  assert.equal(body.etaAt, null);
  const text = JSON.stringify(body);
  for (const secret of [
    "Northstar",
    companyId,
    jobId,
    "BJH/SI/",
    "customer_invoice",
  ]) {
    assert.ok(!text.includes(secret), `public view leaked ${secret}`);
  }
  const steps = body.steps as Array<{ text: string; done: boolean }>;
  assert.deepEqual(
    steps.map((step) => step.text),
    [
      "Your cargo has arrived at the port",
      "Customs has released your cargo",
      "Your cargo has been delivered",
    ],
  );
  assert.ok(steps.every((step) => !step.done));
});

test("a typed number is accepted in any case, with spaces or without dashes", async () => {
  const compact = trackingNumber.replace(/-/g, "");
  for (const typed of [
    trackingNumber.toLowerCase(),
    compact,
    compact.slice(3),
    `${compact.slice(0, 7)} ${compact.slice(7)}`,
    ` ${trackingNumber} `,
  ]) {
    const response = await track(typed);
    assert.equal(response.status, 200, typed);
    assert.equal(
      ((await response.json()) as { trackingNumber: string }).trackingNumber,
      trackingNumber,
    );
  }
});

test("an unknown, malformed or file number gets the same 404", async () => {
  const answers = await Promise.all(
    [
      "BJH-2222-2222",
      "nonsense",
      "BJH-0O1I-LLLL",
      "BJH%2FSI%2F2026%2F0001",
      "x".repeat(200),
    ].map(async (value) => {
      const response = await track(value);
      return [response.status, await response.text()] as const;
    }),
  );
  for (const answer of answers) assert.deepEqual(answer, answers[0]);
  assert.equal(answers[0][0], 404);
});

test("recorded steps and the newest ETA show, staff notes and corrections stay private", async () => {
  const arrived = await staff(`/api/v1/jobs/${jobId}/milestones`, {
    milestoneKey: "cargo_arrived",
    occurredAt: "2026-10-05T08:00:00Z",
    note: "INTERNAL: container held for inspection",
  });
  assert.equal(arrived.status, 201);
  const internal = await staff(`/api/v1/jobs/${jobId}/milestones`, {
    milestoneKey: "duties_assessed",
    note: "INTERNAL: duty is high",
  });
  assert.equal(internal.status, 201);
  await staff(`/api/v1/jobs/${jobId}/eta`, {
    etaAt: "2026-10-05T06:00:00Z",
    source: "INTERNAL carrier notice",
  });
  await staff(`/api/v1/jobs/${jobId}/eta`, {
    etaAt: "2026-10-09T06:00:00Z",
    source: "INTERNAL delay notice",
  });

  const body = (await (await track(trackingNumber)).json()) as {
    etaAt: string;
    steps: Array<{ text: string; done: boolean; occurredAt: string | null }>;
  };
  assert.equal(body.etaAt, "2026-10-09T06:00:00.000Z");
  assert.deepEqual(body.steps[0], {
    text: "Your cargo has arrived at the port",
    done: true,
    occurredAt: "2026-10-05T08:00:00.000Z",
  });
  assert.equal(body.steps[1].done, false);
  assert.ok(!JSON.stringify(body).includes("INTERNAL"));
  assert.ok(!JSON.stringify(body).includes("duty"));
});

test("a closed job shows as completed", async () => {
  const setStatus = (status: string, reason: string) =>
    fetch(`${baseUrl}/api/v1/jobs/${jobId}/status`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_SUPER_ADMIN_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ status, reason }),
    });
  const read = async () =>
    ((await (await track(trackingNumber)).json()) as { status: string }).status;

  assert.equal(
    (await setStatus("on_hold", "Waiting for documents")).status,
    201,
  );
  assert.equal(await read(), "On hold");
  assert.equal(
    (await setStatus("in_progress", "Documents arrived")).status,
    201,
  );
  assert.equal(
    (await setStatus("closed", "Synthetic closure for the test")).status,
    201,
  );
  assert.equal(await read(), "Completed");
});

test("guessing is limited per visitor address", async () => {
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    statuses.push((await track("BJH-3333-3333")).status);
  }
  assert.ok(statuses.includes(429), "a burst of lookups is throttled");
  assert.equal(statuses[0], 404);
});
