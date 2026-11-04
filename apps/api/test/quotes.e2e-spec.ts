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
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let companyA: string;
let companyB: string;

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

function post(path: string, token: string, body: unknown) {
  return call(path, token, { method: "POST", body: JSON.stringify(body) });
}

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "customer_service_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "export_rep",
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
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

function put(path: string, token: string, body: unknown) {
  return call(path, token, { method: "PUT", body: JSON.stringify(body) });
}

const version = (overrides: Record<string, unknown> = {}) => ({
  currency: "usd",
  title: "Sea freight clearance quotation",
  subtitle: "Full container load, general cargo",
  shipmentScope: "20ft FCL / 40ft FCL",
  intro: "  Synthetic introduction.  ",
  procedureSteps: ["Document review", "Customs declaration"],
  requiredDocuments: ["Commercial invoice", "Packing list"],
  timeline: "3 to 5 business days",
  terms: ["Duties are charged at cost."],
  sizeLabels: ["20ft", "40ft", "50ft"],
  lines: [
    {
      section: "Clearance and delivery charges",
      description: "Port handling fee",
      details: "Covers terminal handling and gate-in",
      basis: "at_cost",
      sizeAmountsMinor: [25000, 50000, 62000],
    },
    {
      section: "Clearance and delivery charges",
      description: "Documentation",
      basis: "per_bl",
      sizeAmountsMinor: [12000, 12000, 15000],
    },
    {
      section: "Clearance and delivery charges",
      description: "Customs duty and taxes",
      basis: "at_cost",
      basisNote: "Based on HS code and CIF value",
    },
    {
      section: "Inland transportation",
      description: "Tema to Accra",
      basis: "fixed",
      amountMinor: 380000,
    },
  ],
  ...overrides,
});

type QuoteBody = {
  id: string;
  quoteNumber: string | null;
  serviceLine: string;
  versions: Array<{
    versionNumber: number;
    status: string;
    currency: string;
    sizeLabels: string[];
    intro: string | null;
    issuedBy: string | null;
    lines: Array<Record<string, unknown>>;
  }>;
};

let quoteId: string;
let draftOnlyQuoteId: string;

async function createQuote(token: string, overrides: Record<string, unknown>) {
  return post("/api/v1/quotes", token, {
    customerCompanyId: companyA,
    serviceLine: "sea_import",
    version: version(),
    ...overrides,
  });
}

test("a rep prepares a quote with its own container sizes and prices", async () => {
  const response = await createQuote(TEST_MATCHING_TOKEN, {});
  assert.equal(response.status, 201);
  const quote = (await response.json()) as QuoteBody;
  quoteId = quote.id;
  assert.equal(quote.quoteNumber, null);
  assert.equal(quote.versions.length, 1);
  const [first] = quote.versions;
  assert.equal(first.versionNumber, 1);
  assert.equal(first.status, "draft");
  assert.equal(first.currency, "USD");
  assert.deepEqual(first.sizeLabels, ["20ft", "40ft", "50ft"]);
  assert.equal(first.intro, "Synthetic introduction.");
  assert.deepEqual(
    first.lines.map((line) => [
      line.section,
      line.description,
      line.basis,
      line.amountMinor,
      line.sizeAmountsMinor,
      line.basisNote,
    ]),
    [
      [
        "Clearance and delivery charges",
        "Port handling fee",
        "at_cost",
        null,
        [25000, 50000, 62000],
        null,
      ],
      [
        "Clearance and delivery charges",
        "Documentation",
        "per_bl",
        null,
        [12000, 12000, 15000],
        null,
      ],
      [
        "Clearance and delivery charges",
        "Customs duty and taxes",
        "at_cost",
        null,
        null,
        "Based on HS code and CIF value",
      ],
      ["Inland transportation", "Tema to Accra", "fixed", 380000, null, null],
    ],
  );
  assert.deepEqual(
    first.lines.map((line) => line.details),
    ["Covers terminal handling and gate-in", null, null, null],
  );
});

