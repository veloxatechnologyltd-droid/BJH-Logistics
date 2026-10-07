import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_CUSTOMER_B_ID,
  TEST_CUSTOMER_B_TOKEN,
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { NotificationDispatcher } from "../src/notifications/notification-dispatcher.service";
import { NotificationsService } from "../src/notifications/notifications.service";
import {
  EMAIL_PROVIDER,
  RecordingEmailProvider,
  RecordingSmsProvider,
  SMS_PROVIDER,
} from "../src/notifications/providers";
import {
  beginTestDatabase,
  endTestDatabase,
  testPostgresPool,
} from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let companyA: string;
let companyB: string;
let jobA: string;
let email: RecordingEmailProvider;
let sms: RecordingSmsProvider;
let dispatcher: NotificationDispatcher;

const AMA_PHONE = "+233244058592";

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });
const put = (path: string, token: string, body: unknown) =>
  call(path, token, { method: "PUT", body: JSON.stringify(body) });
const patch = (path: string, token: string, body: unknown) =>
  call(path, token, { method: "PATCH", body: JSON.stringify(body) });
const get = (path: string, token = TEST_MATCHING_TOKEN) => call(path, token);
const json = async <T>(response: Response) => (await response.json()) as T;
const message = async (response: Response) =>
  ((await response.json()) as { message: string }).message;

type Delivery = {
  id: string;
  channel: "email" | "sms";
  contactName: string | null;
  recipient: string | null;
  status: "pending" | "sent" | "failed" | "skipped";
  attempts: number;
  lastError: string | null;
  provider: string | null;
};
type Notice = {
  id: string;
  event: string;
  subject: string;
  body: string;
  smsText: string;
  linkUrl: string | null;
  deliveries: Delivery[];
};

const notices = async (jobId = jobA) =>
  json<Notice[]>(await get(`/api/v1/jobs/${jobId}/notifications`));
const byEvent = async (event: string) =>
  (await notices()).filter((item) => item.event === event);
const summary = (notice: Notice) =>
  notice.deliveries
    .map((item) => `${item.contactName}:${item.channel}:${item.status}`)
    .sort();

function settings(channels?: string) {
  return {
    issuer: { name: "Synthetic Forwarding Ltd" },
    currencies: ["GHS"],
    taxLines: [],
    paymentTermsDays: 30,
    numbering: {
      quotePrefix: "SYN/Q",
      invoicePrefix: "SYN/INV",
      receiptPrefix: "SYN/RCT",
    },
    quoteDefaults: {},
    ...(channels ? { notifications: { channels } } : {}),
  };
}

before(async () => {
  process.env.PUBLIC_WEB_URL = "https://portal.example.test";
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  email = application.get(EMAIL_PROVIDER);
  sms = application.get(SMS_PROVIDER);
  dispatcher = application.get(NotificationDispatcher);
  const database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "sea_import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "air_export_rep",
    TEST_SUPER_ADMIN_ID,
  );
  companyA = randomUUID();
  companyB = randomUUID();
  const now = new Date().toISOString();
  await database.createCustomer({
    id: companyA,
    companyName: "Northstar Synthetic Ltd",
    createdAt: now,
    contacts: [
      {
        id: randomUUID(),
        name: "Ama",
        email: "ama@example.test",
        phone: "024 405 8592",
        notify: true,
        createdAt: now,
      },
      {
        id: randomUUID(),
        name: "Kojo",
        email: "kojo@example.test",
        phone: null,
        notify: true,
        createdAt: now,
      },
      {
        id: randomUUID(),
        name: "Esi",
        email: "esi@example.test",
        phone: "0201234567",
        notify: false,
        createdAt: now,
      },
    ],
  });
  await database.createCustomer({
    id: companyB,
    companyName: "Southwind Synthetic Ltd",
    createdAt: now,
    contacts: [
      {
        id: randomUUID(),
        name: "Yaw",
        email: "yaw@example.test",
        phone: "0501234567",
        notify: true,
        createdAt: now,
      },
    ],
  });
  await database.grantCustomerMembership(
    companyA,
    TEST_CUSTOMER_A_ID,
    TEST_SUPER_ADMIN_ID,
  );
  await database.grantCustomerMembership(
    companyB,
    TEST_CUSTOMER_B_ID,
    TEST_SUPER_ADMIN_ID,
  );
  jobA = (
    await json<{ id: string }>(
      await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
        customerCompanyId: companyA,
        serviceLine: "sea_import",
      }),
    )
  ).id;
});

