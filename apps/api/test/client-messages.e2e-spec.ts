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
  testMessageDrafter,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { MessageDraftError } from "../src/notifications/message-drafter";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let companyA: string;
let companyB: string;
let companyQuiet: string;
let seaJob: string;
let airJob: string;

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
const get = (path: string, token: string) => call(path, token);
const json = async <T>(response: Response) => (await response.json()) as T;
const message = async (response: Response) =>
  ((await response.json()) as { message: string }).message;

type Delivery = {
  channel: "email" | "sms";
  contactName: string | null;
  status: string;
};
type Feed = {
  channels: string;
  aiDrafting: boolean;
  messages: Array<{
    id: string;
    companyId: string;
    companyName: string;
    jobId: string | null;
    fileNumber: string | null;
    event: string;
    subject: string;
    body: string;
    linkUrl: string | null;
    deliveries: Delivery[];
  }>;
};
type SendResult = {
  event: string;
  sent: Array<{ companyId: string; notificationId: string }>;
  skipped: Array<{ companyId: string; reason: string }>;
};

const feed = async (token: string, query = "") =>
  json<Feed>(await get(`/api/v1/messages${query}`, token));

const content = () => ({
  currency: "GHS",
  title: "Synthetic clearance quotation",
  procedureSteps: [],
  requiredDocuments: [],
  terms: [],
  sizeLabels: ["20ft", "40ft"],
  lines: [
    {
      description: "BJH service fee",
      basis: "per_container",
      sizeAmountsMinor: [150000, 180000],
    },
  ],
});

before(async () => {
  process.env.PUBLIC_WEB_URL = "https://portal.example.test";
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
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
  const now = new Date().toISOString();
  const contact = (
    name: string,
    notify = true,
    phone: string | null = null,
  ) => ({
    id: randomUUID(),
    name,
    email: `${name.toLowerCase()}@example.test`,
    phone,
    notify,
    createdAt: now,
  });
  companyA = randomUUID();
  companyB = randomUUID();
  companyQuiet = randomUUID();
  await database.createCustomer({
    id: companyA,
    companyName: "Northstar Synthetic Ltd",
    createdAt: now,
    contacts: [
      contact("Ama", true, "0244058592"),
      contact("Kojo"),
      contact("Esi", false, "0201234567"),
    ],
  });
  await database.createCustomer({
    id: companyB,
    companyName: "Southwind Synthetic Ltd",
    createdAt: now,
    contacts: [contact("Yaw", true, "0501234567")],
  });
  // Everyone here has asked not to be messaged.
  await database.createCustomer({
    id: companyQuiet,
    companyName: "Quiet Synthetic Ltd",
    createdAt: now,
    contacts: [contact("Nana", false)],
  });
  await database.grantCustomerMembership(
    companyA,
    TEST_CUSTOMER_A_ID,
    TEST_SUPER_ADMIN_ID,
  );
  seaJob = (
    await json<{ id: string }>(
      await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
        customerCompanyId: companyA,
        serviceLine: "sea_import",
      }),
    )
  ).id;
  airJob = (
    await json<{ id: string }>(
      await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
        customerCompanyId: companyB,
        serviceLine: "air_export",
      }),
    )
  ).id;
  // One job message on each line, so the feed has job-linked rows to scope.
  for (const id of [seaJob, airJob]) {
    const sent = await post(
      `/api/v1/jobs/${id}/messages`,
      TEST_SUPER_ADMIN_TOKEN,
      {
        subject: "About your job",
        body: "Synthetic job message",
      },
    );
    assert.equal(sent.status, 201);
  }
});

after(async () => {
  delete process.env.PUBLIC_WEB_URL;
  await application?.close();
  await endTestDatabase();
});

test("the feed is for staff only: customers and accounts with no role are refused", async () => {
  assert.equal(
    (await get("/api/v1/messages", TEST_CUSTOMER_A_TOKEN)).status,
    403,
  );
  assert.equal(
    (
      await post("/api/v1/messages", TEST_CUSTOMER_A_TOKEN, {
        audience: "all",
        body: "Hello",
      })
    ).status,
    403,
  );
  const signedOut = await fetch(`${baseUrl}/api/v1/messages`);
  assert.equal(signedOut.status, 401);
});