test("a draft can be edited in place; invalid content is rejected", async () => {
  const edited = await put(
    `/api/v1/quotes/${quoteId}/draft`,
    TEST_MATCHING_TOKEN,
    version({ title: "Revised title", lines: [version().lines[3]] }),
  );
  assert.equal(edited.status, 200);
  const quote = (await edited.json()) as QuoteBody & {
    versions: Array<{ title: string }>;
  };
  assert.equal(quote.versions.length, 1);
  assert.equal(quote.versions[0].title, "Revised title");
  assert.equal(quote.versions[0].lines.length, 1);

  const line = (over: Record<string, unknown>) => ({
    description: "Charge",
    basis: "fixed",
    amountMinor: 100,
    ...over,
  });
  const cases: Array<[Record<string, unknown>, string]> = [
    [
      { currency: "dollars" },
      "currency must be a 3-letter code such as USD or GHS",
    ],
    [{ title: " " }, "title must contain 1 to 200 characters"],
    [
      { lines: [line({ basis: "hourly" })] },
      "basis must be one of fixed, per_bl, per_container, at_cost",
    ],
    [
      { lines: [line({ amountMinor: null })] },
      "Only at-cost lines can leave the amount out",
    ],
    [
      { lines: [line({ amountMinor: 12.5 })] },
      "amountMinor must be a whole number of minor units",
    ],
    [{ lines: [line({ amountMinor: -1 })] }, "amountMinor cannot be negative"],
    [
      { lines: [line({ amountMinor: undefined, sizeAmountsMinor: [5] })] },
      "Give one amount for each size column, or use one amount",
    ],
    [
      { lines: [line({ amountMinor: 100, sizeAmountsMinor: [5, 6, 7] })] },
      "Use either one amount or an amount per size, not both",
    ],
    [
      { lines: [line({ description: "" })] },
      "description must contain 1 to 300 characters",
    ],
  ];
  for (const [over, message] of cases) {
    const response = await put(
      `/api/v1/quotes/${quoteId}/draft`,
      TEST_MATCHING_TOKEN,
      version(over),
    );
    assert.equal(response.status, 400, message);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      message,
    );
  }
  const empty = await createQuote(TEST_MATCHING_TOKEN, { version: [] });
  assert.equal(empty.status, 400);
});