after(async () => {
  delete process.env.PUBLIC_WEB_URL;
  await application?.close();
  await endTestDatabase();
});

test("a milestone messages every contact by email and SMS, with a link, until the channel is changed", async () => {
  const recorded = await post(
    `/api/v1/jobs/${jobA}/milestones`,
    TEST_MATCHING_TOKEN,
    {
      milestoneKey: "cargo_arrived",
    },
  );
  assert.equal(recorded.status, 201);

  const [notice] = await byEvent("milestone");
  const link = `https://portal.example.test/jobs/${jobA}`;
  assert.equal(notice.linkUrl, link);
  assert.match(notice.subject, /^BJH\/SI\/\d{4}\/\d{4}: /);
  assert.ok(notice.body.includes(`View it here: ${link}`));
  assert.ok(notice.smsText.endsWith(link));
  // Esi has switched notifications off; Kojo has no phone, so his SMS is skipped and shown as such.
  assert.deepEqual(summary(notice), [
    "Ama:email:pending",
    "Ama:sms:pending",
    "Kojo:email:pending",
    "Kojo:sms:skipped",
  ]);
  const skipped = notice.deliveries.find((item) => item.status === "skipped");
  assert.equal(skipped?.lastError, "No phone number for this contact");

  assert.equal(await dispatcher.dispatchDue(), 3);
  assert.deepEqual(email.sent.map((item) => item.to).sort(), [
    "ama@example.test",
    "kojo@example.test",
  ]);
  assert.deepEqual(
    sms.sent.map((item) => item.to),
    [AMA_PHONE],
  );
  assert.ok(sms.sent[0].text.includes(link));
  assert.ok(email.sent[0].text.includes(link));
  const [sent] = await byEvent("milestone");
  assert.deepEqual(summary(sent), [
    "Ama:email:sent",
    "Ama:sms:sent",
    "Kojo:email:sent",
    "Kojo:sms:skipped",
  ]);
  assert.ok(
    sent.deliveries
      .filter((item) => item.status === "sent")
      .every((item) => item.provider === "stub"),
  );
  // Nothing is left to send, so nothing is sent twice.
  assert.equal(await dispatcher.dispatchDue(), 0);
  assert.equal(email.sent.length, 2);
});

test("a correction restates an earlier milestone and is not announced again", async () => {
  const [first] = (await byEvent("milestone")).slice(-1);
  assert.ok(first);
  const milestones = await json<{ events: Array<{ id: string }> }>(
    await get(`/api/v1/jobs/${jobA}/milestones`),
  );
  const correction = await post(
    `/api/v1/jobs/${jobA}/milestones`,
    TEST_MATCHING_TOKEN,
    {
      milestoneKey: "cargo_arrived",
      correctionOf: milestones.events[0].id,
      note: "Time corrected",
    },
  );
  assert.equal(correction.status, 201);
  assert.equal((await byEvent("milestone")).length, 1);
});

