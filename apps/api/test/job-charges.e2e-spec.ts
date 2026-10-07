import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_CUSTOMER_B_ID,
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let jobA: string;
let jobB: string;
let companyA: string;
let companyB: string;

const pdf = (extra = "synthetic") =>
  Buffer.from(`%PDF-1.4\n% ${extra}\n%%EOF\n`, "latin1");

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

function upload(
  jobId: string,
  token: string,
  file: { name: string; bytes: Buffer; type?: string } | null,
  fields: Record<string, string> = {},
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) {
    form.append(
      "file",
      new Blob([new Uint8Array(file.bytes)], {
        type: file.type ?? "application/pdf",
      }),
      file.name,
    );
  }
  return call(`/api/v1/jobs/${jobId}/documents`, token, {
    method: "POST",
    body: form,
  });
}

async function openJob(companyId: string, serviceLine: string) {
  const response = await call("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    method: "POST",
    body: JSON.stringify({ customerCompanyId: companyId, serviceLine }),
  });
  return ((await response.json()) as { id: string }).id;
}

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
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "air_export_rep",
    TEST_SUPER_ADMIN_ID,
  );
  companyA = randomUUID();
  companyB = randomUUID();
  for (const [id, name] of [
    [companyA, "Northstar Synthetic Ltd"],
    [companyB, "Southwind Synthetic Ltd"],
  ]) {
    await database.createCustomer({
      id,
      companyName: name,
      createdAt: new Date().toISOString(),
      contacts: [],
    });
  }
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
  jobA = await openJob(companyA, "sea_import");
  jobB = await openJob(companyB, "sea_import");
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

function post(path: string, token: string, body: unknown) {
  return call(path, token, { method: "POST", body: JSON.stringify(body) });
}

const charges = (jobId: string, token = TEST_MATCHING_TOKEN) =>
  call(`/api/v1/jobs/${jobId}/charges`, token);

type Charge = {
  id: string;
  kind: string;
  description: string;
  currency: string;
  quantity: number;
  unitQuotedMinor: number | null;
  quoteContainerSize: string | null;
  quotedTotalMinor: number | null;
  varianceMinor: number | null;
  evidenceMissing: boolean;
  actuals: Array<{ id: string }>;
  currentActual: {
    id: string;
    amountMinor: number;
    currency: string;
    exchangeRate: string | null;
    convertedMinor: number | null;
    supplierDocumentId: string | null;
  } | null;
};
type Listing = {
  charges: Charge[];
  totals: Array<{
    currency: string;
    quotedMinor: number;
    actualMinor: number;
    chargesWithoutActual: number;
    disbursementsWithoutEvidence: number;
  }>;
};

async function supplierDocument(jobId: string, documentType: string) {
  const response = await upload(
    jobId,
    TEST_MATCHING_TOKEN,
    { name: `${documentType}.pdf`, bytes: pdf(randomUUID()) },
    { documentType },
  );
  return ((await response.json()) as { id: string }).id;
}

let serviceId: string;
let disbursementId: string;

test("staff add charges with a quoted amount; totals are per currency", async () => {
  const service = await post(
    `/api/v1/jobs/${jobA}/charges`,
    TEST_MATCHING_TOKEN,
    {
      kind: "service",
      description: "  BJH service fee  ",
      currency: "ghs",
      unitQuotedMinor: 150000,
    },
  );
  assert.equal(service.status, 201);
  const created = (await service.json()) as Charge;
  serviceId = created.id;
  assert.equal(created.description, "BJH service fee");
  assert.equal(created.currency, "GHS");
  assert.equal(created.quantity, 1);
  assert.equal(created.quotedTotalMinor, 150000);

  const disbursement = (await (
    await post(`/api/v1/jobs/${jobA}/charges`, TEST_MATCHING_TOKEN, {
      kind: "disbursement",
      description: "Terminal handling",
      currency: "GHS",
      quantity: 2,
      unitQuotedMinor: 25000,
    })
  ).json()) as Charge;
  disbursementId = disbursement.id;
  assert.equal(disbursement.quotedTotalMinor, 50000);

  const listing = (await (await charges(jobA)).json()) as Listing;
  assert.equal(listing.charges.length, 2);
  assert.deepEqual(listing.totals, [
    {
      currency: "GHS",
      quotedMinor: 200000,
      actualMinor: 0,
      chargesWithoutActual: 2,
      disbursementsWithoutEvidence: 0,
    },
  ]);
});

