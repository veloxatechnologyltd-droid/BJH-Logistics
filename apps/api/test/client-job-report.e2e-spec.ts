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
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let companyA: string;
let companyB: string;
/** sea_import, open: every field filled in. */
let imp1: { id: string; fileNumber: string };
/** sea_import, open: no remark, so the latest step recorded shows. */
let imp2: { id: string; fileNumber: string };
/** sea_import, open: nothing filled in. */
let imp3: { id: string; fileNumber: string };
/** sea_export, open. */
let exp1: { id: string; fileNumber: string };
/** sea_import, closed. */
let done1: { id: string; fileNumber: string };
/** sea_import, cancelled. */
let cancelled1: { id: string; fileNumber: string };
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
const put = (path: string, token: string, body: unknown = {}) =>
  call(path, token, { method: "PUT", body: JSON.stringify(body) });

async function openJob(companyId: string, serviceLine: string) {
  const response = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine,
  });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()) as { id: string; fileNumber: string };
}

async function setDetails(
  jobId: string,
  details: {
    goodsDescription?: string;
    remarks?: string;
    expectedCompletionDate?: string;
  },
) {
  const response = await put(
    `/api/v1/jobs/${jobId}/report-details`,
    TEST_SUPER_ADMIN_TOKEN,
    details,
  );
  assert.equal(response.status, 200, await response.clone().text());
}

type Row = {
  jobId: string;
  fileNumber: string;
  customer: string;
  billNumbers: string[];
  goods: string | null;
  vessel: string | null;
  eta: string | null;
  portOfDischarge: string | null;
  status: string;
  completionDate: string | null;
};
type Report = {
  company: { id: string; name: string };
  generatedOn: string;
  sections: Array<{ serviceLine: string; rows: Row[] }>;
  completed: Row[];
};

const query = (extra = "") =>
  `/api/v1/client-job-reports?companyId=${companyA}${extra}`;
const allRows = (report: Report) => [
  ...report.sections.flatMap((section) => section.rows),
  ...report.completed,
];

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
          notify: false,
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

  imp1 = await openJob(companyA, "sea_import");
  imp2 = await openJob(companyA, "sea_import");
  imp3 = await openJob(companyA, "sea_import");
  exp1 = await openJob(companyA, "sea_export");
  done1 = await openJob(companyA, "sea_import");
  cancelled1 = await openJob(companyA, "sea_import");
  jobB = (await openJob(companyB, "sea_import")).id;

  // imp1: everything the report shows, with a master and a house bill.
  await put(`/api/v1/jobs/${imp1.id}/voyage`, TEST_SUPER_ADMIN_TOKEN, {
    vessel: "MV SYNTHETIC",
    portOfDischarge: "TEMA",
  });
  await setDetails(imp1.id, {
    goodsDescription: "1 UNIT TRUCK",
    remarks: "BOE PROCESSING",
    expectedCompletionDate: "2026-11-30",
  });
  await post(`/api/v1/jobs/${imp1.id}/eta`, TEST_SUPER_ADMIN_TOKEN, {
    etaAt: "2026-11-11T08:00:00.000Z",
    source: "Carrier notice",
  });
  const master = (await (
    await post(`/api/v1/jobs/${imp1.id}/references`, TEST_SUPER_ADMIN_TOKEN, {
      kind: "master_bl",
      value: "MBL-0001",
    })
  ).json()) as { id: string };
  await post(`/api/v1/jobs/${imp1.id}/references`, TEST_SUPER_ADMIN_TOKEN, {
    kind: "house_bl",
    value: "HBL-0001",
    parentReferenceId: master.id,
  });
  // A booking number is not a bill number.
  await post(`/api/v1/jobs/${imp1.id}/references`, TEST_SUPER_ADMIN_TOKEN, {
    kind: "booking",
    value: "BKG-0042",
    parentReferenceId: master.id,
  });

  // imp2: no remark. The latest step wins, and billing steps never stand in.
  await post(`/api/v1/jobs/${imp2.id}/eta`, TEST_SUPER_ADMIN_TOKEN, {
    etaAt: "2026-10-29T08:00:00.000Z",
    source: "Carrier notice",
  });
  await post(`/api/v1/jobs/${imp2.id}/milestones`, TEST_SUPER_ADMIN_TOKEN, {
    milestoneKey: "customs_released",
    occurredAt: "2026-10-30T09:00:00.000Z",
  });
  await post(`/api/v1/jobs/${imp2.id}/milestones`, TEST_SUPER_ADMIN_TOKEN, {
    milestoneKey: "customer_invoice_issued",
    occurredAt: "2026-10-31T09:00:00.000Z",
  });

  await setDetails(exp1.id, { remarks: "Pending booking confirmation" });

  // done1 finishes with a different expected date: the day it closed is shown.
  await setDetails(done1.id, {
    remarks: "CARGO HAS ARRIVED",
    expectedCompletionDate: "2026-12-12",
  });
  const closed = await post(
    `/api/v1/jobs/${done1.id}/status`,
    TEST_SUPER_ADMIN_TOKEN,
    { status: "closed", reason: "Synthetic closure" },
  );
  assert.equal(closed.status, 201, await closed.clone().text());
  const cancelled = await post(
    `/api/v1/jobs/${cancelled1.id}/status`,
    TEST_SUPER_ADMIN_TOKEN,
    { status: "cancelled", reason: "Client withdrew" },
  );
  assert.equal(cancelled.status, 201, await cancelled.clone().text());
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("staff keep the goods, remark and expected finish on an open job, and can clear them", async () => {
  const saved = await put(
    `/api/v1/jobs/${imp3.id}/report-details`,
    TEST_MATCHING_TOKEN,
    {
      goodsDescription: "  4X40 STC CARTONS  ",
      remarks: "RELEASE ONGOING",
      expectedCompletionDate: "2026-11-07",
    },
  );
  assert.equal(saved.status, 200, await saved.clone().text());
  const job = (await saved.json()) as {
    goodsDescription: string;
    remarks: string;
    expectedCompletionDate: string;
  };
  assert.equal(job.goodsDescription, "4X40 STC CARTONS");
  assert.equal(job.remarks, "RELEASE ONGOING");
  assert.equal(job.expectedCompletionDate, "2026-11-07");

  // The job's own page returns them too.
  const read = (await (
    await call(`/api/v1/jobs/${imp3.id}`, TEST_MATCHING_TOKEN)
  ).json()) as { remarks: string; expectedCompletionDate: string };
  assert.equal(read.remarks, "RELEASE ONGOING");
  assert.equal(read.expectedCompletionDate, "2026-11-07");

  // An empty value clears each one.
  const cleared = (await (
    await put(`/api/v1/jobs/${imp3.id}/report-details`, TEST_MATCHING_TOKEN, {
      goodsDescription: "",
      remarks: "",
      expectedCompletionDate: "",
    })
  ).json()) as Record<string, unknown>;
  assert.equal(cleared.goodsDescription, null);
  assert.equal(cleared.remarks, null);
  assert.equal(cleared.expectedCompletionDate, null);
});

