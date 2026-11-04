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
let companyA: string;
let companyB: string;
let jobOne: string;
let jobTwo: string;
let jobB: string;

const today = () => new Date().toISOString().slice(0, 10);

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown = {}) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });

async function openJob(companyId: string) {
  const response = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine: "sea_import",
  });
  return ((await response.json()) as { id: string }).id;
}

async function issuedInvoice(jobId: string, amountMinor: number) {
  const created = (await (
    await post(`/api/v1/jobs/${jobId}/invoices`, TEST_SUPER_ADMIN_TOKEN, {
      currency: "GHS",
      lines: [{ description: "Clearing", amountMinor, taxable: false }],
    })
  ).json()) as { id: string };
  await post(
    `/api/v1/jobs/${jobId}/invoices/${created.id}/issue`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  return created.id;
}

type Report = {
  company: { name: string };
  jobs: Array<{
    job: { id: string; fileNumber: string };
    parties: Array<{ role: string; name: string }>;
    references: Array<{ kind: string; value: string }>;
    milestones: Array<{ label: string; occurredAt: string | null }>;
    invoices: Array<{
      totalMinor: number;
      paidMinor: number;
      outstandingMinor: number;
    }>;
  }>;
  totals: Array<{
    currency: string;
    invoicedMinor: number;
    paidMinor: number;
    outstandingMinor: number;
  }>;
  credit: Array<{ currency: string; availableMinor: number }>;
};

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
  [companyA, companyB] = [randomUUID(), randomUUID()];
  const now = new Date().toISOString();
  for (const [id, name] of [
    [companyA, "Report Synthetic Ltd"],
    [companyB, "Other Synthetic Ltd"],
  ]) {
    await database.createCustomer({
      id,
      companyName: name,
      createdAt: now,
      contacts: [
        {
          id: randomUUID(),
          name: "Contact",
          email: `${name.split(" ")[0].toLowerCase()}@example.test`,
          phone: "024 405 8592",
          // Company A's contact gets the emailed report.
          notify: id === companyA,
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
  jobOne = await openJob(companyA);
  jobTwo = await openJob(companyA);
  jobB = await openJob(companyB);
  await post(`/api/v1/jobs/${jobOne}/parties`, TEST_SUPER_ADMIN_TOKEN, {
    role: "consignee",
    name: "Report Synthetic Ltd",
  });
  await post(`/api/v1/jobs/${jobOne}/references`, TEST_SUPER_ADMIN_TOKEN, {
    kind: "booking",
    value: "BKG-0042",
  });
  const first = await issuedInvoice(jobOne, 100_000);
  await issuedInvoice(jobTwo, 40_000);
  await post("/api/v1/payments", TEST_SUPER_ADMIN_TOKEN, {
    receivedOn: today(),
    method: "cash",
    totalMinor: 70_000,
    allocations: [{ invoiceId: first, amountMinor: 60_000 }],
  });
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("the job report covers each job in detail with invoices, totals and credit", async () => {
  const response = await call(
    `/api/v1/finance/job-reports?companyId=${companyA}`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(response.status, 200, await response.clone().text());
  const report = (await response.json()) as Report;
  assert.equal(report.company.name, "Report Synthetic Ltd");
  assert.deepEqual(
    report.jobs.map((item) => item.job.id),
    [jobOne, jobTwo],
  );
  const [one] = report.jobs;
  assert.deepEqual(one.parties, [
    { role: "consignee", name: "Report Synthetic Ltd" },
  ]);
  assert.deepEqual(one.references, [{ kind: "booking", value: "BKG-0042" }]);
  assert.ok(one.milestones.length > 0, "sea import steps are listed");
  assert.deepEqual(
    one.invoices.map((item) => [
      item.totalMinor,
      item.paidMinor,
      item.outstandingMinor,
    ]),
    [[100_000, 60_000, 40_000]],
  );
  assert.deepEqual(report.totals, [
    {
      currency: "GHS",
      invoicedMinor: 140_000,
      paidMinor: 60_000,
      outstandingMinor: 80_000,
    },
  ]);
  assert.deepEqual(report.credit, [
    { currency: "GHS", availableMinor: 10_000 },
  ]);

  // Narrowed to chosen jobs; a job of another customer is refused.
  const chosen = (await (
    await call(
      `/api/v1/finance/job-reports?companyId=${companyA}&jobIds=${jobTwo}`,
      TEST_SUPER_ADMIN_TOKEN,
    )
  ).json()) as Report;
  assert.deepEqual(
    chosen.jobs.map((item) => item.job.id),
    [jobTwo],
  );
  const foreign = await call(
    `/api/v1/finance/job-reports?companyId=${companyA}&jobIds=${jobB}`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(foreign.status, 404);
  const bad = await call(
    `/api/v1/finance/job-reports?companyId=${companyA}&jobIds=nope`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(bad.status, 400);
});

test("the PDF downloads for finance; reps and customers are refused", async () => {
  const pdf = await call(
    `/api/v1/finance/job-reports/pdf?companyId=${companyA}`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(
    pdf.headers.get("content-disposition") ?? "",
    /Job-report-Report-Synthetic-Ltd-/,
  );
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");

  for (const token of [TEST_MATCHING_TOKEN, TEST_CUSTOMER_A_TOKEN]) {
    const refused = await call(
      `/api/v1/finance/job-reports/pdf?companyId=${companyA}`,
      token,
    );
    assert.equal(refused.status, 403);
  }
});

test("finance emails the job report with the PDF attached; reps cannot", async () => {
  for (const token of [TEST_MATCHING_TOKEN, TEST_CUSTOMER_A_TOKEN]) {
    const refused = await post("/api/v1/finance/job-reports/send", token, {
      companyId: companyA,
    });
    assert.equal(refused.status, 403);
  }
  // Company B's only contact is switched off, so there is nobody to send to.
  const nobody = await post(
    "/api/v1/finance/job-reports/send",
    TEST_SUPER_ADMIN_TOKEN,
    { companyId: companyB },
  );
  assert.equal(nobody.status, 409);

  const sent = await post(
    "/api/v1/finance/job-reports/send",
    TEST_SUPER_ADMIN_TOKEN,
    { companyId: companyA, jobIds: jobOne },
  );
  assert.equal(sent.status, 201, await sent.clone().text());
  const email = application.get<RecordingEmailProvider>(EMAIL_PROVIDER);
  email.sent.length = 0;
  await application.get(NotificationDispatcher).dispatchDue();
  const mail = email.sent.find(
    (item) => item.subject === "Job report for Report Synthetic Ltd",
  );
  assert.ok(mail, "the report email was sent");
  assert.equal(mail.to, "report@example.test");
  assert.match(mail.text, /report on your job with us/);
  assert.equal(mail.attachments?.length, 1);
  assert.match(
    mail.attachments![0].filename,
    /^Job-report-Report-Synthetic-Ltd-.*\.pdf$/,
  );
  assert.equal(mail.attachments![0].content.subarray(0, 5).toString(), "%PDF-");
});

test("credit held on account has its own receipt PDF, for finance only", async () => {
  const credits = (await (
    await call(`/api/v1/credits?companyId=${companyA}`, TEST_SUPER_ADMIN_TOKEN)
  ).json()) as Array<{ id: string; receiptNumber: string }>;
  assert.equal(credits.length, 1);
  const [credit] = credits;
  const pdf = await call(
    `/api/v1/credits/${credit.id}/receipt`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(pdf.headers.get("content-disposition") ?? "", /SYN-RCT-/);
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");

  for (const token of [TEST_MATCHING_TOKEN, TEST_CUSTOMER_A_TOKEN]) {
    const refused = await call(`/api/v1/credits/${credit.id}/receipt`, token);
    assert.equal(refused.status, 403);
  }
  const missing = await call(
    `/api/v1/credits/${randomUUID()}/receipt`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(missing.status, 404);
});
