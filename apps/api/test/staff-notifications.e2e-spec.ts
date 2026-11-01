import "reflect-metadata";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { StaffNotificationsService } from "../src/notifications/staff-notifications.service";
import {
  beginTestDatabase,
  endTestDatabase,
  testPostgresPool,
} from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let waitingId: string;
let freshId: string;

type Notice = { id: string; kind: string; title: string; dueAt: string };
type Notices = { due: Notice[]; upcoming: Notice[] };

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown = {}) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });
const notices = async (token = TEST_UNASSIGNED_TOKEN) =>
  (await (await call("/api/v1/staff-notifications", token)).json()) as Notices;

async function request(companyName: string): Promise<string> {
  const response = await post(
    "/api/v1/quote-requests",
    TEST_SUPER_ADMIN_TOKEN,
    {
      companyName,
      contactName: "Ama Synthetic",
      email: "ama@example.test",
      message: "Please quote a 40ft to Tema.",
    },
  );
  return ((await response.json()) as { id: string }).id;
}

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "customer_service_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  waitingId = await request("Waiting Synthetic Ltd");
  freshId = await request("Fresh Synthetic Ltd");
  await testPostgresPool.query(
    `UPDATE app.quote_request SET created_at = now() - interval '3 days'
     WHERE request_id = $1::uuid`,
    [waitingId],
  );
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("customer service is told once about a request with no quote after two days", async () => {
  const service = application.get(StaffNotificationsService);
  assert.equal(await service.raiseOverdue(), 1);
  assert.equal(await service.raiseOverdue(), 0);

  const desk = await notices();
  assert.equal(desk.due.length, 1);
  assert.equal(desk.due[0].kind, "request_overdue");
  assert.equal(
    desk.due[0].title,
    "No quote sent yet for the request from Waiting Synthetic Ltd",
  );
  // Reps are not customer service; they get no overdue notices.
  assert.deepEqual((await notices(TEST_MATCHING_TOKEN)).due, []);
});

test("a reminder waits until its time, then shows; only its owner can act on it", async () => {
  const past = await post(
    `/api/v1/quote-requests/${freshId}/reminders`,
    TEST_UNASSIGNED_TOKEN,
    { remindAt: "2020-01-01T09:00:00Z" },
  );
  assert.equal(past.status, 400);

  const soon = new Date(Date.now() + 60 * 60_000).toISOString();
  const created = await post(
    `/api/v1/quote-requests/${freshId}/reminders`,
    TEST_UNASSIGNED_TOKEN,
    { remindAt: soon, note: "Call them back about the 40ft" },
  );
  assert.equal(created.status, 201, await created.clone().text());
  const reminder = (await created.json()) as Notice;
  assert.equal(
    reminder.title,
    "Attend to the quote request from Fresh Synthetic Ltd",
  );
  assert.deepEqual(
    (await notices()).upcoming.map((item) => item.id),
    [reminder.id],
  );

  // When its time comes it is due, which is what makes the screen pop it up.
  await testPostgresPool.query(
    `UPDATE app.staff_notification SET due_at = now() - interval '1 minute'
     WHERE notification_id = $1::uuid`,
    [reminder.id],
  );
  assert.ok((await notices()).due.some((item) => item.id === reminder.id));

  const notMine = await post(
    `/api/v1/staff-notifications/${reminder.id}/dismiss`,
    TEST_MATCHING_TOKEN,
  );
  assert.equal(notMine.status, 404);

  const snoozed = await post(
    `/api/v1/staff-notifications/${reminder.id}/snooze`,
    TEST_UNASSIGNED_TOKEN,
    { minutes: 30 },
  );
  assert.equal(snoozed.status, 201);
  assert.ok((await notices()).upcoming.some((item) => item.id === reminder.id));

  const dismissed = await post(
    `/api/v1/staff-notifications/${reminder.id}/dismiss`,
    TEST_UNASSIGNED_TOKEN,
  );
  assert.equal(dismissed.status, 201);
  const after = await notices();
  assert.ok(
    ![...after.due, ...after.upcoming].some((item) => item.id === reminder.id),
  );
});

test("bad reminders and snoozes are refused", async () => {
  for (const [path, body, message] of [
    [`/api/v1/quote-requests/${freshId}/reminders`, {}, "remindAt is required"],
    [
      `/api/v1/quote-requests/${freshId}/reminders`,
      { remindAt: "soon" },
      "remindAt must be a date and time",
    ],
  ] as const) {
    const response = await post(path, TEST_UNASSIGNED_TOKEN, body);
    assert.equal(response.status, 400);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      message,
    );
  }
  const missing = await post(
    `/api/v1/quote-requests/00000000-0000-4000-8000-000000000999/reminders`,
    TEST_UNASSIGNED_TOKEN,
    { remindAt: new Date(Date.now() + 60_000).toISOString() },
  );
  assert.equal(missing.status, 404);
});
