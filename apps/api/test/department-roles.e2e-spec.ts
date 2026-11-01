import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import type { StaffRoleKey } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let database: DatabasePort;
let baseUrl: string;
let companyId: string;

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

const post = (path: string, token: string, body: unknown) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });

/** Gives the second staff identity exactly one role for the next test. */
async function actAs(role: StaffRoleKey) {
  for (const held of await database.getActiveStaffRoles(
    TEST_UNASSIGNED_USER_ID,
  )) {
    await database.revokeStaffRole(
      TEST_UNASSIGNED_USER_ID,
      held,
      TEST_SUPER_ADMIN_ID,
    );
  }
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    role,
    TEST_SUPER_ADMIN_ID,
  );
}

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  companyId = randomUUID();
  await database.createCustomer({
    id: companyId,
    companyName: "Roles Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("the import rep works sea and air import, not export", async () => {
  for (const serviceLine of ["sea_import", "air_import"]) {
    const opened = await post("/api/v1/jobs", TEST_MATCHING_TOKEN, {
      customerCompanyId: companyId,
      serviceLine,
    });
    assert.equal(opened.status, 201, serviceLine);
  }
  const exportJob = await post("/api/v1/jobs", TEST_MATCHING_TOKEN, {
    customerCompanyId: companyId,
    serviceLine: "sea_export",
  });
  assert.equal(exportJob.status, 403);

  await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine: "air_export",
  });
  const visible = (await (
    await call("/api/v1/jobs", TEST_MATCHING_TOKEN)
  ).json()) as Array<{ serviceLine: string }>;
  assert.deepEqual(visible.map((job) => job.serviceLine).sort(), [
    "air_import",
    "sea_import",
  ]);
});

test("customer service sees every job and opens any line", async () => {
  await actAs("customer_service_rep");
  const visible = (await (
    await call("/api/v1/jobs", TEST_UNASSIGNED_TOKEN)
  ).json()) as Array<{ serviceLine: string }>;
  assert.deepEqual(visible.map((job) => job.serviceLine).sort(), [
    "air_export",
    "air_import",
    "sea_import",
  ]);
  const opened = await post("/api/v1/jobs", TEST_UNASSIGNED_TOKEN, {
    customerCompanyId: companyId,
    serviceLine: "sea_export",
  });
  assert.equal(opened.status, 201);
});

test("customer service and sales keep customer records and requests; import, export and finance do not", async () => {
  const newCustomer = (name: string) => ({
    companyName: name,
    contactName: "Ama Synthetic",
    email: `${name.toLowerCase().replace(/\W+/g, "-")}@example.test`,
  });

  for (const role of ["customer_service_rep", "sales_rep"] as const) {
    await actAs(role);
    const created = await post(
      "/api/v1/customers",
      TEST_UNASSIGNED_TOKEN,
      newCustomer(`Desk ${role}`),
    );
    assert.equal(created.status, 201, role);
    const request = await post(
      "/api/v1/quote-requests",
      TEST_UNASSIGNED_TOKEN,
      {
        companyName: "Walk-in Synthetic Ltd",
        contactName: "Ama Synthetic",
        email: "ama@example.test",
        message: "Please quote a 40ft from Shanghai to Tema.",
      },
    );
    assert.equal(request.status, 201, `${role} request`);
  }

  for (const [token, role] of [
    [TEST_MATCHING_TOKEN, "import_rep"],
    [TEST_UNASSIGNED_TOKEN, "finance_rep"],
  ] as const) {
    if (role === "finance_rep") await actAs("finance_rep");
    const refused = await post(
      "/api/v1/customers",
      token,
      newCustomer(`Refused ${role}`),
    );
    assert.equal(refused.status, 403, role);
  }
});

test("old roles can no longer be assigned through staff management", async () => {
  const refused = await post(
    `/api/v1/admin/staff/${TEST_UNASSIGNED_USER_ID}/roles`,
    TEST_SUPER_ADMIN_TOKEN,
    { roleKey: "sea_import_rep" },
  );
  assert.equal(refused.status, 400);
});

test("finance work belongs to finance; customer service may only read invoices", async () => {
  const opened = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine: "sea_import",
  });
  const jobId = ((await opened.json()) as { id: string }).id;
  const invoice = { currency: "GHS", lines: [] };

  // The import rep works the job but not its money.
  for (const path of [
    `/api/v1/jobs/${jobId}/invoices`,
    `/api/v1/jobs/${jobId}/charges`,
    "/api/v1/finance/summary",
  ]) {
    assert.equal((await call(path, TEST_MATCHING_TOKEN)).status, 403, path);
  }
  assert.equal(
    (await post(`/api/v1/jobs/${jobId}/invoices`, TEST_MATCHING_TOKEN, invoice))
      .status,
    403,
  );

  await actAs("customer_service_rep");
  assert.equal(
    (await call(`/api/v1/jobs/${jobId}/invoices`, TEST_UNASSIGNED_TOKEN))
      .status,
    200,
  );
  assert.equal(
    (
      await post(
        `/api/v1/jobs/${jobId}/invoices`,
        TEST_UNASSIGNED_TOKEN,
        invoice,
      )
    ).status,
    403,
  );
  assert.equal(
    (await call("/api/v1/finance/summary", TEST_UNASSIGNED_TOKEN)).status,
    403,
  );

  await actAs("finance_rep");
  assert.equal(
    (
      await post(
        `/api/v1/jobs/${jobId}/invoices`,
        TEST_UNASSIGNED_TOKEN,
        invoice,
      )
    ).status,
    201,
  );
  assert.equal(
    (await call("/api/v1/finance/summary", TEST_UNASSIGNED_TOKEN)).status,
    200,
  );
});

test("customer service and sales prepare quotes; import, export and finance do not", async () => {
  const quote = {
    customerCompanyId: companyId,
    serviceLine: "sea_import",
    version: {
      currency: "USD",
      title: "Synthetic quotation",
      sizeLabels: [],
      lines: [{ description: "Clearance", basis: "fixed", amountMinor: 100 }],
    },
  };
  for (const role of ["customer_service_rep", "sales_rep"] as const) {
    await actAs(role);
    assert.equal(
      (await post("/api/v1/quotes", TEST_UNASSIGNED_TOKEN, quote)).status,
      201,
      role,
    );
  }
  await actAs("finance_rep");
  assert.equal(
    (await post("/api/v1/quotes", TEST_UNASSIGNED_TOKEN, quote)).status,
    403,
  );
  assert.equal(
    (await post("/api/v1/quotes", TEST_MATCHING_TOKEN, quote)).status,
    403,
  );
});

test("reports carry money figures for finance only", async () => {
  const range = "from=2020-01-01&to=2099-12-31";
  await actAs("sales_rep");
  const sales = (await (
    await call(`/api/v1/reports?${range}`, TEST_UNASSIGNED_TOKEN)
  ).json()) as { finance: boolean; invoices: unknown[] };
  assert.equal(sales.finance, false);
  assert.deepEqual(sales.invoices, []);
  await actAs("finance_rep");
  const finance = (await (
    await call(`/api/v1/reports?${range}`, TEST_UNASSIGNED_TOKEN)
  ).json()) as { finance: boolean };
  assert.equal(finance.finance, true);
});