test("the super admin chooses email, SMS or both, and every message follows it", async () => {
  const bad = await put(
    "/api/v1/settings",
    TEST_SUPER_ADMIN_TOKEN,
    settings("carrier-pigeon"),
  );
  assert.equal(bad.status, 400);
  assert.equal(
    await message(bad),
    "notification channels must be email, sms or both",
  );
  assert.equal(
    (await put("/api/v1/settings", TEST_MATCHING_TOKEN, settings("sms")))
      .status,
    403,
  );

  assert.equal(
    (await put("/api/v1/settings", TEST_SUPER_ADMIN_TOKEN, settings("sms")))
      .status,
    200,
  );
  await post(`/api/v1/jobs/${jobA}/eta`, TEST_MATCHING_TOKEN, {
    etaAt: "2026-10-05T06:00:00Z",
    source: "shipping line",
  });
  const [smsOnly] = await byEvent("eta");
  assert.deepEqual(summary(smsOnly), ["Ama:sms:pending", "Kojo:sms:skipped"]);
  assert.match(smsOnly.smsText, /5 Oct 2026, 06:00 \(Ghana time\)/);

  assert.equal(
    (await put("/api/v1/settings", TEST_SUPER_ADMIN_TOKEN, settings("email")))
      .status,
    200,
  );
  await post(`/api/v1/jobs/${jobA}/eta`, TEST_MATCHING_TOKEN, {
    etaAt: "2026-10-06T06:00:00Z",
    source: "shipping line",
  });
  const emailOnly = (await byEvent("eta")).find(
    (item) =>
      item.subject.endsWith("updated") &&
      item.deliveries.every((d) => d.channel === "email"),
  );
  assert.deepEqual(summary(emailOnly!), [
    "Ama:email:pending",
    "Kojo:email:pending",
  ]);

  assert.equal(
    (await put("/api/v1/settings", TEST_SUPER_ADMIN_TOKEN, settings("both")))
      .status,
    200,
  );
  const current = await json<{
    current: { settings: { notifications: { channels: string } } };
  }>(await get("/api/v1/settings"));
  assert.equal(current.current.settings.notifications.channels, "both");
  await dispatcher.dispatchDue();
});

test("staff send a message to the client's contacts; it is also logged as correspondence", async () => {
  const path = `/api/v1/jobs/${jobA}/messages`;
  const sentBefore = { email: email.sent.length, sms: sms.sent.length };
  const response = await post(path, TEST_MATCHING_TOKEN, {
    subject: "Documents needed",
    body: "Please send the packing list today.",
  });
  assert.equal(response.status, 201);
  const notice = await json<Notice>(response);
  assert.equal(notice.event, "message");
  assert.deepEqual(summary(notice), [
    "Ama:email:pending",
    "Ama:sms:pending",
    "Kojo:email:pending",
    "Kojo:sms:skipped",
  ]);
  await dispatcher.dispatchDue();
  assert.equal(email.sent.length - sentBefore.email, 2);
  assert.equal(sms.sent.length - sentBefore.sms, 1);
  const lastSms = sms.sent.at(-1)!;
  assert.match(
    lastSms.text,
    /^Synthetic Forwarding Ltd: Please send the packing list today\. https:\/\/portal\.example\.test\/jobs\//,
  );

  const log = await json<
    Array<{
      channel: string;
      direction: string;
      subject: string | null;
      body: string;
    }>
  >(await get(`/api/v1/jobs/${jobA}/correspondence`));
  const entry = log.find((item) => item.subject === "Documents needed");
  assert.equal(entry?.direction, "sent");
  assert.equal(entry?.channel, "email");
  assert.match(entry?.body ?? "", /\(Sent by email and SMS\.\)/);

  const rejected = await post(path, TEST_MATCHING_TOKEN, { subject: "x" });
  assert.equal(rejected.status, 400);
  assert.equal(await message(rejected), "body is required");
  assert.equal(
    (await post(path, TEST_CUSTOMER_A_TOKEN, { body: "x" })).status,
    403,
  );
  assert.equal(
    (await post(path, TEST_UNASSIGNED_TOKEN, { body: "x" })).status,
    404,
  );
  assert.equal(
    (await get(`/api/v1/jobs/${jobA}/notifications`, TEST_CUSTOMER_A_TOKEN))
      .status,
    403,
  );
});

