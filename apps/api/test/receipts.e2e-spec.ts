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
import {
  EMAIL_PROVIDER,
  RecordingEmailProvider,
} from "../src/notifications/providers";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let jobId: string;
let invoiceId: string;
let paymentId: string;

type Receipt = {
  paymentId: string;
  receiptNumber: string;
  reference: string | null;
  amountMinor: number;
};

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown = {}) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });

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
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "finance_rep",
    TEST_SUPER_ADMIN_ID,
  );
  const companyA = randomUUID();
  const companyB = randomUUID();
  await database.createCustomer({
    id: companyA,
    companyName: "Receipt North Ltd",
    createdAt: new Date().toISOString(),
    contacts: [
      {
        id: randomUUID(),
        name: "Ama Synthetic",
        email: "ama@receipt-north.test",
        createdAt: new Date().toISOString(),
      },
    ],
  });
  await database.createCustomer({
    id: companyB,
    companyName: "Receipt South Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
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
  const opened = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyA,
    serviceLine: "sea_import",
  });
  jobId = ((await opened.json()) as { id: string }).id;
  const draft = await post(
    `/api/v1/jobs/${jobId}/invoices`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      currency: "GHS",
      lines: [{ description: "Clearance", amountMinor: 50000 }],
    },
  );
  invoiceId = ((await draft.json()) as { id: string }).id;
  await post(
    `/api/v1/jobs/${jobId}/invoices/${invoiceId}/issue`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  const paid = await post(
    `/api/v1/jobs/${jobId}/invoices/${invoiceId}/payments`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      amountMinor: 20000,
      receivedOn: new Date().toISOString().slice(0, 10),
      method: "bank_transfer",
      reference: "TRF-INTERNAL-1",
    },
  );
  assert.equal(paid.status, 201, await paid.clone().text());
  paymentId = ((await paid.json()) as { id: string }).id;
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("customers see their own receipts in the portal, without staff references", async () => {
  const own = (await (
    await call("/api/v1/receipts", TEST_CUSTOMER_A_TOKEN)
  ).json()) as Receipt[];
  assert.equal(own.length, 1);
  assert.equal(own[0].paymentId, paymentId);
  assert.match(own[0].receiptNumber, /^SYN\/RCT\//);
  assert.equal(own[0].reference, null);
  assert.equal(own[0].amountMinor, 20000);

  const other = (await (
    await call("/api/v1/receipts", TEST_CUSTOMER_B_TOKEN)
  ).json()) as Receipt[];
  assert.deepEqual(other, []);

  const pdf = await call(
    `/api/v1/jobs/${jobId}/invoices/${invoiceId}/payments/${paymentId}/receipt`,
    TEST_CUSTOMER_A_TOKEN,
  );
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  const notTheirs = await call(
    `/api/v1/jobs/${jobId}/invoices/${invoiceId}/payments/${paymentId}/receipt`,
    TEST_CUSTOMER_B_TOKEN,
  );
  assert.equal(notTheirs.status, 404);
});

test("finance and customer service see receipts; the import rep does not", async () => {
  const desk = (await (
    await call("/api/v1/receipts", TEST_UNASSIGNED_TOKEN)
  ).json()) as Receipt[];
  assert.equal(desk[0].reference, "TRF-INTERNAL-1");
  const pdfPath = `/api/v1/jobs/${jobId}/invoices/${invoiceId}/payments/${paymentId}/receipt`;
  const sendPath = `${pdfPath}/send`;
  const refused = async (who: string) => {
    for (const status of [
      (await call("/api/v1/receipts", TEST_MATCHING_TOKEN)).status,
      (await call(pdfPath, TEST_MATCHING_TOKEN)).status,
      (await post(sendPath, TEST_MATCHING_TOKEN)).status,
    ]) {
      assert.equal(status, 403, who);
    }
  };
  await refused("import rep");

  // BJH has no finance person, so customer service sees receipts (Evans, 2026-11-03).
  const database = application.get(DatabasePort);
  await database.revokeStaffRole(
    TEST_MATCHING_USER_ID,
    "import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "customer_service_rep",
    TEST_SUPER_ADMIN_ID,
  );
  assert.equal(
    (await call("/api/v1/receipts", TEST_MATCHING_TOKEN)).status,
    200,
  );
  assert.equal((await call(pdfPath, TEST_MATCHING_TOKEN)).status, 200);
});

test("finance and customer service email a receipt and the PDF goes with it", async () => {
  const path = `/api/v1/jobs/${jobId}/invoices/${invoiceId}/payments/${paymentId}/receipt/send`;
  // TEST_MATCHING is customer service since the receipts test above.
  assert.equal((await post(path, TEST_MATCHING_TOKEN)).status, 201);
  assert.equal((await post(path, TEST_CUSTOMER_A_TOKEN)).status, 403);

  const email = application.get<RecordingEmailProvider>(EMAIL_PROVIDER);
  const before = email.sent.length;
  const sent = await post(path, TEST_UNASSIGNED_TOKEN);
  assert.equal(sent.status, 201, await sent.clone().text());
  await application.get(NotificationDispatcher).dispatchDue();
  const receipt = email.sent
    .slice(before)
    .find((item) => item.subject.startsWith("Receipt SYN/RCT/"));
  assert.ok(receipt, "the receipt email was sent");
  assert.equal(receipt.to, "ama@receipt-north.test");
  assert.equal(receipt.attachments?.length, 1);
  assert.match(receipt.attachments![0].filename, /^SYN-RCT-.*\.pdf$/);
});

test("the job's message log leaves out invoice, payment and receipt messages for non-finance staff", async () => {
  const events = async (token: string) =>
    (
      (await (
        await call(`/api/v1/jobs/${jobId}/notifications`, token)
      ).json()) as Array<{ event: string }>
    ).map((message) => message.event);
  const money = ["invoice_issued", "payment_received", "receipt_sent"];

  const finance = await events(TEST_UNASSIGNED_TOKEN);
  for (const event of money) assert.ok(finance.includes(event), event);
  // TEST_MATCHING goes back to being an import rep, who sees no money.
  const database = application.get(DatabasePort);
  await database.revokeStaffRole(
    TEST_MATCHING_USER_ID,
    "customer_service_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  const rep = await events(TEST_MATCHING_TOKEN);
  for (const event of money) assert.equal(rep.includes(event), false, event);
});
