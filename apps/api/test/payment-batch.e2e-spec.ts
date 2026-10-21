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
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let companyA: string;
let companyB: string;
const ids: Record<string, string> = {};
const numbers: Record<string, string> = {};
const jobs: Record<string, string> = {};

const today = () => new Date().toISOString().slice(0, 10);

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown = {}) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });
const get = (path: string, token: string) => call(path, token);
const json = async <T>(response: Response) => (await response.json()) as T;
const message = async (response: Response) =>
  ((await response.json()) as { message: string }).message;

type Payment = { id: string; amountMinor: number; receiptNumber: string };
type Batch = { payments: Payment[]; totalMinor: number; currency: string };
type Owing = {
  invoices: Array<{ invoiceNumber: string; outstandingMinor: number }>;
};

const pay = (
  allocations: Array<{ invoiceId: string; amountMinor: number }>,
  over: Record<string, unknown> = {},
  token = TEST_SUPER_ADMIN_TOKEN,
) =>
  post("/api/v1/payments", token, {
    receivedOn: today(),
    method: "bank_transfer",
    reference: "TT-BATCH",
    allocations,
    ...over,
  });
const owing = async (company: string) =>
  Object.fromEntries(
    (
      await json<Owing>(
        await get(
          `/api/v1/invoices/outstanding?companyId=${company}`,
          TEST_SUPER_ADMIN_TOKEN,
        ),
      )
    ).invoices.map((row) => [row.invoiceNumber, row.outstandingMinor]),
  );

async function openJob(companyId: string, serviceLine: string) {
  const response = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine,
  });
  return (await json<{ id: string }>(response)).id;
}

/** An invoice with one line; issued unless `state` says otherwise. */
async function invoice(
  key: string,
  jobId: string,
  amountMinor: number,
  currency = "GHS",
  state: "issued" | "draft" = "issued",
) {
  const created = await json<{ id: string }>(
    await post(`/api/v1/jobs/${jobId}/invoices`, TEST_SUPER_ADMIN_TOKEN, {
      currency,
      lines: [{ description: key, amountMinor, taxable: false }],
    }),
  );
  ids[key] = created.id;
  jobs[key] = jobId;
  if (state === "draft") return;
  const issued = await json<{ invoiceNumber: string }>(
    await post(
      `/api/v1/jobs/${jobId}/invoices/${created.id}/issue`,
      TEST_SUPER_ADMIN_TOKEN,
    ),
  );
  numbers[key] = issued.invoiceNumber;
}

const allocation = (key: string, amountMinor: number) => ({
  invoiceId: ids[key],
  amountMinor,
});

