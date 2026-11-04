import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import { serviceLinesForRoles } from "@bjh/contracts";
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
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import type { StaffRoleKey } from "../src/database/database.port";
import { ReportPdfService } from "../src/reports/report-pdf.service";
import {
  financeReportTypes,
  reportTypes,
} from "../src/reports/report-documents";
import type { ReportBlock } from "../src/reports/report-pdf";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let company: string;
let seaJob: string;
let airJob: string;
let seaFile: string;
let airFile: string;

const today = () => new Date().toISOString().slice(0, 10);

function call(path: string, token?: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown = {}) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });
const reportUrl = (type: string, extra = "") =>
  `/api/v1/reports/pdf?type=${type}&from=2020-01-01&to=${today()}${extra}`;

async function openJob(serviceLine: string) {
  const response = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: company,
    serviceLine,
  });
  const job = (await response.json()) as { id: string; fileNumber: string };
  return job;
}

type TableBlock = Extract<ReportBlock, { kind: "table" }>;
const tableRows = (blocks: ReportBlock[]) =>
  blocks
    .filter((block): block is TableBlock => block.kind === "table")
    .flatMap((block) => block.rows);

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
  // The legacy import rep works sea and air import only; not finance.
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  company = randomUUID();
  await database.createCustomer({
    id: company,
    companyName: "Report Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  await database.grantCustomerMembership(
    company,
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
  ({ id: seaJob, fileNumber: seaFile } = await openJob("sea_import"));
  ({ id: airJob, fileNumber: airFile } = await openJob("air_export"));
  const created = (await (
    await post(`/api/v1/jobs/${seaJob}/invoices`, TEST_SUPER_ADMIN_TOKEN, {
      currency: "GHS",
      lines: [
        { description: "Clearing", amountMinor: 100_000, taxable: false },
      ],
    })
  ).json()) as { id: string };
  await post(
    `/api/v1/jobs/${seaJob}/invoices/${created.id}/issue`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  await post("/api/v1/payments", TEST_SUPER_ADMIN_TOKEN, {
    receivedOn: today(),
    method: "cash",
    totalMinor: 60_000,
    allocations: [{ invoiceId: created.id, amountMinor: 60_000 }],
  });
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("every report is a real PDF for the super admin", async () => {
  for (const type of reportTypes) {
    const response = await call(reportUrl(type), TEST_SUPER_ADMIN_TOKEN);
    assert.equal(
      response.status,
      200,
      `${type}: ${await response.clone().text()}`,
    );
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.match(
      response.headers.get("content-disposition") ?? "",
      new RegExp(`BJH-${type}-2020-01-01-to-${today()}\\.pdf`),
    );
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.subarray(0, 5).toString(), "%PDF-", type);
  }
});

test("the money reports carry the invoice, the payment and what is still owed", async () => {
  const service = application.get(ReportPdfService);
  const ask = async (type: string) =>
    (
      await service.document({ type, from: "2020-01-01", to: today() }, {}, [
        "super_admin",
      ])
    ).document;

  const revenue = await ask("invoices-payments");
  assert.deepEqual(tableRows(revenue.blocks)[0], [
    "GHS",
    "1",
    "GHS 1,000.00",
    "1",
    "GHS 600.00",
  ]);

  const ageing = await ask("receivables-ageing");
  const owing = ageing.blocks.flatMap((block) =>
    block.kind === "kpis" ? block.items : [],
  );
  assert.deepEqual(
    owing.map((item) => [item.label, item.value]),
    [
      ["Owing (GHS)", "GHS 400.00"],
      ["Overdue (GHS)", "GHS 0.00"],
    ],
  );
});

test("a shipment update lists open jobs, and can be limited to one service", async () => {
  const service = application.get(ReportPdfService);
  const files = async (extra: object) =>
    tableRows(
      (
        await service.document(
          {
            type: "shipment-status",
            from: "2020-01-01",
            to: today(),
            ...extra,
          },
          {},
          ["super_admin"],
        )
      ).document.blocks,
    ).map((row) => row[0]);
  assert.deepEqual((await files({})).sort(), [airFile, seaFile].sort());
  assert.deepEqual(await files({ serviceLine: "air_export" }), [airFile]);
});

test("a rep's reports name only the jobs of their own service lines", async () => {
  const service = application.get(ReportPdfService);
  const scope = { serviceLines: serviceLinesForRoles(["import_rep"]) };
  assert.ok(!scope.serviceLines.includes("air_export"));
  const rows = async (type: string) =>
    tableRows(
      (
        await service.document(
          { type, from: "2020-01-01", to: today() },
          scope,
          ["import_rep"],
        )
      ).document.blocks,
    ).flat();
  for (const type of ["shipment-status", "job-activity"]) {
    const cells = await rows(type);
    assert.ok(cells.includes(seaFile), `${type} shows the sea import job`);
    assert.ok(!cells.includes(airFile), `${type} hides the air export job`);
  }
  // Asking for another team's service gives an empty list, not their jobs.
  assert.deepEqual(
    await service
      .document(
        {
          type: "shipment-status",
          from: "2020-01-01",
          to: today(),
          serviceLine: "air_export",
        },
        scope,
        ["import_rep"],
      )
      .then(({ document }) => tableRows(document.blocks)),
    [],
  );
});

test("the deliveries report lists dispatched loads, within each rep's own service lines", async () => {
  for (const job of [seaJob, airJob]) {
    const dispatched = await post(
      `/api/v1/jobs/${job}/deliveries`,
      TEST_SUPER_ADMIN_TOKEN,
      {
        driverName: "Outside Driver",
        driverPhone: "0240000000",
        vehicleRegistration: "GR-0001-26",
        cargoDescription: "Cartons",
        deliveryAddress: "1 Test Road, Sample City",
      },
    );
    assert.equal(dispatched.status, 201, await dispatched.clone().text());
  }
  const service = application.get(ReportPdfService);
  const ask = async (scope: object, roles: StaffRoleKey[]) =>
    tableRows(
      (
        await service.document(
          { type: "deliveries", from: today(), to: today() },
          scope,
          roles,
        )
      ).document.blocks,
    );
  const all = await ask({}, ["super_admin"]);
  assert.equal(all.length, 2);
  assert.ok(all.every((row) => /^On the way since /.test(row[5])));
  const mine = await ask(
    { serviceLines: serviceLinesForRoles(["import_rep"]) },
    ["import_rep"],
  );
  assert.equal(mine.length, 1);
  assert.ok(mine[0][1].startsWith(seaFile));
});

test("the money reports are refused to reps outside finance, and every report to customers", async () => {
  for (const type of financeReportTypes) {
    const rep = await call(reportUrl(type), TEST_MATCHING_TOKEN);
    assert.equal(rep.status, 403, `import rep: ${type}`);
  }
  const operations = await call(reportUrl("job-activity"), TEST_MATCHING_TOKEN);
  assert.equal(
    operations.status,
    200,
    "an import rep may take operations reports",
  );
  for (const type of reportTypes) {
    const customer = await call(reportUrl(type), TEST_CUSTOMER_A_TOKEN);
    assert.equal(customer.status, 403, `customer: ${type}`);
  }
  assert.equal((await call(reportUrl("job-activity"))).status, 401);
});

test("customer service covers finance work, so it may take the money reports", async () => {
  await application
    .get(DatabasePort)
    .assignStaffRole(
      TEST_UNASSIGNED_USER_ID,
      "customer_service_rep",
      TEST_SUPER_ADMIN_ID,
    );
  for (const type of financeReportTypes) {
    const response = await call(reportUrl(type), TEST_UNASSIGNED_TOKEN);
    assert.equal(response.status, 200, type);
  }
});

test("a customer's shipment update lists its open jobs, and a job completed in the period", async () => {
  for (const status of ["in_progress", "ready_to_close", "closed"]) {
    const changed = await post(
      `/api/v1/jobs/${airJob}/status`,
      TEST_SUPER_ADMIN_TOKEN,
      { status },
    );
    assert.ok(changed.ok, `${status}: ${await changed.clone().text()}`);
  }
  const { document, filename } = await application
    .get(ReportPdfService)
    .document(
      {
        type: "shipment-status",
        from: "2020-01-01",
        to: today(),
        companyId: company,
      },
      {},
      ["super_admin"],
    );
  assert.equal(document.title, "Shipment status update: Report Synthetic Ltd");
  assert.match(
    filename,
    new RegExp(
      `^BJH-shipment-status-Report-Synthetic-Ltd-2020-01-01-to-${today()}\\.pdf$`,
    ),
  );
  const [open, completed] = document.blocks.filter(
    (block): block is TableBlock => block.kind === "table",
  );
  assert.equal(open.rows.length, 1, "the closed job is no longer open");
  assert.equal(open.rows[0][0], seaFile);
  assert.deepEqual(
    completed.rows.map((row) => row[0]),
    [airFile],
  );
});

test("a bad request is refused with a reason", async () => {
  const bad = async (path: string) =>
    (await call(path, TEST_SUPER_ADMIN_TOKEN)).status;
  assert.equal(await bad("/api/v1/reports/pdf"), 400);
  assert.equal(await bad(reportUrl("everything")), 400);
  assert.equal(
    await bad(
      "/api/v1/reports/pdf?type=job-activity&from=2026-02-30&to=2026-03-01",
    ),
    400,
  );
  assert.equal(
    await bad(
      "/api/v1/reports/pdf?type=job-activity&from=2026-03-02&to=2026-03-01",
    ),
    400,
  );
  assert.equal(
    await bad(reportUrl("shipment-status", "&serviceLine=teleport")),
    400,
  );
  assert.equal(await bad(reportUrl("shipment-status", "&companyId=nope")), 400);
  assert.equal(
    await bad(reportUrl("shipment-status", `&companyId=${randomUUID()}`)),
    404,
    "a customer that does not exist",
  );
});