test("a failed delivery backs off, is retried, and can be retried by hand after it gives up", async () => {
  sms.failFor.add(AMA_PHONE);
  const created = await post(
    `/api/v1/jobs/${jobA}/messages`,
    TEST_MATCHING_TOKEN,
    { body: "Test of retries." },
  );
  const notice = await json<Notice>(created);
  const smsDelivery = notice.deliveries.find(
    (item) => item.channel === "sms" && item.status === "pending",
  )!;

  await dispatcher.dispatchDue();
  const [logged] = (
    await json<{ deliveries: Delivery[] }>(
      await get("/api/v1/admin/notifications", TEST_SUPER_ADMIN_TOKEN),
    )
  ).deliveries.filter((item) => item.id === smsDelivery.id);
  assert.equal(logged.status, "pending");
  assert.equal(logged.attempts, 1);
  assert.equal(logged.lastError, "Stub SMS failure");
  // Not due again for a minute: nothing is attempted yet.
  assert.equal(await dispatcher.dispatchDue(), 0);

  const makeDue = () =>
    testPostgresPool.query(
      "UPDATE app.notification_delivery SET next_attempt_at = now() - interval '1 second' WHERE delivery_id = $1::uuid AND status = 'pending'",
      [smsDelivery.id],
    );
  for (let attempt = 2; attempt <= 5; attempt += 1) {
    await makeDue();
    assert.equal(await dispatcher.dispatchDue(), 1, `attempt ${attempt}`);
  }
  const failed = (
    await json<{ deliveries: Delivery[] }>(
      await get(
        "/api/v1/admin/notifications?status=failed",
        TEST_SUPER_ADMIN_TOKEN,
      ),
    )
  ).deliveries;
  assert.deepEqual(
    failed.map((item) => [item.id, item.attempts, item.status]),
    [[smsDelivery.id, 5, "failed"]],
  );
  await makeDue();
  assert.equal(
    await dispatcher.dispatchDue(),
    0,
    "a failed delivery is left alone",
  );

  // A person fixes the cause and retries.
  sms.failFor.clear();
  const retry = await post(
    `/api/v1/admin/notifications/deliveries/${smsDelivery.id}/retry`,
    TEST_SUPER_ADMIN_TOKEN,
    {},
  );
  assert.equal(retry.status, 201);
  assert.equal(
    (
      await post(
        `/api/v1/admin/notifications/deliveries/${smsDelivery.id}/retry`,
        TEST_SUPER_ADMIN_TOKEN,
        {},
      )
    ).status,
    400,
  );
  const dispatched = await post(
    "/api/v1/admin/notifications/dispatch",
    TEST_SUPER_ADMIN_TOKEN,
    {},
  );
  assert.equal((await json<{ attempted: number }>(dispatched)).attempted, 1);
  const [after] = (await notices()).filter((item) => item.id === notice.id);
  assert.equal(
    after.deliveries.find((item) => item.id === smsDelivery.id)?.status,
    "sent",
  );
  assert.equal(
    (
      await post(
        `/api/v1/admin/notifications/deliveries/${randomUUID()}/retry`,
        TEST_SUPER_ADMIN_TOKEN,
        {},
      )
    ).status,
    404,
  );
});

test("the same event is never queued twice", async () => {
  const service = application.get(NotificationsService);
  const input = {
    companyId: companyA,
    jobId: jobA,
    event: "test",
    dedupeKey: "test:once",
    message: () => ({ subject: "Once", body: "Once", smsText: "Once" }),
  };
  const first = await service.notify(input);
  assert.notEqual(first, "duplicate");
  assert.equal(await service.notify(input), "duplicate");
  assert.equal((await byEvent("test")).length, 1);
});

test("an expected arrival within a day raises one reminder, and a new time raises another", async () => {
  const job = (
    await json<{ id: string }>(
      await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
        customerCompanyId: companyB,
        serviceLine: "sea_import",
      }),
    )
  ).id;
  const inHours = (hours: number) =>
    new Date(Date.now() + hours * 3_600_000).toISOString();
  await post(`/api/v1/jobs/${job}/eta`, TEST_MATCHING_TOKEN, {
    etaAt: inHours(72),
    source: "line",
  });
  const jobsBefore = await dispatcher.raiseEtaReminders();
  assert.equal(
    (await notices(job)).filter((item) => item.event === "eta_reminder").length,
    0,
  );
  assert.ok(jobsBefore >= 0);

  await post(`/api/v1/jobs/${job}/eta`, TEST_MATCHING_TOKEN, {
    etaAt: inHours(12),
    source: "line",
  });
  const raised = await dispatcher.raiseEtaReminders();
  assert.ok(raised >= 1);
  const [reminder] = (await notices(job)).filter(
    (item) => item.event === "eta_reminder",
  );
  assert.match(reminder.subject, /arriving soon/);
  assert.deepEqual(summary(reminder), ["Yaw:email:pending", "Yaw:sms:pending"]);
  assert.equal(
    await dispatcher.raiseEtaReminders(),
    0,
    "the same expected time is reminded once",
  );

  await post(`/api/v1/jobs/${job}/eta`, TEST_MATCHING_TOKEN, {
    etaAt: inHours(20),
    source: "line delayed",
  });
  assert.ok((await dispatcher.raiseEtaReminders()) >= 1);
  assert.equal(
    (await notices(job)).filter((item) => item.event === "eta_reminder").length,
    2,
  );
});