test("report details refuse bad input, other lines, customers and finished jobs", async () => {
  for (const body of [
    { expectedCompletionDate: "2026-02-31" },
    { expectedCompletionDate: "11/07/2026" },
    { remarks: "x".repeat(301) },
    { goodsDescription: "x".repeat(501) },
  ]) {
    const response = await put(
      `/api/v1/jobs/${imp3.id}/report-details`,
      TEST_SUPER_ADMIN_TOKEN,
      body,
    );
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  // An import rep does not work sea export jobs.
  const otherLine = await put(
    `/api/v1/jobs/${exp1.id}/report-details`,
    TEST_MATCHING_TOKEN,
    { remarks: "Not mine" },
  );
  assert.equal(otherLine.status, 404);
  const customer = await put(
    `/api/v1/jobs/${imp1.id}/report-details`,
    TEST_CUSTOMER_A_TOKEN,
    { remarks: "Customers cannot edit" },
  );
  assert.equal(customer.status, 403);
  for (const finished of [done1.id, cancelled1.id]) {
    const response = await put(
      `/api/v1/jobs/${finished}/report-details`,
      TEST_SUPER_ADMIN_TOKEN,
      { remarks: "Too late" },
    );
    assert.equal(response.status, 409);
  }
  const unchanged = (await (
    await call(`/api/v1/jobs/${imp1.id}`, TEST_SUPER_ADMIN_TOKEN)
  ).json()) as { remarks: string };
  assert.equal(unchanged.remarks, "BOE PROCESSING");
});

test("the report lists open jobs by service, then completed ones, one line each", async () => {
  const response = await call(query(), TEST_SUPER_ADMIN_TOKEN);
  assert.equal(response.status, 200, await response.clone().text());
  const report = (await response.json()) as Report;
  assert.deepEqual(report.company, {
    id: companyA,
    name: "Report Synthetic Ltd",
  });
  assert.equal(report.generatedOn, today());

  // Sea import before sea export; inside a section the nearest ETA first and
  // a job with no ETA last.
  assert.deepEqual(
    report.sections.map((section) => [
      section.serviceLine,
      section.rows.map((row) => row.fileNumber),
    ]),
    [
      ["sea_import", [imp2.fileNumber, imp1.fileNumber, imp3.fileNumber]],
      ["sea_export", [exp1.fileNumber]],
    ],
  );
  assert.deepEqual(
    report.completed.map((row) => row.fileNumber),
    [done1.fileNumber],
  );
  // No cancelled job, and nothing of another customer.
  const everyJob = allRows(report).map((row) => row.jobId);
  assert.ok(!everyJob.includes(cancelled1.id));
  assert.ok(!everyJob.includes(jobB));

  // The whole row, which is also the full list of what a client is shown:
  // there is no money in it.
  const [, first] = report.sections[0].rows;
  assert.deepEqual(first, {
    jobId: imp1.id,
    fileNumber: imp1.fileNumber,
    customer: "Report Synthetic Ltd",
    billNumbers: ["HBL-0001", "MBL-0001"],
    goods: "1 UNIT TRUCK",
    vessel: "MV SYNTHETIC",
    eta: "2026-11-11",
    portOfDischarge: "TEMA",
    status: "BOE PROCESSING",
    completionDate: "2026-11-30",
  });
});

test("status is the remark, else the latest step recorded, else the job's status", async () => {
  const report = (await (
    await call(query(), TEST_SUPER_ADMIN_TOKEN)
  ).json()) as Report;
  const byId = new Map(allRows(report).map((row) => [row.jobId, row]));
  // The invoice step was recorded last, but billing is not shipment progress.
  assert.equal(
    byId.get(imp2.id)?.status,
    "Customs released; delivery authorisation received",
  );
  assert.equal(byId.get(imp2.id)?.eta, "2026-10-29");
  assert.equal(byId.get(imp2.id)?.completionDate, null);
  assert.equal(byId.get(imp3.id)?.status, "Open");
  assert.equal(byId.get(imp3.id)?.eta, null);
  assert.deepEqual(byId.get(imp3.id)?.billNumbers, []);
  assert.equal(byId.get(exp1.id)?.status, "Pending booking confirmation");
  // A completed job shows the day it closed, not the date once expected.
  assert.equal(byId.get(done1.id)?.status, "CARGO HAS ARRIVED");
  assert.equal(byId.get(done1.id)?.completionDate, today());
});

test("a report can be narrowed to chosen jobs; another customer's job is refused", async () => {
  const chosen = (await (
    await call(query(`&jobIds=${imp1.id},${done1.id}`), TEST_SUPER_ADMIN_TOKEN)
  ).json()) as Report;
  assert.deepEqual(
    allRows(chosen).map((row) => row.jobId),
    [imp1.id, done1.id],
  );

  // A cancelled job that is chosen is simply left out.
  const none = (await (
    await call(query(`&jobIds=${cancelled1.id}`), TEST_SUPER_ADMIN_TOKEN)
  ).json()) as Report;
  assert.deepEqual(allRows(none), []);

  const foreign = await call(query(`&jobIds=${jobB}`), TEST_SUPER_ADMIN_TOKEN);
  assert.equal(foreign.status, 404);
  const mixed = await call(
    query(`&jobIds=${imp1.id},${jobB}`),
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(mixed.status, 404);
  const bad = await call(query("&jobIds=nope"), TEST_SUPER_ADMIN_TOKEN);
  assert.equal(bad.status, 400);
  const unknown = await call(
    `/api/v1/client-job-reports?companyId=${randomUUID()}`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(unknown.status, 404);
  const missing = await call(
    "/api/v1/client-job-reports",
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(missing.status, 400);

  // Dates narrow by the day a job was opened.
  const future = (await (
    await call(query("&from=2999-01-01"), TEST_SUPER_ADMIN_TOKEN)
  ).json()) as Report;
  assert.deepEqual(allRows(future), []);
});

test("a rep sees only the jobs on their own service lines", async () => {
  const report = (await (
    await call(query(), TEST_MATCHING_TOKEN)
  ).json()) as Report;
  assert.deepEqual(
    report.sections.map((section) => section.serviceLine),
    ["sea_import"],
  );
  assert.ok(!allRows(report).some((row) => row.jobId === exp1.id));

  const refused = await call(query(`&jobIds=${exp1.id}`), TEST_MATCHING_TOKEN);
  assert.equal(refused.status, 404);
});

test("the PDF downloads for staff; customers and signed-out callers are refused", async () => {
  const pdf = await call(
    `/api/v1/client-job-reports/pdf?companyId=${companyA}`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(pdf.status, 200, await pdf.clone().text());
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(
    pdf.headers.get("content-disposition") ?? "",
    new RegExp(`Client-job-report-Report-Synthetic-Ltd-${today()}\\.pdf`),
  );
  const bytes = Buffer.from(await pdf.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");

  const rep = await call(
    `/api/v1/client-job-reports/pdf?companyId=${companyA}`,
    TEST_MATCHING_TOKEN,
  );
  assert.equal(rep.status, 200);

  for (const path of [
    `/api/v1/client-job-reports?companyId=${companyA}`,
    `/api/v1/client-job-reports/pdf?companyId=${companyA}`,
  ]) {
    const customer = await call(path, TEST_CUSTOMER_A_TOKEN);
    assert.equal(customer.status, 403, path);
    const signedOut = await fetch(`${baseUrl}${path}`);
    assert.equal(signedOut.status, 401, path);
  }
});
