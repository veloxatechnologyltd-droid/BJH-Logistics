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
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let companyA: string;
let companyB: string;
let companyC: string;
let jobA: string;
let documentA: string;
let quoteA: string;
let invoiceA: string;
let deliveryA: string;
let requestA: string;

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
  [companyA, companyB, companyC] = [randomUUID(), randomUUID(), randomUUID()];
  for (const [id, name] of [
    [companyA, "Northstar Synthetic Ltd"],
    [companyB, "Southwind Synthetic Ltd"],
    [companyC, "Eastgate Synthetic Ltd"],
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

  // One of every resource on company A's side.
  jobA = (
    await json<{ id: string }>(
      await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
        customerCompanyId: companyA,
        serviceLine: "sea_import",
      }),
    )
  ).id;
  const path = `/api/v1/jobs/${jobA}`;
  await post(`${path}/parties`, TEST_MATCHING_TOKEN, {
    role: "shipper",
    name: "Synthetic Shipper",
  });
  await post(`${path}/references`, TEST_MATCHING_TOKEN, {
    kind: "booking",
    value: "BK-PORTAL-1",
  });
  await post(`${path}/milestones`, TEST_MATCHING_TOKEN, {
    milestoneKey: "cargo_arrived",
  });
  await post(`${path}/eta`, TEST_MATCHING_TOKEN, {
    etaAt: "2026-10-05T06:00:00Z",
    source: "manual",
  });
  const form = new FormData();
  form.append("documentType", "other");
  form.append(
    "file",
    new Blob(
      [new Uint8Array(Buffer.from(`%PDF-1.4\n% ${randomUUID()}\n%%EOF\n`))],
      {
        type: "application/pdf",
      },
    ),
    "doc.pdf",
  );
  documentA = (
    await json<{ id: string }>(
      await call(`${path}/documents`, TEST_MATCHING_TOKEN, {
        method: "POST",
        body: form,
      }),
    )
  ).id;
  const driver = await json<{ id: string }>(
    await post("/api/v1/drivers", TEST_MATCHING_TOKEN, {
      name: "Kofi",
      phone: "000",
    }),
  );
  const vehicle = await json<{ id: string }>(
    await post("/api/v1/vehicles", TEST_MATCHING_TOKEN, {
      registration: "GX 1-26",
    }),
  );
  deliveryA = (
    await json<{ id: string }>(
      await post(`${path}/deliveries`, TEST_MATCHING_TOKEN, {
        driverId: driver.id,
        vehicleId: vehicle.id,
        cargoDescription: "Goods",
        deliveryAddress: "1 Test Road",
      }),
    )
  ).id;
  const invoice = await json<{ id: string }>(
    await post(`${path}/invoices`, TEST_MATCHING_TOKEN, {
      currency: "GHS",
      lines: [{ description: "Fee", amountMinor: 10000 }],
    }),
  );
  invoiceA = invoice.id;
  await call("/api/v1/settings", TEST_SUPER_ADMIN_TOKEN, {
    method: "PUT",
    body: JSON.stringify({
      issuer: { name: "Synthetic Forwarding Ltd" },
      currencies: ["GHS"],
      numbering: {
        quotePrefix: "SYN/Q",
        invoicePrefix: "SYN/INV",
        receiptPrefix: "SYN/RCT",
      },
      quoteDefaults: {},
    }),
  });
  await post(`${path}/invoices/${invoiceA}/issue`, TEST_MATCHING_TOKEN, {});
  quoteA = (
    await json<{ id: string }>(
      await post("/api/v1/quotes", TEST_MATCHING_TOKEN, {
        customerCompanyId: companyA,
        serviceLine: "sea_import",
        version: {
          currency: "GHS",
          title: "Quote",
          procedureSteps: [],
          requiredDocuments: [],
          terms: [],
          lines: [{ description: "Fee", basis: "fixed", amountMinor: 1000 }],
        },
      }),
    )
  ).id;
  await post(`/api/v1/quotes/${quoteA}/issue`, TEST_MATCHING_TOKEN, {});
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("a customer account gets a session listing its companies; an unlinked user gets none", async () => {
  const customer = await get("/api/v1/auth/session", TEST_CUSTOMER_A_TOKEN);
  assert.equal(customer.status, 200);
  assert.deepEqual(await customer.json(), {
    userId: TEST_CUSTOMER_A_ID,
    email: "customer-a@example.test",
    roles: [],
    mustChangePassword: false,
    twoFactorRequired: false,
    companies: [
      { companyId: companyA, companyName: "Northstar Synthetic Ltd" },
    ],
  });
  assert.equal(
    (await get("/api/v1/auth/session", TEST_UNASSIGNED_TOKEN)).status,
    403,
  );
  assert.equal(
    (await get("/api/v1/auth/session", TEST_MATCHING_TOKEN)).status,
    200,
  );
});

