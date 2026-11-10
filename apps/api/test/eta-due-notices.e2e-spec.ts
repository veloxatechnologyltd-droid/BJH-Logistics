import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
} from "./test-application";
import { ETA_NOTICE_WITHIN_DAYS } from "../src/notifications/notification-dispatcher.service";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let database: DatabasePort;
let companyId: string;

type Notice = {
  id: string;
  kind: string;
  jobId: string | null;
  title: string;
  note: string | null;
};
type Job = { id: string; fileNumber: string; etdAt: string | null };

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const send = (method: string, path: string, token: string, body?: unknown) =>
  call(path, token, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function openJob(): Promise<Job> {
  const response = await send("POST", "/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine: "sea_import",
  });
  assert.equal(response.status, 201);
  return (await response.json()) as Job;
}

const hoursFromNow = (hours: number) =>
  new Date(Date.now() + hours * 3_600_000).toISOString();

const setEta = (jobId: string, etaAt: string) =>
  send("POST", `/api/v1/jobs/${jobId}/eta`, TEST_SUPER_ADMIN_TOKEN, {
    etaAt,
    source: "Carrier notice",
  });

async function etaNotices(token: string): Promise<Notice[]> {
  const body = (await (
    await call("/api/v1/staff-notifications", token)
  ).json()) as {
    due: Notice[];
  };
  return body.due.filter((notice) => notice.kind === "eta_due");
}

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "export_rep",
    TEST_SUPER_ADMIN_ID,
  );
  companyId = randomUUID();
  await database.createCustomer({
    id: companyId,
    companyName: "Northstar Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  await database.grantCustomerMembership(
    companyId,
    TEST_CUSTOMER_A_ID,
    TEST_SUPER_ADMIN_ID,
  );
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("staff record, change and clear an ETD; bad values and other lines are refused", async () => {
  const job = await openJob();
  assert.equal(job.etdAt, null);

  const saved = await send(
    "PUT",
    `/api/v1/jobs/${job.id}/etd`,
    TEST_MATCHING_TOKEN,
    { etdAt: "2026-11-20T08:30:00Z" },
  );
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal(((await saved.json()) as Job).etdAt, "2026-11-20T08:30:00.000Z");

  const read = await call(`/api/v1/jobs/${job.id}`, TEST_MATCHING_TOKEN);
  assert.equal(((await read.json()) as Job).etdAt, "2026-11-20T08:30:00.000Z");

  const cleared = await send(
    "PUT",
    `/api/v1/jobs/${job.id}/etd`,
    TEST_MATCHING_TOKEN,
    { etdAt: "" },
  );
  assert.equal(((await cleared.json()) as Job).etdAt, null);

  const bad = await send(
    "PUT",
    `/api/v1/jobs/${job.id}/etd`,
    TEST_MATCHING_TOKEN,
    { etdAt: "tomorrow-ish" },
  );
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /etdAt must be a date and time/);

  // An export rep does not work sea import jobs; a customer is not staff.
  for (const token of [TEST_UNASSIGNED_TOKEN, TEST_CUSTOMER_A_TOKEN]) {
    const refused = await send("PUT", `/api/v1/jobs/${job.id}/etd`, token, {
      etdAt: "2026-11-20T08:30:00Z",
    });
    assert.ok([403, 404].includes(refused.status), String(refused.status));
  }
  const unchanged = await call(`/api/v1/jobs/${job.id}`, TEST_MATCHING_TOKEN);
  assert.equal(((await unchanged.json()) as Job).etdAt, null);
});

test("a passed ETA notifies the people on the job once, until they dismiss it", async () => {
  const unassigned = await openJob();
  const led = await openJob();
  const future = await openJob();
  await database.assignJob(led.id, {
    userId: TEST_MATCHING_USER_ID,
    kind: "lead",
    assignedBy: TEST_SUPER_ADMIN_ID,
    overrideReason: "test",
  });
  for (const [job, at] of [
    [unassigned, hoursFromNow(-2)],
    [led, hoursFromNow(-1)],
    [future, hoursFromNow(48)],
  ] as const) {
    assert.equal((await setEta(job.id, at)).status, 201);
  }

  // One for the lead of one job and one for the super admin on the job nobody leads.
  assert.equal(await database.raiseEtaDueNotices(ETA_NOTICE_WITHIN_DAYS), 2);
  assert.equal(await database.raiseEtaDueNotices(ETA_NOTICE_WITHIN_DAYS), 0);

  const admin = await etaNotices(TEST_SUPER_ADMIN_TOKEN);
  assert.deepEqual(
    admin.map((notice) => notice.jobId),
    [unassigned.id],
  );
  assert.equal(
    admin[0].title,
    `Job ${unassigned.fileNumber} has reached its ETA`,
  );
  assert.match(admin[0].note ?? "", /Check whether the shipment has arrived/);
  const rep = await etaNotices(TEST_MATCHING_TOKEN);
  assert.deepEqual(
    rep.map((notice) => notice.jobId),
    [led.id],
  );
  // Nobody else is told, and the job whose ETA is still ahead raises nothing.
  assert.deepEqual(await etaNotices(TEST_UNASSIGNED_TOKEN), []);

  // It stays until dismissed (a later check still lists it) and then never returns.
  assert.equal((await etaNotices(TEST_MATCHING_TOKEN)).length, 1);
  const dismissed = await send(
    "POST",
    `/api/v1/staff-notifications/${rep[0].id}/dismiss`,
    TEST_MATCHING_TOKEN,
  );
  assert.equal(dismissed.status, 201);
  assert.deepEqual(await etaNotices(TEST_MATCHING_TOKEN), []);
  assert.equal(await database.raiseEtaDueNotices(ETA_NOTICE_WITHIN_DAYS), 0);
  assert.deepEqual(await etaNotices(TEST_MATCHING_TOKEN), []);
});

test("a new ETA withdraws the old notice, and a passed new ETA raises a fresh one", async () => {
  const job = await openJob();
  await setEta(job.id, hoursFromNow(-3));
  await database.raiseEtaDueNotices(ETA_NOTICE_WITHIN_DAYS);
  assert.ok(
    (await etaNotices(TEST_SUPER_ADMIN_TOKEN)).some((n) => n.jobId === job.id),
  );

  // The ETA moves a day ahead: the notice no longer applies.
  await setEta(job.id, hoursFromNow(24));
  await database.raiseEtaDueNotices(ETA_NOTICE_WITHIN_DAYS);
  assert.ok(
    !(await etaNotices(TEST_SUPER_ADMIN_TOKEN)).some((n) => n.jobId === job.id),
  );

  // That ETA passes too: a new notice.
  await setEta(job.id, hoursFromNow(-1));
  assert.equal(await database.raiseEtaDueNotices(ETA_NOTICE_WITHIN_DAYS), 1);
  assert.ok(
    (await etaNotices(TEST_SUPER_ADMIN_TOKEN)).some((n) => n.jobId === job.id),
  );
});

test("an ETA that passed long ago raises no notice", async () => {
  const job = await openJob();
  await setEta(job.id, hoursFromNow(-24 * (ETA_NOTICE_WITHIN_DAYS + 3)));
  assert.equal(await database.raiseEtaDueNotices(ETA_NOTICE_WITHIN_DAYS), 0);
  assert.ok(
    !(await etaNotices(TEST_SUPER_ADMIN_TOKEN)).some((n) => n.jobId === job.id),
  );
});