before(async () => {
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
  [companyA, companyB] = [randomUUID(), randomUUID()];
  const now = new Date().toISOString();
  for (const [id, name, email] of [
    [companyA, "Northstar Synthetic Ltd", "ama@example.test"],
    [companyB, "Southwind Synthetic Ltd", "yaw@example.test"],
  ]) {
    await database.createCustomer({
      id,
      companyName: name,
      createdAt: now,
      contacts: [
        {
          id: randomUUID(),
          name: "Contact",
          email,
          phone: "024 405 8592",
          notify: true,
          createdAt: now,
        },
      ],
    });
  }
  await database.grantCustomerMembership(
    companyA,
    TEST_CUSTOMER_A_ID,
    TEST_SUPER_ADMIN_ID,
  );
  await call("/api/v1/settings", TEST_SUPER_ADMIN_TOKEN, {
    method: "PUT",
    body: JSON.stringify({
      issuer: { name: "Synthetic Forwarding Ltd" },
      currencies: ["GHS", "USD"],
      numbering: {
        quotePrefix: "SYN/Q",
        invoicePrefix: "SYN/INV",
        receiptPrefix: "SYN/RCT",
      },
      quoteDefaults: {},
    }),
  });

  const seaOne = await openJob(companyA, "sea_import");
  const seaTwo = await openJob(companyA, "sea_import");
  const air = await openJob(companyA, "air_import");
  const seaB = await openJob(companyB, "sea_import");
  await invoice("one", seaOne, 100_000);
  await invoice("two", seaTwo, 50_000);
  await invoice("three", air, 70_000);
  await invoice("dollars", air, 30_000, "USD");
  await invoice("draft", seaOne, 5_000, "GHS", "draft");
  await invoice("other", seaB, 20_000);
  await invoice("single", seaOne, 12_000);
  await invoice("extra", seaOne, 40_000);
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("one payment settles several invoices, each with its own receipt, and the customer gets one message", async () => {
  const response = await pay([
    allocation("one", 100_000),
    allocation("two", 50_000),
    allocation("three", 20_000),
  ]);
  assert.equal(response.status, 201);
  const result = await json<Batch>(response);
  assert.equal(result.payments.length, 3);
  assert.equal(result.totalMinor, 170_000);
  assert.equal(result.currency, "GHS");
  assert.equal(new Set(result.payments.map((p) => p.receiptNumber)).size, 3);
  assert.ok(result.payments.every((p) => /^SYN\/RCT\//.test(p.receiptNumber)));

  // Two are cleared; the third is part paid.
  const left = await owing(companyA);
  assert.equal(left[numbers.one], undefined);
  assert.equal(left[numbers.two], undefined);
  assert.equal(left[numbers.three], 50_000);

  const sent = await json<{
    messages: Array<{ subject: string; jobId: string | null; body: string }>;
  }>(
    await get(
      `/api/v1/messages?event=payment_received&companyId=${companyA}`,
      TEST_SUPER_ADMIN_TOKEN,
    ),
  );
  assert.equal(sent.messages.length, 1);
  assert.equal(sent.messages[0].subject, "Payment received for 3 invoices");
  // The invoices are on different jobs, so the message is not tied to one.
  assert.equal(sent.messages[0].jobId, null);
  for (const key of ["one", "two", "three"]) {
    assert.match(sent.messages[0].body, new RegExp(numbers[key]));
  }
});

test("a single invoice in the batch behaves like a normal payment, with the usual message", async () => {
  const response = await pay([allocation("single", 12_000)], {
    reference: "TT-SINGLE",
  });
  assert.equal(response.status, 201);
  const result = await json<Batch>(response);
  assert.equal(result.payments.length, 1);
  const sent = await json<{
    messages: Array<{ subject: string; jobId: string | null }>;
  }>(
    await get(
      `/api/v1/messages?event=payment_received&companyId=${companyA}`,
      TEST_SUPER_ADMIN_TOKEN,
    ),
  );
  assert.ok(
    sent.messages.some(
      (item) =>
        item.subject === `Payment received for invoice ${numbers.single}` &&
        item.jobId === jobs.single,
    ),
  );
});

test("the statement shows each payment of the batch against its invoice", async () => {
  const statement = await json<{
    sections: Array<{
      currency: string;
      closingMinor: number;
      lines: Array<{ kind: string; reference: string; creditMinor: number }>;
    }>;
  }>(
    await get(
      `/api/v1/finance/statements?companyId=${companyA}`,
      TEST_SUPER_ADMIN_TOKEN,
    ),
  );
  const ghs = statement.sections.find((item) => item.currency === "GHS")!;
  const credits = ghs.lines.filter((line) => line.kind === "payment");
  assert.deepEqual(
    credits.map((line) => line.creditMinor).sort((a, b) => a - b),
    [12_000, 20_000, 50_000, 100_000],
  );
  assert.match(credits[0].reference, /TT-BATCH|TT-SINGLE/);
  assert.equal(ghs.closingMinor, 90_000);
});

test("all or nothing: one invoice paid beyond its balance saves none of the batch", async () => {
  const before = await owing(companyA);
  // "extra" is fine on its own; "three" owes 50,000, so 50,001 is refused.
  const response = await pay([
    allocation("extra", 10_000),
    allocation("three", 50_001),
  ]);
  assert.equal(response.status, 409);
  assert.equal(
    await message(response),
    `The payment is more than the outstanding balance of ${numbers.three}`,
  );
  assert.deepEqual(await owing(companyA), before);
  assert.equal(before[numbers.extra], 40_000);

  // Paying exactly what is owed is allowed, and then the invoice is cleared.
  const exact = await pay([allocation("three", 50_000)]);
  assert.equal(exact.status, 201);
  assert.equal((await owing(companyA))[numbers.three], undefined);
  const again = await pay([allocation("three", 1)]);
  assert.equal(again.status, 409);
});

test("a batch cannot mix currencies or customers, repeat an invoice, or use unissued ones", async () => {
  const cases: Array<
    [Array<{ invoiceId: string; amountMinor: number }>, number, string]
  > = [
    [
      [allocation("extra", 100), allocation("dollars", 100)],
      400,
      "All the invoices must be in the same currency",
    ],
    [
      [allocation("extra", 100), allocation("other", 100)],
      400,
      "All the invoices must belong to the same customer",
    ],
    [
      [allocation("extra", 100), allocation("extra", 100)],
      400,
      "Each invoice can appear only once",
    ],
    [
      [allocation("draft", 100)],
      409,
      "Payments can only be recorded against an issued invoice",
    ],
    [[], 400, "Choose at least one invoice"],
    [
      [{ invoiceId: randomUUID(), amountMinor: 100 }],
      404,
      "Invoice was not found",
    ],
    [
      [{ invoiceId: "not-a-uuid", amountMinor: 100 }],
      400,
      "invoiceId must be a valid ID",
    ],
    [
      [{ invoiceId: ids.extra, amountMinor: 0 }],
      400,
      "amountMinor must be more than zero",
    ],
  ];
  const before = await owing(companyA);
  for (const [allocations, status, expected] of cases) {
    const response = await pay(allocations);
    assert.equal(response.status, status, expected);
    assert.equal(await message(response), expected);
  }
  assert.deepEqual(await owing(companyA), before);

  const future = await pay([allocation("extra", 100)], {
    receivedOn: new Date(Date.now() + 3 * 86_400_000)
      .toISOString()
      .slice(0, 10),
  });
  assert.equal(future.status, 400);
  assert.equal(await message(future), "receivedOn cannot be in the future");
  const noMethod = await pay([allocation("extra", 100)], { method: "bitcoin" });
  assert.equal(noMethod.status, 400);
});

test("a rep can only pay invoices on their own service lines, and nothing is saved if one is outside", async () => {
  const before = await owing(companyA);
  // "three" is an air-import job; the sea-import rep cannot reach it, even with a sea invoice beside it.
  const response = await pay(
    [allocation("extra", 100), allocation("three", 100)],
    {},
    TEST_MATCHING_TOKEN,
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await owing(companyA), before);

  // Their own line's invoice is fine.
  const own = await pay([allocation("extra", 100)], {}, TEST_MATCHING_TOKEN);
  assert.equal(own.status, 201);
  assert.equal((await owing(companyA))[numbers.extra], 39_900);

  // A user with no staff role is refused.
  const none = await pay([allocation("extra", 100)], {}, TEST_UNASSIGNED_TOKEN);
  assert.equal(none.status, 403);
});

test("customers and anonymous callers cannot record payments", async () => {
  const before = await owing(companyA);
  const customer = await pay(
    [allocation("extra", 100)],
    {},
    TEST_CUSTOMER_A_TOKEN,
  );
  assert.equal(customer.status, 403);
  const anonymous = await fetch(`${baseUrl}/api/v1/payments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await owing(companyA), before);
});