test("a customer sends a quote request as their own company", async () => {
  const cases: Array<[Record<string, unknown>, number, string]> = [
    [{ message: "x" }, 400, "contactName is required"],
    [{ contactName: "Ama" }, 400, "message is required"],
    [
      { contactName: "Ama", message: "x", companyId: "nope" },
      400,
      "companyId must be a valid ID",
    ],
    [
      { contactName: "Ama", message: "x", companyId: companyB },
      404,
      "Customer company was not found",
    ],
  ];
  for (const [body, status, expected] of cases) {
    const response = await post(
      "/api/v1/quote-requests/mine",
      TEST_CUSTOMER_A_TOKEN,
      body,
    );
    assert.equal(response.status, status, expected);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      expected,
    );
  }

  const created = await post(
    "/api/v1/quote-requests/mine",
    TEST_CUSTOMER_A_TOKEN,
    {
      contactName: "  Ama Synthetic ",
      message: "Please quote 2 x 40ft from Tema.",
      // The company and email are the account's, whatever the body claims.
      companyName: "Somebody Else Ltd",
      email: "spoof@example.test",
    },
  );
  assert.equal(created.status, 201);
  const request = await json<{
    id: string;
    companyName: string;
    contactName: string;
    email: string;
    customerCompanyId: string;
    customerCompanyName: string;
  }>(created);
  requestA = request.id;
  assert.equal(request.companyName, "Northstar Synthetic Ltd");
  assert.equal(request.contactName, "Ama Synthetic");
  assert.equal(request.email, "customer-a@example.test");
  assert.equal(request.customerCompanyId, companyA);

  // Staff see it linked to the company; the other customer never does.
  assert.equal(
    (await get(`/api/v1/quote-requests/${requestA}`, TEST_MATCHING_TOKEN))
      .status,
    200,
  );
  const ownList = await json<Array<{ id: string }>>(
    await get("/api/v1/quote-requests", TEST_CUSTOMER_A_TOKEN),
  );
  assert.deepEqual(
    ownList.map((item) => item.id),
    [requestA],
  );
  assert.deepEqual(
    await json<unknown[]>(
      await get("/api/v1/quote-requests", TEST_CUSTOMER_B_TOKEN),
    ),
    [],
  );
  assert.equal(
    (await get(`/api/v1/quote-requests/${requestA}`, TEST_CUSTOMER_B_TOKEN))
      .status,
    404,
  );

  // Staff use the staff endpoint, not the customer one.
  assert.equal(
    (
      await post("/api/v1/quote-requests/mine", TEST_MATCHING_TOKEN, {
        contactName: "x",
        message: "x",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post("/api/v1/quote-requests/mine", TEST_UNASSIGNED_TOKEN, {
        contactName: "x",
        message: "x",
      })
    ).status,
    403,
  );
});

test("a customer with several companies must say which one", async () => {
  await application
    .get(DatabasePort)
    .grantCustomerMembership(companyC, TEST_CUSTOMER_A_ID, TEST_SUPER_ADMIN_ID);
  const ambiguous = await post(
    "/api/v1/quote-requests/mine",
    TEST_CUSTOMER_A_TOKEN,
    {
      contactName: "Ama",
      message: "x",
    },
  );
  assert.equal(ambiguous.status, 400);
  assert.match(
    ((await ambiguous.json()) as { message: string }).message,
    /companyId is required/,
  );
  const chosen = await post(
    "/api/v1/quote-requests/mine",
    TEST_CUSTOMER_A_TOKEN,
    {
      contactName: "Ama",
      message: "x",
      companyId: companyC,
    },
  );
  assert.equal(chosen.status, 201);
  assert.equal(
    (await json<{ customerCompanyId: string }>(chosen)).customerCompanyId,
    companyC,
  );
  await application
    .get(DatabasePort)
    .revokeCustomerMembership(
      companyC,
      TEST_CUSTOMER_A_ID,
      TEST_SUPER_ADMIN_ID,
    );
});

test("every resource of company A answers company A and denies company B by known ID", async () => {
  const job = `/api/v1/jobs/${jobA}`;
  const reads = [
    job,
    `${job}/milestones`,
    `${job}/status-history`,
    `${job}/parties`,
    `${job}/references`,
    `${job}/eta`,
    `${job}/documents`,
    `${job}/documents/${documentA}/download`,
    `${job}/deliveries`,
    `${job}/deliveries/${deliveryA}/pdf`,
    `${job}/invoices`,
    `${job}/invoices/${invoiceA}/pdf`,
    `/api/v1/quotes/${quoteA}`,
    `/api/v1/quotes/${quoteA}/pdf`,
    `/api/v1/quote-requests/${requestA}`,
    `/api/v1/customers/${companyA}`,
  ];
  for (const path of reads) {
    assert.equal(
      (await get(path, TEST_CUSTOMER_A_TOKEN)).status,
      200,
      `own: ${path}`,
    );
    assert.equal(
      (await get(path, TEST_CUSTOMER_B_TOKEN)).status,
      404,
      `other company: ${path}`,
    );
  }

  // Lists never leak another company's rows.
  for (const list of [
    "/api/v1/jobs",
    "/api/v1/quotes",
    "/api/v1/quote-requests",
  ]) {
    assert.deepEqual(
      await json<unknown[]>(await get(list, TEST_CUSTOMER_B_TOKEN)),
      [],
      list,
    );
  }
  assert.equal(
    (await json<unknown[]>(await get("/api/v1/jobs", TEST_CUSTOMER_A_TOKEN)))
      .length,
    1,
  );
  assert.deepEqual(
    (
      await json<Array<{ id: string }>>(
        await get("/api/v1/customers", TEST_CUSTOMER_B_TOKEN),
      )
    ).map((item) => item.id),
    [companyB],
  );
  // Guessed identifiers of the wrong shape or that do not exist are denied the same way.
  for (const path of [
    `/api/v1/jobs/${randomUUID()}`,
    "/api/v1/jobs/not-a-uuid",
    `${job}/documents/${randomUUID()}/download`,
    `${job}/invoices/${randomUUID()}/pdf`,
    `/api/v1/quotes/${randomUUID()}`,
  ]) {
    assert.equal((await get(path, TEST_CUSTOMER_A_TOKEN)).status, 404, path);
  }
});

test("customers never reach staff-only resources or write endpoints", async () => {
  const job = `/api/v1/jobs/${jobA}`;
  const staffOnlyReads = [
    `${job}/charges`,
    `${job}/tasks`,
    "/api/v1/tasks",
    "/api/v1/drivers",
    "/api/v1/vehicles",
    "/api/v1/settings",
    "/api/v1/settings/revisions",
    "/api/v1/admin/activity",
    "/api/v1/admin/staff",
    "/api/v1/admin/customer-accounts",
    "/api/v1/admin/company-memberships?userId=" + TEST_CUSTOMER_A_ID,
  ];
  for (const path of staffOnlyReads) {
    assert.equal((await get(path, TEST_CUSTOMER_A_TOKEN)).status, 403, path);
  }
  const writes: Array<[string, unknown]> = [
    [
      "/api/v1/jobs",
      { customerCompanyId: companyA, serviceLine: "sea_import" },
    ],
    [`${job}/milestones`, { milestoneKey: "cargo_arrived" }],
    [`${job}/status`, { status: "in_progress" }],
    [`${job}/parties`, { role: "shipper", name: "x" }],
    [`${job}/eta`, { etaAt: "2026-10-05T06:00:00Z" }],
    [`${job}/invoices`, { currency: "GHS" }],
    [
      `${job}/invoices/${invoiceA}/payments`,
      { amountMinor: 1, receivedOn: "2026-01-01", method: "cash" },
    ],
    [`${job}/invoices/${invoiceA}/void`, { reason: "x" }],
    [`${job}/deliveries`, { cargoDescription: "x" }],
    [`/api/v1/quotes/${quoteA}/decision`, { decision: "accepted" }],
    [
      "/api/v1/quote-requests",
      {
        companyName: "x",
        contactName: "x",
        email: "x@example.test",
        message: "x",
      },
    ],
    [
      "/api/v1/customers",
      { companyName: "x", contactName: "x", email: "x@example.test" },
    ],
  ];
  for (const [path, body] of writes) {
    const response = await post(path, TEST_CUSTOMER_A_TOKEN, body);
    assert.equal(response.status, 403, `write: ${path}`);
  }
  // A user linked to no company and holding no role gets nothing at all.
  for (const path of [job, "/api/v1/jobs", `${job}/invoices`]) {
    assert.equal((await get(path, TEST_UNASSIGNED_TOKEN)).status, 403, path);
  }
});

test("customers do not see the internal fields staff see", async () => {
  const invoices = await json<Array<Record<string, unknown>>>(
    await get(`/api/v1/jobs/${jobA}/invoices`, TEST_CUSTOMER_A_TOKEN),
  );
  assert.equal(invoices.length, 1);
  assert.equal("payments" in invoices[0], false);
  assert.equal(invoices[0].status, "issued");
});