test("an actual in the charge currency shows the variance against the quote", async () => {
  const response = await post(
    `/api/v1/jobs/${jobA}/charges/${serviceId}/actuals`,
    TEST_MATCHING_TOKEN,
    { amountMinor: 160000, currency: "GHS", note: "Extra handling" },
  );
  assert.equal(response.status, 201);
  const actual = (await response.json()) as Charge["currentActual"];
  assert.equal(actual?.convertedMinor, 160000);
  assert.equal(actual?.exchangeRate, null);

  const listing = (await (await charges(jobA)).json()) as Listing;
  const service = listing.charges.find((item) => item.id === serviceId)!;
  assert.equal(service.currentActual?.amountMinor, 160000);
  assert.equal(service.varianceMinor, 10000);
  assert.equal(service.evidenceMissing, false);
});

test("actuals are recorded in GHS; corrections keep history and can add the evidence", async () => {
  const first = await post(
    `/api/v1/jobs/${jobA}/charges/${disbursementId}/actuals`,
    TEST_MATCHING_TOKEN,
    { amountMinor: 381250, currency: "ghs", note: "Paid at the terminal" },
  );
  assert.equal(first.status, 201);
  const entry = (await first.json()) as NonNullable<Charge["currentActual"]>;
  assert.equal(entry.currency, "GHS");
  assert.equal(entry.exchangeRate, null);
  assert.equal(entry.convertedMinor, 381250);

  let listing = (await (await charges(jobA)).json()) as Listing;
  let disbursement = listing.charges.find(
    (item) => item.id === disbursementId,
  )!;
  assert.equal(disbursement.evidenceMissing, true);
  assert.equal(disbursement.varianceMinor, 381250 - 50000);
  assert.equal(listing.totals[0].disbursementsWithoutEvidence, 1);

  const invoiceId = await supplierDocument(jobA, "supplier_invoice");
  const correction = await post(
    `/api/v1/jobs/${jobA}/charges/${disbursementId}/actuals`,
    TEST_MATCHING_TOKEN,
    {
      amountMinor: 372000,
      currency: "GHS",
      supplierDocumentId: invoiceId,
      correctionOf: entry.id,
    },
  );
  assert.equal(correction.status, 201);

  listing = (await (await charges(jobA)).json()) as Listing;
  disbursement = listing.charges.find((item) => item.id === disbursementId)!;
  assert.equal(disbursement.actuals.length, 2);
  assert.equal(disbursement.actuals[0].id, entry.id);
  assert.equal(disbursement.currentActual?.convertedMinor, 372000);
  assert.equal(disbursement.currentActual?.supplierDocumentId, invoiceId);
  assert.equal(disbursement.evidenceMissing, false);
  assert.equal(listing.totals[0].actualMinor, 160000 + 372000);
  assert.equal(listing.totals[0].disbursementsWithoutEvidence, 0);
});

