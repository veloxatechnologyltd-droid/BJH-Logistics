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
import { ChatService, replyText } from "../src/chat/chat.service";
import { NotificationDispatcher } from "../src/notifications/notification-dispatcher.service";
import {
  EMAIL_PROVIDER,
  RecordingEmailProvider,
} from "../src/notifications/providers";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let companyA: string;
let customerNumber: string;

type Thread = {
  company: { customerNumber: string | null };
  messages: Array<{
    direction: string;
    channel: string;
    body: string;
    readAt: string | null;
  }>;
};

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });

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
  companyA = randomUUID();
  const companyB = randomUUID();
  await database.createCustomer({
    id: companyA,
    companyName: "Chat North Ltd",
    createdAt: new Date().toISOString(),
    contacts: [
      {
        id: randomUUID(),
        name: "Ama Synthetic",
        email: "ama@chat-north.test",
        createdAt: new Date().toISOString(),
      },
    ],
  });
  await database.createCustomer({
    id: companyB,
    companyName: "Chat South Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  customerNumber = (await database.findCustomer(companyA))!.customerNumber!;
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
  await call("/api/v1/settings", TEST_SUPER_ADMIN_TOKEN, {
    method: "PUT",
    body: JSON.stringify({
      issuer: { name: "Synthetic Forwarding Ltd", address: "1 Test Road" },
      currencies: ["GHS"],
      taxLines: [],
      paymentTermsDays: 30,
      numbering: {
        quotePrefix: "SYN/Q",
        invoicePrefix: "SYN/INV",
        receiptPrefix: "SYN/RCT",
      },
      quoteDefaults: {},
      notifications: { channels: "email" },
    }),
  });
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("customer service writes; the client reads it in the portal and by email", async () => {
  const sent = await post(
    `/api/v1/chat/threads/${companyA}`,
    TEST_UNASSIGNED_TOKEN,
    { body: "Your container was released this morning." },
  );
  assert.equal(sent.status, 201, await sent.clone().text());

  const email = application.get<RecordingEmailProvider>(EMAIL_PROVIDER);
  const before = email.sent.length;
  await application.get(NotificationDispatcher).dispatchDue();
  const outgoing = email.sent.slice(before).at(-1);
  assert.ok(outgoing);
  assert.equal(outgoing.to, "ama@chat-north.test");
  assert.ok(outgoing.subject.endsWith(`[Chat ${customerNumber}]`));
  assert.ok(outgoing.text.includes("Your container was released"));

  const portal = (await (
    await call("/api/v1/chat/mine", TEST_CUSTOMER_A_TOKEN)
  ).json()) as Thread;
  assert.deepEqual(
    portal.messages.map((item) => [item.direction, item.body]),
    [["to_client", "Your container was released this morning."]],
  );
  // The other company's conversation is empty, and theirs is not reachable.
  const other = (await (
    await call("/api/v1/chat/mine", TEST_CUSTOMER_B_TOKEN)
  ).json()) as Thread;
  assert.deepEqual(other.messages, []);
  assert.equal(
    (await call(`/api/v1/chat/threads/${companyA}`, TEST_CUSTOMER_B_TOKEN))
      .status,
    403,
  );
});

test("the client answers in the portal and customer service sees it unread", async () => {
  const answered = await post("/api/v1/chat/mine", TEST_CUSTOMER_A_TOKEN, {
    body: "Thank you. When will it reach our warehouse?",
  });
  assert.equal(answered.status, 201);
  const threads = (await (
    await call("/api/v1/chat/threads", TEST_UNASSIGNED_TOKEN)
  ).json()) as Array<{ companyId: string; unread: number }>;
  assert.equal(threads.find((item) => item.companyId === companyA)?.unread, 1);

  const opened = (await (
    await call(`/api/v1/chat/threads/${companyA}`, TEST_UNASSIGNED_TOKEN)
  ).json()) as Thread;
  assert.equal(opened.messages.length, 2);
  const after = (await (
    await call("/api/v1/chat/threads", TEST_UNASSIGNED_TOKEN)
  ).json()) as Array<{ companyId: string; unread: number }>;
  assert.equal(after.find((item) => item.companyId === companyA)?.unread, 0);
});

test("only customer service and the super admin speak for BJH", async () => {
  assert.equal(
    (await call("/api/v1/chat/threads", TEST_MATCHING_TOKEN)).status,
    403,
  );
  assert.equal(
    (
      await post(`/api/v1/chat/threads/${companyA}`, TEST_MATCHING_TOKEN, {
        body: "Hello",
      })
    ).status,
    403,
  );
});

test("an emailed reply joins the conversation only from one of the client's contacts", async () => {
  const chat = application.get(ChatService);
  const subject = `Re: Message from Synthetic Forwarding Ltd [Chat ${customerNumber}]`;
  assert.equal(
    await chat.receiveEmail({
      subject,
      fromEmail: "AMA@chat-north.test",
      fromName: "Ama Synthetic",
      text: "Friday works for us.\n\nOn Sat, 1 Nov 2026, BJH wrote:\n> Your container was released",
    }),
    true,
  );
  assert.equal(
    await chat.receiveEmail({
      subject,
      fromEmail: "stranger@elsewhere.test",
      fromName: "",
      text: "Let me in",
    }),
    false,
  );
  assert.equal(
    await chat.receiveEmail({
      subject: "A new quote request",
      fromEmail: "ama@chat-north.test",
      fromName: "",
      text: "Rates please",
    }),
    false,
  );
  const thread = (await (
    await call(`/api/v1/chat/threads/${companyA}`, TEST_SUPER_ADMIN_TOKEN)
  ).json()) as Thread;
  const last = thread.messages.at(-1)!;
  assert.equal(last.channel, "email");
  assert.equal(last.body, "Friday works for us.");
});

test("quoted history is cut from emailed replies", () => {
  assert.equal(
    replyText("Yes please.\r\n\r\n-----Original Message-----\r\nFrom: BJH"),
    "Yes please.",
  );
  assert.equal(replyText("Fine\n> earlier"), "Fine");
  assert.equal(replyText("Just this"), "Just this");
});