test("the super admin sees messages on every job; a rep only those on their own lines", async () => {
  const everything = await feed(TEST_SUPER_ADMIN_TOKEN);
  assert.deepEqual(
    everything.messages.map((item) => item.fileNumber).sort(),
    [
      (await jobNumber(seaJob)) as string,
      (await jobNumber(airJob)) as string,
    ].sort(),
  );

  const seaRep = await feed(TEST_MATCHING_TOKEN);
  assert.deepEqual(
    seaRep.messages.map((item) => item.jobId),
    [seaJob],
  );
  const airRep = await feed(TEST_UNASSIGNED_TOKEN);
  assert.deepEqual(
    airRep.messages.map((item) => item.jobId),
    [airJob],
  );
});

async function jobNumber(id: string) {
  return (
    await json<{ fileNumber: string }>(
      await get(`/api/v1/jobs/${id}`, TEST_SUPER_ADMIN_TOKEN),
    )
  ).fileNumber;
}

test("the feed filters by company and by kind of message, and rejects bad filters", async () => {
  const byCompany = await feed(
    TEST_SUPER_ADMIN_TOKEN,
    `?companyId=${companyB}`,
  );
  assert.deepEqual(
    byCompany.messages.map((item) => item.companyName),
    ["Southwind Synthetic Ltd"],
  );
  const byEvent = await feed(TEST_SUPER_ADMIN_TOKEN, "?event=broadcast");
  assert.equal(byEvent.messages.length, 0);

  assert.equal(
    (await get("/api/v1/messages?companyId=nope", TEST_SUPER_ADMIN_TOKEN))
      .status,
    400,
  );
  assert.equal(
    (await get("/api/v1/messages?event=nope", TEST_SUPER_ADMIN_TOKEN)).status,
    400,
  );
  assert.equal(
    (await get("/api/v1/messages?limit=0", TEST_SUPER_ADMIN_TOKEN)).status,
    400,
  );
});

test("a message to one company reaches its contacts who have not opted out, by email and SMS", async () => {
  const response = await post("/api/v1/messages", TEST_MATCHING_TOKEN, {
    audience: [companyA],
    subject: "Holiday hours",
    body: "We are closed on Friday.",
  });
  assert.equal(response.status, 201);
  const result = await json<SendResult>(response);
  assert.equal(result.event, "message");
  assert.equal(result.sent.length, 1);
  assert.deepEqual(result.skipped, []);

  const [sent] = (
    await feed(TEST_SUPER_ADMIN_TOKEN, `?companyId=${companyA}&event=message`)
  ).messages.filter((item) => item.jobId === null);
  assert.equal(sent.subject, "Holiday hours");
  assert.equal(sent.linkUrl, "https://portal.example.test/portal");
  assert.match(sent.body, /We are closed on Friday\./);
  assert.deepEqual(
    sent.deliveries.map((item) => `${item.contactName}:${item.channel}`).sort(),
    ["Ama:email", "Ama:sms", "Kojo:email", "Kojo:sms"],
  );
  // Kojo has no phone number, so his SMS is recorded as skipped, not lost.
  assert.equal(
    sent.deliveries.find(
      (item) => item.contactName === "Kojo" && item.channel === "sms",
    )?.status,
    "skipped",
  );
  // Esi switched notifications off and is not messaged at all.
  assert.equal(
    sent.deliveries.some((item) => item.contactName === "Esi"),
    false,
  );
});

test("a broadcast to chosen companies creates one message per company", async () => {
  const response = await post("/api/v1/messages", TEST_MATCHING_TOKEN, {
    audience: [companyA, companyB],
    body: "Our office has moved.",
  });
  assert.equal(response.status, 201);
  const result = await json<SendResult>(response);
  assert.equal(result.event, "broadcast");
  assert.deepEqual(
    result.sent.map((item) => item.companyId).sort(),
    [companyA, companyB].sort(),
  );

  const broadcasts = (await feed(TEST_SUPER_ADMIN_TOKEN, "?event=broadcast"))
    .messages;
  assert.equal(broadcasts.length, 2);
  assert.ok(broadcasts.every((item) => item.subject.length > 0));
});