test("issuing needs a charge line, numbers the quote and freezes the version", async () => {
  const noLines = await createQuote(TEST_MATCHING_TOKEN, {
    version: version({ lines: [] }),
  });
  assert.equal(noLines.status, 201);
  const noLinesId = ((await noLines.json()) as QuoteBody).id;
  const refused = await post(
    `/api/v1/quotes/${noLinesId}/issue`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(refused.status, 400);

  const issued = await post(
    `/api/v1/quotes/${quoteId}/issue`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(issued.status, 201);
  const quote = (await issued.json()) as QuoteBody;
  assert.match(
    String(quote.quoteNumber),
    new RegExp(`^BJH/Q/SI/${new Date().getUTCFullYear()}/0001$`),
  );
  assert.equal(quote.versions[0].status, "issued");
  assert.equal(quote.versions[0].issuedBy, TEST_MATCHING_USER_ID);

  const again = await post(
    `/api/v1/quotes/${quoteId}/issue`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(again.status, 409);
  const edit = await put(
    `/api/v1/quotes/${quoteId}/draft`,
    TEST_MATCHING_TOKEN,
    version(),
  );
  assert.equal(edit.status, 409);
});

test("a change after issue is a new version; the issued one stays as sent", async () => {
  const started = await post(
    `/api/v1/quotes/${quoteId}/versions`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(started.status, 201);
  const quote = (await started.json()) as QuoteBody & {
    versions: Array<{ title: string }>;
  };
  assert.equal(quote.versions.length, 2);
  assert.equal(quote.versions[1].versionNumber, 2);
  assert.equal(quote.versions[1].status, "draft");
  assert.equal(quote.versions[1].title, "Revised title");
  assert.deepEqual(
    quote.versions[1].lines.map((line) => line.description),
    ["Tema to Accra"],
  );

  const second = await post(
    `/api/v1/quotes/${quoteId}/versions`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(second.status, 409);

  const edited = await put(
    `/api/v1/quotes/${quoteId}/draft`,
    TEST_MATCHING_TOKEN,
    version({ title: "Second version" }),
  );
  assert.equal(edited.status, 200);
  const issued = (await (
    await post(`/api/v1/quotes/${quoteId}/issue`, TEST_MATCHING_TOKEN, {})
  ).json()) as QuoteBody & { versions: Array<{ title: string }> };
  assert.match(String(issued.quoteNumber), /\/0001$/);
  assert.equal(issued.versions[0].title, "Revised title");
  assert.equal(issued.versions[1].title, "Second version");
  assert.equal(issued.versions[1].status, "issued");
});

test("the next quote in the same line and year gets the next number", async () => {
  const created = await createQuote(TEST_MATCHING_TOKEN, {});
  draftOnlyQuoteId = ((await created.json()) as QuoteBody).id;
  const other = await createQuote(TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyB,
  });
  const otherId = ((await other.json()) as QuoteBody).id;
  const issued = (await (
    await post(`/api/v1/quotes/${otherId}/issue`, TEST_SUPER_ADMIN_TOKEN, {})
  ).json()) as QuoteBody;
  assert.match(String(issued.quoteNumber), /\/0002$/);
});

test("customers see only issued versions of their own company's quotes", async () => {
  const own = (await (
    await call("/api/v1/quotes", TEST_CUSTOMER_A_TOKEN)
  ).json()) as Array<{ id: string; latestStatus: string }>;
  assert.deepEqual(
    own.map((item) => item.id),
    [quoteId],
  );
  assert.equal(own[0].latestStatus, "issued");

  const draftOnly = await call(
    `/api/v1/quotes/${draftOnlyQuoteId}`,
    TEST_CUSTOMER_A_TOKEN,
  );
  assert.equal(draftOnly.status, 404);

  // A new draft version on an issued quote stays hidden from the customer.
  await post(`/api/v1/quotes/${quoteId}/versions`, TEST_MATCHING_TOKEN, {});
  const detail = (await (
    await call(`/api/v1/quotes/${quoteId}`, TEST_CUSTOMER_A_TOKEN)
  ).json()) as QuoteBody;
  assert.deepEqual(
    detail.versions.map((item) => [item.versionNumber, item.status]),
    [
      [1, "issued"],
      [2, "issued"],
    ],
  );
  const staffDetail = (await (
    await call(`/api/v1/quotes/${quoteId}`, TEST_SUPER_ADMIN_TOKEN)
  ).json()) as QuoteBody;
  assert.equal(staffDetail.versions.length, 3);
  assert.equal(staffDetail.versions[2].status, "draft");

  const otherCompany = await call(
    `/api/v1/quotes/${quoteId}`,
    TEST_CUSTOMER_B_TOKEN,
  );
  assert.equal(otherCompany.status, 404);
  assert.deepEqual(
    (await (await call("/api/v1/quotes", TEST_CUSTOMER_B_TOKEN)).json())
      .map((item: { id: string }) => item.id)
      .includes(quoteId),
    false,
  );
});

test("the super admin sees every quote and draft; reps see their own line", async () => {
  const all = (await (
    await call("/api/v1/quotes", TEST_SUPER_ADMIN_TOKEN)
  ).json()) as Array<{ id: string }>;
  assert.equal(all.length, 4);
  const ownLine = (await (
    await call("/api/v1/quotes", TEST_MATCHING_TOKEN)
  ).json()) as Array<{ id: string }>;
  assert.equal(ownLine.length, 4);
  const otherLine = (await (
    await call("/api/v1/quotes", TEST_UNASSIGNED_TOKEN)
  ).json()) as unknown[];
  assert.deepEqual(otherLine, []);
});

test("access boundaries: other departments, customers and anonymous callers", async () => {
  const wrongLineCreate = await createQuote(TEST_UNASSIGNED_TOKEN, {});
  assert.equal(wrongLineCreate.status, 403);
  for (const [method, path] of [
    ["GET", `/api/v1/quotes/${quoteId}`],
    ["POST", `/api/v1/quotes/${quoteId}/versions`],
    ["POST", `/api/v1/quotes/${quoteId}/issue`],
    ["PUT", `/api/v1/quotes/${quoteId}/draft`],
  ] as const) {
    const response = await call(path, TEST_UNASSIGNED_TOKEN, {
      method,
      body: method === "GET" ? undefined : JSON.stringify(version()),
    });
    // Reps may work quotes (Evans, 2026-11-03), but only on their own
    // service line: another line's quote is not found, for reads and writes.
    assert.equal(response.status, 404, `${method} ${path}`);
  }
  for (const [method, path] of [
    ["POST", "/api/v1/quotes"],
    ["POST", `/api/v1/quotes/${quoteId}/versions`],
    ["POST", `/api/v1/quotes/${quoteId}/issue`],
    ["PUT", `/api/v1/quotes/${quoteId}/draft`],
  ] as const) {
    const response = await call(path, TEST_CUSTOMER_A_TOKEN, {
      method,
      body: JSON.stringify(version()),
    });
    assert.equal(response.status, 403, `customer ${method} ${path}`);
  }
  assert.equal((await fetch(`${baseUrl}/api/v1/quotes`)).status, 401);
  const missing = await call(
    `/api/v1/quotes/${randomUUID()}`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(missing.status, 404);
  const unknownCustomer = await createQuote(TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: randomUUID(),
  });
  assert.equal(unknownCustomer.status, 404);
});