test("a GHS actual on a USD-quoted charge is kept without conversion", async () => {
  const usdCharge = (await (
    await post(`/api/v1/jobs/${jobB}/charges`, TEST_MATCHING_TOKEN, {
      kind: "disbursement",
      description: "Ocean freight",
      currency: "USD",
      unitQuotedMinor: 120000,
    })
  ).json()) as Charge;
  const recorded = await post(
    `/api/v1/jobs/${jobB}/charges/${usdCharge.id}/actuals`,
    TEST_MATCHING_TOKEN,
    { amountMinor: 1850000, currency: "GHS" },
  );
  assert.equal(recorded.status, 201);

  const listing = (await (await charges(jobB)).json()) as Listing;
  const charge = listing.charges.find((item) => item.id === usdCharge.id)!;
  assert.equal(charge.currentActual?.amountMinor, 1850000);
  assert.equal(charge.currentActual?.currency, "GHS");
  assert.equal(charge.currentActual?.convertedMinor, null);
  assert.equal(charge.varianceMinor, null);
  assert.deepEqual(
    listing.totals.map((total) => [total.currency, total.actualMinor]),
    [["USD", 0]],
  );
});

test("invalid actual amounts are rejected", async () => {
  const path = `/api/v1/jobs/${jobA}/charges/${serviceId}/actuals`;
  const otherJobDoc = await supplierDocument(jobB, "supplier_invoice");
  const wrongTypeDoc = await supplierDocument(jobA, "commercial_invoice");
  const cases: Array<[Record<string, unknown>, number, string]> = [
    [
      { currency: "GHS" },
      400,
      "amountMinor must be a whole number of minor units",
    ],
    [
      { amountMinor: -1, currency: "GHS" },
      400,
      "amountMinor cannot be negative",
    ],
    [
      { amountMinor: 1.5, currency: "GHS" },
      400,
      "amountMinor must be a whole number of minor units",
    ],
    [
      { amountMinor: 100, currency: "cedis" },
      400,
      "currency must be a 3-letter code such as USD or GHS",
    ],
    [
      { amountMinor: 100, currency: "USD" },
      400,
      "Record actual amounts in GHS",
    ],
    [
      { amountMinor: 100, currency: "GHS", exchangeRate: "15" },
      400,
      "Exchange rates are not recorded here",
    ],
    [
      { amountMinor: 100, currency: "GHS", supplierDocumentId: otherJobDoc },
      400,
      "supplierDocumentId must be a supplier invoice or disbursement evidence on this job",
    ],
    [
      { amountMinor: 100, currency: "GHS", supplierDocumentId: wrongTypeDoc },
      400,
      "supplierDocumentId must be a supplier invoice or disbursement evidence on this job",
    ],
    [
      { amountMinor: 100, currency: "GHS", correctionOf: randomUUID() },
      404,
      "The amount being corrected was not found on this charge",
    ],
  ];
  for (const [body, status, message] of cases) {
    const response = await post(path, TEST_MATCHING_TOKEN, body);
    assert.equal(response.status, status, message);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      message,
    );
  }
  const missing = await post(
    `/api/v1/jobs/${jobA}/charges/${randomUUID()}/actuals`,
    TEST_MATCHING_TOKEN,
    { amountMinor: 1, currency: "GHS" },
  );
  assert.equal(missing.status, 404);
  const listing = (await (await charges(jobA)).json()) as Listing;
  assert.equal(
    listing.charges.find((item) => item.id === serviceId)!.actuals.length,
    1,
  );
});

test("invalid charges are rejected; a charge without an actual can be removed", async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{}, "kind must be one of service, disbursement"],
    [{ kind: "service", currency: "GHS" }, "description is required"],
    [{ kind: "service", description: "x" }, "currency is required"],
    [
      { kind: "service", description: "x", currency: "GHS", quantity: 0 },
      "quantity must be 1 to 10000",
    ],
    [
      {
        kind: "service",
        description: "x",
        currency: "GHS",
        unitQuotedMinor: -5,
      },
      "unitQuotedMinor cannot be negative",
    ],
  ];
  for (const [body, message] of cases) {
    const response = await post(
      `/api/v1/jobs/${jobA}/charges`,
      TEST_MATCHING_TOKEN,
      body,
    );
    assert.equal(response.status, 400, message);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      message,
    );
  }

  const spare = (await (
    await post(`/api/v1/jobs/${jobA}/charges`, TEST_MATCHING_TOKEN, {
      kind: "service",
      description: "Added by mistake",
      currency: "GHS",
    })
  ).json()) as Charge;
  const removed = await call(
    `/api/v1/jobs/${jobA}/charges/${spare.id}`,
    TEST_MATCHING_TOKEN,
    { method: "DELETE" },
  );
  assert.equal(removed.status, 200);
  const blocked = await call(
    `/api/v1/jobs/${jobA}/charges/${serviceId}`,
    TEST_MATCHING_TOKEN,
    { method: "DELETE" },
  );
  assert.equal(blocked.status, 409);
  const again = await call(
    `/api/v1/jobs/${jobA}/charges/${spare.id}`,
    TEST_MATCHING_TOKEN,
    { method: "DELETE" },
  );
  assert.equal(again.status, 404);
  const listing = (await (await charges(jobA)).json()) as Listing;
  assert.equal(listing.charges.length, 2);
});