test("a broadcast to everyone reports companies with nobody to notify instead of dropping them", async () => {
  const response = await post("/api/v1/messages", TEST_SUPER_ADMIN_TOKEN, {
    audience: "all",
    subject: "Service notice",
    body: "Planned maintenance tonight.",
  });
  assert.equal(response.status, 201);
  const result = await json<SendResult>(response);
  assert.equal(result.event, "broadcast");
  assert.deepEqual(
    result.sent.map((item) => item.companyId).sort(),
    [companyA, companyB].sort(),
  );
  assert.deepEqual(
    result.skipped.map((item) => [item.companyId, item.reason]),
    [[companyQuiet, "No contact to notify"]],
  );
  const quiet = await feed(
    TEST_SUPER_ADMIN_TOKEN,
    `?companyId=${companyQuiet}`,
  );
  assert.equal(quiet.messages.length, 0);
});

test("sending needs a body and a real audience", async () => {
  const send = (body: unknown) =>
    post("/api/v1/messages", TEST_SUPER_ADMIN_TOKEN, body);
  const noBody = await send({ audience: "all" });
  assert.equal(noBody.status, 400);
  assert.match(await message(noBody), /body/);
  const blank = await send({ audience: "all", body: "   " });
  assert.equal(blank.status, 400);
  const empty = await send({ audience: [], body: "Hello" });
  assert.equal(empty.status, 400);
  assert.match(await message(empty), /at least one company/);
  const notIds = await send({ audience: ["x"], body: "Hello" });
  assert.equal(notIds.status, 400);
  const unknown = await send({ audience: [randomUUID()], body: "Hello" });
  assert.equal(unknown.status, 400);
  assert.match(await message(unknown), /not found/);
  const tooLong = await send({ audience: "all", body: "x".repeat(1501) });
  assert.equal(tooLong.status, 400);
});