test("quotes, invoices, payments and deliveries each message the client", async () => {
  const quote = await post("/api/v1/quotes", TEST_MATCHING_TOKEN, {
    customerCompanyId: companyA,
    serviceLine: "sea_import",
    version: {
      currency: "GHS",
      title: "Clearance",
      procedureSteps: [],
      requiredDocuments: [],
      terms: [],
      lines: [{ description: "Fee", basis: "fixed", amountMinor: 1000 }],
    },
  });
  const quoteId = (await json<{ id: string }>(quote)).id;
  const issued = await post(
    `/api/v1/quotes/${quoteId}/issue`,
    TEST_MATCHING_TOKEN,
    {},
  );
  const quoteNumber = (await json<{ quoteNumber: string }>(issued)).quoteNumber;
  const [quoteMessage] = (
    await json<Array<Notice>>(await get(`/api/v1/jobs/${jobA}/notifications`))
  ).filter((item) => item.event === "quote_issued");
  assert.equal(quoteMessage, undefined, "a quote is not tied to a job");
  const logged = await testPostgresPool.query(
    "SELECT subject, link_url FROM app.notification WHERE event = 'quote_issued'",
  );
  assert.equal(logged.rows.length, 1);
  assert.equal(
    logged.rows[0].subject,
    `Your quotation ${quoteNumber} is ready`,
  );
  assert.equal(
    logged.rows[0].link_url,
    `https://portal.example.test/quotes/${quoteId}`,
  );

  const invoice = await json<{ id: string }>(
    await post(`/api/v1/jobs/${jobA}/invoices`, TEST_MATCHING_TOKEN, {
      currency: "GHS",
      lines: [{ description: "Handling", amountMinor: 100000 }],
    }),
  );
  await post(
    `/api/v1/jobs/${jobA}/invoices/${invoice.id}/issue`,
    TEST_MATCHING_TOKEN,
    {},
  );
  const [invoiceMessage] = await byEvent("invoice_issued");
  assert.match(
    invoiceMessage.body,
    /GHS 1,000\.00 has been issued, due \d{4}-\d{2}-\d{2}/,
  );

  await post(
    `/api/v1/jobs/${jobA}/invoices/${invoice.id}/payments`,
    TEST_MATCHING_TOKEN,
    {
      amountMinor: 40000,
      receivedOn: new Date().toISOString().slice(0, 10),
      method: "cash",
    },
  );
  const [paymentMessage] = await byEvent("payment_received");
  assert.match(paymentMessage.smsText, /payment of GHS 400\.00 received/);
  assert.match(paymentMessage.smsText, /Balance GHS 600\.00/);

  const driver = await json<{ id: string }>(
    await post("/api/v1/drivers", TEST_MATCHING_TOKEN, {
      name: "Kofi",
      phone: "0244000111",
    }),
  );
  const vehicle = await json<{ id: string }>(
    await post("/api/v1/vehicles", TEST_MATCHING_TOKEN, {
      registration: "GX 9-26",
    }),
  );
  const delivery = await json<{ id: string; waybillNumber: string }>(
    await post(`/api/v1/jobs/${jobA}/deliveries`, TEST_MATCHING_TOKEN, {
      driverId: driver.id,
      vehicleId: vehicle.id,
      cargoDescription: "Goods",
      deliveryAddress: "Kumasi site 4",
    }),
  );
  const [dispatched] = await byEvent("delivery_dispatched");
  assert.ok(dispatched.smsText.includes(delivery.waybillNumber));
  assert.ok(dispatched.smsText.includes("Kofi 0244000111"));
  await post(
    `/api/v1/jobs/${jobA}/deliveries/${delivery.id}/proof`,
    TEST_MATCHING_TOKEN,
    { receiverName: "Nana Synthetic" },
  );
  const [proof] = await byEvent("delivery_delivered");
  assert.ok(proof.body.includes("received by Nana Synthetic"));
});