test("charges import from the accepted quote and repeating the import adds nothing", async () => {
  const quote = (await (
    await post("/api/v1/quotes", TEST_MATCHING_TOKEN, {
      customerCompanyId: companyA,
      serviceLine: "sea_import",
      version: {
        currency: "GHS",
        title: "Synthetic quotation",
        procedureSteps: [],
        requiredDocuments: [],
        terms: [],
        sizeLabels: ["20ft", "40ft", "50ft"],
        lines: [
          {
            description: "Terminal fees",
            basis: "at_cost",
            sizeAmountsMinor: [240000, 480000, 620000],
          },
          {
            description: "BJH service fee",
            basis: "fixed",
            amountMinor: 150000,
          },
          { description: "Customs duty", basis: "at_cost" },
        ],
      },
    })
  ).json()) as { id: string };
  await post(`/api/v1/quotes/${quote.id}/issue`, TEST_MATCHING_TOKEN, {});
  const accepted = (await (
    await post(`/api/v1/quotes/${quote.id}/decision`, TEST_MATCHING_TOKEN, {
      versionNumber: 1,
      decision: "accepted",
      clientSignatory: "A. Client",
    })
  ).json()) as { job: { id: string } };
  const jobId = accepted.job.id;

  const noSize = await post(
    `/api/v1/jobs/${jobId}/charges/import-from-quote`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(noSize.status, 400);
  assert.equal(
    ((await noSize.json()) as { message: string }).message,
    "containerSize (20ft or 40ft or 50ft) is required: this quote prices by container size",
  );

  const imported = (await (
    await post(
      `/api/v1/jobs/${jobId}/charges/import-from-quote`,
      TEST_MATCHING_TOKEN,
      {
        containerSize: "50ft",
        quantity: 2,
      },
    )
  ).json()) as { created: Charge[]; skipped: number };
  assert.equal(imported.created.length, 3);
  assert.equal(imported.skipped, 0);
  assert.deepEqual(
    imported.created.map((item) => [
      item.description,
      item.kind,
      item.currency,
      item.unitQuotedMinor,
      item.quoteContainerSize,
    ]),
    [
      ["Terminal fees", "disbursement", "GHS", 620000, "50ft"],
      ["BJH service fee", "service", "GHS", 150000, null],
      ["Customs duty", "disbursement", "GHS", null, null],
    ],
  );
  // Only per-container lines carry the container count; this is "at cost".
  assert.equal(imported.created[0].quantity, 1);
  assert.equal(imported.created[0].quotedTotalMinor, 620000);

  const otherSize = (await (
    await post(
      `/api/v1/jobs/${jobId}/charges/import-from-quote`,
      TEST_MATCHING_TOKEN,
      {
        containerSize: "20ft",
      },
    )
  ).json()) as { created: Charge[]; skipped: number };
  assert.equal(otherSize.created.length, 1);
  assert.equal(otherSize.skipped, 2);
  assert.equal(otherSize.created[0].unitQuotedMinor, 240000);
  assert.equal(otherSize.created[0].quoteContainerSize, "20ft");
  assert.equal(otherSize.created[0].quantity, 1);

  const repeatedSize = (await (
    await post(
      `/api/v1/jobs/${jobId}/charges/import-from-quote`,
      TEST_MATCHING_TOKEN,
      { containerSize: "20ft" },
    )
  ).json()) as { created: Charge[]; skipped: number };
  assert.equal(repeatedSize.created.length, 0);
  assert.equal(repeatedSize.skipped, 3);
  const listing = (await (await charges(jobId)).json()) as Listing;
  assert.equal(listing.charges.length, 4);
  assert.equal(listing.totals[0].quotedMinor, 1010000);

  const notFromQuote = await post(
    `/api/v1/jobs/${jobA}/charges/import-from-quote`,
    TEST_MATCHING_TOKEN,
    { containerSize: "20ft" },
  );
  assert.equal(notFromQuote.status, 409);
});

test("access boundaries: other departments, customers and anonymous callers", async () => {
  assert.equal((await charges(jobA, TEST_UNASSIGNED_TOKEN)).status, 404);
  const wrongDepartmentWrite = await post(
    `/api/v1/jobs/${jobA}/charges`,
    TEST_UNASSIGNED_TOKEN,
    { kind: "service", description: "x", currency: "GHS" },
  );
  assert.equal(wrongDepartmentWrite.status, 404);
  const wrongDepartmentActual = await post(
    `/api/v1/jobs/${jobA}/charges/${serviceId}/actuals`,
    TEST_UNASSIGNED_TOKEN,
    { amountMinor: 1, currency: "GHS" },
  );
  assert.equal(wrongDepartmentActual.status, 404);

  // Costing is internal: even the owning customer cannot read or change it.
  assert.equal((await charges(jobA, TEST_CUSTOMER_A_TOKEN)).status, 403);
  const customerWrite = await post(
    `/api/v1/jobs/${jobA}/charges`,
    TEST_CUSTOMER_A_TOKEN,
    { kind: "service", description: "x", currency: "GHS" },
  );
  assert.equal(customerWrite.status, 403);
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/jobs/${jobA}/charges`)).status,
    401,
  );
  assert.equal(
    (await charges(randomUUID(), TEST_SUPER_ADMIN_TOKEN)).status,
    404,
  );

  // Closed jobs are read-only until reopened.
  const cancelled = await post(
    `/api/v1/jobs/${jobB}/status`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      status: "cancelled",
      reason: "Customer withdrew",
    },
  );
  assert.equal(cancelled.status, 201);
  const onCancelled = await post(
    `/api/v1/jobs/${jobB}/charges`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      kind: "service",
      description: "x",
      currency: "GHS",
    },
  );
  assert.equal(onCancelled.status, 409);
  assert.equal((await charges(jobB, TEST_SUPER_ADMIN_TOKEN)).status, 200);
});

test("once settings exist, charges use the configured currencies", async () => {
  const saved = await call("/api/v1/settings", TEST_SUPER_ADMIN_TOKEN, {
    method: "PUT",
    body: JSON.stringify({
      issuer: { name: "Synthetic Ltd" },
      currencies: ["GHS", "USD"],
      numbering: {
        quotePrefix: "S/Q",
        invoicePrefix: "S/I",
        receiptPrefix: "S/R",
      },
    }),
  });
  assert.equal(saved.status, 200);
  const refused = await post(
    `/api/v1/jobs/${jobA}/charges`,
    TEST_MATCHING_TOKEN,
    {
      kind: "service",
      description: "x",
      currency: "EUR",
    },
  );
  assert.equal(refused.status, 400);
  assert.equal(
    ((await refused.json()) as { message: string }).message,
    "currency must be one of the configured currencies: GHS, USD",
  );
  const foreign = await post(
    `/api/v1/jobs/${jobA}/charges/${serviceId}/actuals`,
    TEST_MATCHING_TOKEN,
    { amountMinor: 100, currency: "EUR", exchangeRate: "16" },
  );
  assert.equal(foreign.status, 400);
});