test("an issued quote can be sent again; a draft cannot; the client gets the link", async () => {
  const created = await json<{ id: string }>(
    await post("/api/v1/quotes", TEST_MATCHING_TOKEN, {
      customerCompanyId: companyA,
      serviceLine: "sea_import",
      version: content(),
    }),
  );

  const draftSend = await post(
    `/api/v1/quotes/${created.id}/send`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(draftSend.status, 409);
  assert.match(await message(draftSend), /issued/);

  assert.equal(
    (await post(`/api/v1/quotes/${created.id}/issue`, TEST_MATCHING_TOKEN, {}))
      .status,
    201,
  );
  const first = await post(
    `/api/v1/quotes/${created.id}/send`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(first.status, 201);
  const second = await post(
    `/api/v1/quotes/${created.id}/send`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(second.status, 201, "each send is a deliberate new message");

  const sends = (await feed(TEST_SUPER_ADMIN_TOKEN, "?event=quote_sent"))
    .messages;
  assert.equal(sends.length, 2);
  assert.equal(
    sends[0].linkUrl,
    `https://portal.example.test/quotes/${created.id}`,
  );
  // Issuing already sent one automatically; that one stays in the feed too.
  assert.equal(
    (await feed(TEST_SUPER_ADMIN_TOKEN, "?event=quote_issued")).messages.length,
    1,
  );

  // A rep of another line cannot send a quote they cannot see.
  const other = await post(
    `/api/v1/quotes/${created.id}/send`,
    TEST_UNASSIGNED_TOKEN,
    {},
  );
  assert.ok(
    other.status === 403 || other.status === 404,
    `got ${other.status}`,
  );
  assert.equal(
    (await post(`/api/v1/quotes/${created.id}/send`, TEST_CUSTOMER_A_TOKEN, {}))
      .status,
    403,
  );
});

test("the AI drafts a message to clients from staff's instruction, given no customer's data, and sends nothing", async () => {
  testMessageDrafter.calls = [];
  testMessageDrafter.result = {
    subject: "Port closed",
    body: "Tema closes Friday.",
  };
  const before = (await feed(TEST_SUPER_ADMIN_TOKEN)).messages.length;
  assert.equal((await feed(TEST_MATCHING_TOKEN)).aiDrafting, true);

  const response = await post("/api/v1/messages/draft", TEST_MATCHING_TOKEN, {
    instruction: "Tell clients Tema port is closed on Friday",
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await json(response), {
    subject: "Port closed",
    body: "Tema closes Friday.",
  });
  assert.equal(testMessageDrafter.calls.length, 1);
  assert.equal(
    testMessageDrafter.calls[0].instruction,
    "Tell clients Tema port is closed on Friday",
  );
  assert.equal(testMessageDrafter.calls[0].job, null);
  assert.equal((await feed(TEST_SUPER_ADMIN_TOKEN)).messages.length, before);
});

test("a job message is drafted from that job only, for staff who may see the job", async () => {
  testMessageDrafter.calls = [];
  const fileNumber = (
    await json<{ fileNumber: string }>(
      await get(`/api/v1/jobs/${seaJob}`, TEST_SUPER_ADMIN_TOKEN),
    )
  ).fileNumber;
  const sent = (
    await json<unknown[]>(
      await get(`/api/v1/jobs/${seaJob}/notifications`, TEST_SUPER_ADMIN_TOKEN),
    )
  ).length;

  const response = await post(
    `/api/v1/jobs/${seaJob}/messages/draft`,
    TEST_MATCHING_TOKEN,
    { instruction: "Say the cargo is being cleared" },
  );
  assert.equal(response.status, 201);
  const job = testMessageDrafter.calls[0].job;
  assert.equal(job?.fileNumber, fileNumber);
  assert.equal(job?.companyName, "Northstar Synthetic Ltd");
  assert.equal(job?.service, "Sea import");
  assert.equal(
    (
      await json<unknown[]>(
        await get(
          `/api/v1/jobs/${seaJob}/notifications`,
          TEST_SUPER_ADMIN_TOKEN,
        ),
      )
    ).length,
    sent,
  );

  // A rep of another line, and a customer, cannot have the AI read this job.
  const other = await post(
    `/api/v1/jobs/${seaJob}/messages/draft`,
    TEST_UNASSIGNED_TOKEN,
    { instruction: "Say the cargo is being cleared" },
  );
  assert.ok(
    other.status === 403 || other.status === 404,
    `got ${other.status}`,
  );
  for (const path of [
    `/api/v1/jobs/${seaJob}/messages/draft`,
    "/api/v1/messages/draft",
  ]) {
    assert.equal(
      (await post(path, TEST_CUSTOMER_A_TOKEN, { instruction: "Hello" }))
        .status,
      403,
    );
  }
  assert.equal(testMessageDrafter.calls.length, 1);
});

test("drafting refuses an empty instruction and fails safely when the AI is off or fails", async () => {
  testMessageDrafter.calls = [];
  const draft = (body: unknown) =>
    post("/api/v1/messages/draft", TEST_SUPER_ADMIN_TOKEN, body);

  assert.equal((await draft({ instruction: "  " })).status, 400);
  assert.equal((await draft({ instruction: "x".repeat(1001) })).status, 400);
  assert.equal(testMessageDrafter.calls.length, 0);

  testMessageDrafter.result = new MessageDraftError(
    "The AI service is busy or over its limit",
  );
  const failed = await draft({ instruction: "Hello" });
  assert.equal(failed.status, 502);
  assert.equal(
    await message(failed),
    "The AI service is busy or over its limit",
  );

  testMessageDrafter.model = null;
  try {
    const off = await draft({ instruction: "Hello" });
    assert.equal(off.status, 503);
    assert.equal(await message(off), "AI drafting is not set up");
    assert.equal((await feed(TEST_SUPER_ADMIN_TOKEN)).aiDrafting, false);
  } finally {
    testMessageDrafter.model = "test-drafter";
    testMessageDrafter.result = {
      subject: "Port closed",
      body: "Tema closes Friday.",
    };
  }
});
