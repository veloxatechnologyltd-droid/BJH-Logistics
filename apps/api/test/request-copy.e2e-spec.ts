import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_SUPER_ADMIN_ID,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import {
  EMAIL_PROVIDER,
  RecordingEmailProvider,
} from "../src/notifications/providers";
import {
  isRequestCopy,
  requestCopyAddress,
} from "../src/intake/request-copy.service";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

const SECRET = "test-copy-secret";
const MAILBOX = "quotes@bjh.example.test";
let application: INestApplication;
let baseUrl: string;
let email: RecordingEmailProvider;

before(async () => {
  process.env.INBOUND_EMAIL_SECRET = SECRET;
  process.env.REQUEST_COPY_TO = MAILBOX;
  process.env.PUBLIC_WEB_URL = "https://portal.example.test";
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  email = application.get(EMAIL_PROVIDER);
  const database = application.get(DatabasePort);
  const companyId = randomUUID();
  await database.createCustomer({
    id: companyId,
    companyName: "Copy Synthetic Ltd",
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
  delete process.env.INBOUND_EMAIL_SECRET;
  delete process.env.REQUEST_COPY_TO;
  await application?.close();
  await endTestDatabase();
});

const copies = () => email.sent.filter((item) => isRequestCopy(item.subject));

test("a portal request is copied to the quote mailbox with a link to it", async () => {
  const response = await fetch(`${baseUrl}/api/v1/quote-requests/mine`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TEST_CUSTOMER_A_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      contactName: "Ama Synthetic",
      message: "Two 40ft from Ningbo to Tema, please.",
    }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const request = (await response.json()) as { id: string };
  const copy = copies().at(-1);
  assert.ok(copy, "a copy was sent");
  assert.equal(copy.to, MAILBOX);
  assert.match(
    copy.subject,
    /Ama Synthetic \(Copy Synthetic Ltd\) \(client portal\)/,
  );
  assert.ok(copy.text.includes("Two 40ft from Ningbo to Tema"));
  assert.ok(
    copy.text.includes(
      `https://portal.example.test/quotations/requests/${request.id}`,
    ),
  );
});

test("a website request is copied; an emailed one is not", async () => {
  const deliver = (fields: Record<string, string>) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return fetch(`${baseUrl}/api/v1/inbound-email`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
      body: form,
    });
  };
  const before = copies().length;
  const website = await deliver({
    from_email: "kofi@harbour.test",
    from_name: "Kofi Synthetic",
    subject: "Quote request",
    text: "Website quote request\n\nOne 20ft from Antwerp.",
    message_id: `website:${randomUUID()}`,
    source: "website",
  });
  assert.equal(website.status, 201, await website.clone().text());
  assert.equal(copies().length, before + 1);
  assert.match(copies().at(-1)!.subject, /Kofi Synthetic \(website\)/);

  await deliver({
    from_email: "esi@shipper.test",
    subject: "Rates?",
    text: "Your rates for air freight?",
    message_id: `<${randomUUID()}@shipper.test>`,
  });
  assert.equal(copies().length, before + 1);
});

test("the mailbox reader recognises a copy, and copies need an address", () => {
  assert.equal(isRequestCopy("[BJH copy] New quote request from X"), true);
  assert.equal(isRequestCopy("Re: [BJH copy] New quote request"), false);
  assert.equal(isRequestCopy(undefined), false);
  assert.equal(requestCopyAddress({}), null);
  assert.equal(
    requestCopyAddress({ INBOUND_IMAP_USER: "quotes@bjh.test" }),
    "quotes@bjh.test",
  );
});