test("the notification log is for the super admin only", async () => {
  for (const token of [
    TEST_MATCHING_TOKEN,
    TEST_CUSTOMER_A_TOKEN,
    TEST_CUSTOMER_B_TOKEN,
  ]) {
    assert.equal((await get("/api/v1/admin/notifications", token)).status, 403);
    assert.equal(
      (await post("/api/v1/admin/notifications/dispatch", token, {})).status,
      403,
    );
  }
  const bad = await get(
    "/api/v1/admin/notifications?status=lost",
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(bad.status, 400);
  assert.equal(
    await message(bad),
    "status must be one of pending, sent, failed, skipped",
  );
  assert.equal(
    (await get("/api/v1/admin/notifications?limit=0", TEST_SUPER_ADMIN_TOKEN))
      .status,
    400,
  );
  const overview = await json<{
    channels: string;
    providers: { email: string; sms: string };
    deliveries: unknown[];
  }>(await get("/api/v1/admin/notifications", TEST_SUPER_ADMIN_TOKEN));
  assert.equal(overview.channels, "both");
  assert.deepEqual(overview.providers, { email: "stub", sms: "stub" });
  assert.ok(overview.deliveries.length > 0);
});

test("the super admin adds contacts and switches them on or off; phones are checked", async () => {
  const base = `/api/v1/customers/${companyB}/contacts`;
  const created = await post(base, TEST_SUPER_ADMIN_TOKEN, {
    name: "Abena",
    email: "abena@example.test",
    phone: "+233 20 123 4567",
  });
  assert.equal(created.status, 201);
  const contact = await json<{ id: string; phone: string; notify: boolean }>(
    created,
  );
  assert.equal(contact.phone, "+233 20 123 4567");
  assert.equal(contact.notify, true);

  const bad = await post(base, TEST_SUPER_ADMIN_TOKEN, {
    name: "Bad",
    email: "bad@example.test",
    phone: "call me",
  });
  assert.equal(bad.status, 400);
  assert.match(await message(bad), /^phone must be a phone number/);
  assert.equal(
    (
      await post(base, TEST_MATCHING_TOKEN, {
        name: "x",
        email: "x@example.test",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post(
        `/api/v1/customers/${randomUUID()}/contacts`,
        TEST_SUPER_ADMIN_TOKEN,
        { name: "x", email: "x@example.test" },
      )
    ).status,
    404,
  );

  const off = await patch(`${base}/${contact.id}`, TEST_SUPER_ADMIN_TOKEN, {
    phone: "0209998888",
    notify: false,
  });
  assert.equal(off.status, 200);
  const updated = await json<{
    name: string;
    phone: string;
    notify: boolean;
  }>(off);
  assert.equal(updated.name, "Abena");
  assert.equal(updated.phone, "0209998888");
  assert.equal(updated.notify, false);
  assert.equal(
    (
      await patch(`${base}/${randomUUID()}`, TEST_SUPER_ADMIN_TOKEN, {
        notify: true,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await patch(
        `/api/v1/customers/${companyA}/contacts/${contact.id}`,
        TEST_SUPER_ADMIN_TOKEN,
        { notify: true },
      )
    ).status,
    404,
  );

  // Customers can read their own company's contacts, and never another's.
  assert.equal(
    (await get(`/api/v1/customers/${companyB}`, TEST_CUSTOMER_B_TOKEN)).status,
    200,
  );
  assert.equal(
    (await get(`/api/v1/customers/${companyB}`, TEST_CUSTOMER_A_TOKEN)).status,
    404,
  );
});
