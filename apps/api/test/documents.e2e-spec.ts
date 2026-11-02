import "reflect-metadata";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
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
  testDocumentStorage,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import type { StaffRoleKey } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let jobA: string;
let jobB: string;

const pdf = (extra = "synthetic") =>
  Buffer.from(`%PDF-1.4\n% ${extra}\n%%EOF\n`, "latin1");
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("synthetic"),
]);

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
  const companyA = randomUUID();
  const companyB = randomUUID();
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

interface DocResponse {
  id: string;
  documentType: string;
  versions: Array<{
    versionNumber: number;
    filename: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    objectKey?: string;
  }>;
}

let documentId: string;

test("a rep uploads a document: checked, hashed, stored under a random key", async () => {
  const bytes = pdf();
  const response = await upload(
    jobA,
    TEST_MATCHING_TOKEN,
    { name: "../../secret/Supplier Invoice 001.pdf", bytes },
    { documentType: "commercial_invoice" },
  );
  assert.equal(response.status, 201);
  const text = await response.text();
  assert.equal(text.includes("objectKey"), false);
  assert.equal(text.includes("object_key"), false);
  const document = JSON.parse(text) as DocResponse;
  documentId = document.id;
  assert.equal(document.documentType, "commercial_invoice");
  const [version] = document.versions;
  assert.equal(version.versionNumber, 1);
  assert.equal(version.filename, "Supplier Invoice 001.pdf");
  assert.equal(version.contentType, "application/pdf");
  assert.equal(version.sizeBytes, bytes.length);
  assert.equal(
    version.sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );

  const keys = [...testDocumentStorage.objects.keys()];
  assert.equal(keys.length, 1);
  assert.ok(keys[0].startsWith(`${jobA}/`));
  assert.equal(keys[0].toLowerCase().includes("invoice"), false);
  assert.equal(
    testDocumentStorage.objects.get(keys[0])!.contentType,
    "application/pdf",
  );
});

test("uploading against an existing document adds an immutable new version", async () => {
  const response = await upload(
    jobA,
    TEST_MATCHING_TOKEN,
    { name: "Supplier Invoice 001 corrected.pdf", bytes: pdf("v2") },
    { documentType: "commercial_invoice", documentId },
  );
  assert.equal(response.status, 201);
  const document = (await response.json()) as DocResponse;
  assert.deepEqual(
    document.versions.map((version) => version.versionNumber),
    [1, 2],
  );
  assert.equal(testDocumentStorage.objects.size, 2);

  const foreign = await upload(
    jobB,
    TEST_SUPER_ADMIN_TOKEN,
    { name: "x.pdf", bytes: pdf() },
    { documentType: "commercial_invoice", documentId },
  );
  assert.equal(foreign.status, 404);
});

test("type is required and files are validated by content, not by name or claim", async () => {
  const cases: Array<
    [string, Parameters<typeof upload>[2], Record<string, string>, number]
  > = [
    ["missing type", { name: "a.pdf", bytes: pdf() }, {}, 400],
    [
      "unknown type",
      { name: "a.pdf", bytes: pdf() },
      { documentType: "bjh_invoice" },
      400,
    ],
    ["no file", null, { documentType: "other" }, 400],
    [
      "empty file",
      { name: "a.pdf", bytes: Buffer.alloc(0) },
      { documentType: "other" },
      400,
    ],
    [
      "text renamed to pdf",
      { name: "a.pdf", bytes: Buffer.from("just text, not a pdf") },
      { documentType: "other" },
      415,
    ],
    [
      "exe claiming to be pdf",
      {
        name: "a.pdf",
        bytes: Buffer.from("MZ\u0090\u0000\u0003"),
        type: "application/pdf",
      },
      { documentType: "other" },
      415,
    ],
    [
      "bad documentId",
      { name: "a.pdf", bytes: pdf() },
      { documentType: "other", documentId: "nope" },
      400,
    ],
  ];
  const before = testDocumentStorage.objects.size;
  for (const [label, file, fields, status] of cases) {
    const response = await upload(jobA, TEST_MATCHING_TOKEN, file, fields);
    assert.equal(response.status, status, label);
  }
  assert.equal(
    testDocumentStorage.objects.size,
    before,
    "nothing invalid was stored",
  );
  const image = await upload(
    jobA,
    TEST_MATCHING_TOKEN,
    { name: "scan.png", bytes: png, type: "image/png" },
    { documentType: "delivery_note" },
  );
  assert.equal(image.status, 201);
  assert.equal(
    ((await image.json()) as DocResponse).versions[0].contentType,
    "image/png",
  );
});

test("oversized files are rejected", async () => {
  const big = Buffer.concat([pdf(), Buffer.alloc(25 * 1024 * 1024 + 10, 1)]);
  const response = await upload(
    jobA,
    TEST_MATCHING_TOKEN,
    { name: "big.pdf", bytes: big },
    { documentType: "other" },
  );
  assert.equal(response.status, 413);
});

test("download links are short-lived and respect company and department boundaries", async () => {
  const own = await call(
    `/api/v1/jobs/${jobA}/documents/${documentId}/download`,
    TEST_CUSTOMER_A_TOKEN,
  );
  assert.equal(own.status, 200);
  const link = (await own.json()) as {
    url: string;
    expiresInSeconds: number;
    filename: string;
    versionNumber: number;
  };
  assert.equal(link.expiresInSeconds, 60);
  assert.equal(link.versionNumber, 2);
  assert.ok(link.url.startsWith("https://storage.test/signed/"));
  assert.ok(link.url.includes("expires=60"));

  const v1 = await call(
    `/api/v1/jobs/${jobA}/documents/${documentId}/download?version=1`,
    TEST_MATCHING_TOKEN,
  );
  assert.equal(
    ((await v1.json()) as { filename: string }).filename,
    "Supplier Invoice 001.pdf",
  );
  assert.equal(
    (
      await call(
        `/api/v1/jobs/${jobA}/documents/${documentId}/download?version=0`,
        TEST_MATCHING_TOKEN,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        `/api/v1/jobs/${jobA}/documents/${documentId}/download?version=9`,
        TEST_MATCHING_TOKEN,
      )
    ).status,
    404,
  );

  // known IDs, wrong company / department / job
  assert.equal(
    (
      await call(
        `/api/v1/jobs/${jobA}/documents/${documentId}/download`,
        TEST_CUSTOMER_B_TOKEN,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        `/api/v1/jobs/${jobA}/documents/${documentId}/download`,
        TEST_UNASSIGNED_TOKEN,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        `/api/v1/jobs/${jobB}/documents/${documentId}/download`,
        TEST_SUPER_ADMIN_TOKEN,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        `/api/v1/jobs/${jobA}/documents/${randomUUID()}/download`,
        TEST_SUPER_ADMIN_TOKEN,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        `/api/v1/jobs/${jobA}/documents/not-an-id/download`,
        TEST_SUPER_ADMIN_TOKEN,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await fetch(
        `${baseUrl}/api/v1/jobs/${jobA}/documents/${documentId}/download`,
      )
    ).status,
    401,
  );
});

test("listing is scoped, and customers and other departments cannot upload", async () => {
  const list = (await (
    await call(`/api/v1/jobs/${jobA}/documents`, TEST_CUSTOMER_A_TOKEN)
  ).json()) as DocResponse[];
  assert.equal(list.length, 2);
  assert.equal(JSON.stringify(list).includes("objectKey"), false);
  assert.equal(
    (await call(`/api/v1/jobs/${jobA}/documents`, TEST_CUSTOMER_B_TOKEN))
      .status,
    404,
  );
  assert.equal(
    (await call(`/api/v1/jobs/${jobA}/documents`, TEST_UNASSIGNED_TOKEN))
      .status,
    404,
  );
  const asCustomer = await upload(
    jobA,
    TEST_CUSTOMER_A_TOKEN,
    { name: "a.pdf", bytes: pdf() },
    { documentType: "other" },
  );
  assert.equal(asCustomer.status, 403);
  const wrongDepartment = await upload(
    jobA,
    TEST_UNASSIGNED_TOKEN,
    { name: "a.pdf", bytes: pdf() },
    { documentType: "other" },
  );
  assert.equal(wrongDepartment.status, 404);
});

test("supplier invoices and disbursement evidence are for finance only: hidden from customers and other staff", async () => {
  const database = application.get(DatabasePort);
  const actAs = async (role: StaffRoleKey) => {
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
  };
  const ids: string[] = [];
  for (const documentType of ["supplier_invoice", "disbursement_evidence"]) {
    const response = await upload(
      jobA,
      TEST_SUPER_ADMIN_TOKEN,
      { name: `${documentType}.pdf`, bytes: pdf(documentType) },
      { documentType },
    );
    assert.equal(response.status, 201);
    ids.push(((await response.json()) as DocResponse).id);
  }
  const listed = async (token: string) =>
    (
      (await (
        await call(`/api/v1/jobs/${jobA}/documents`, token)
      ).json()) as DocResponse[]
    ).map((document) => document.id);
  const library = async (token: string) =>
    (
      (await (await call("/api/v1/documents", token)).json()) as Array<{
        id: string;
      }>
    ).map((document) => document.id);
  const status = async (path: string, token: string, method = "GET") =>
    (await call(path, token, { method })).status;

  const refused = async (token: string, who: string) => {
    const visible = await listed(token);
    assert.ok(visible.length > 0, `${who} still sees other documents`);
    const found = await library(token);
    for (const id of ids) {
      assert.equal(visible.includes(id), false, `${who} lists ${id}`);
      assert.equal(found.includes(id), false, `${who} finds ${id}`);
      assert.equal(
        await status(`/api/v1/jobs/${jobA}/documents/${id}/download`, token),
        404,
        `${who} downloads from the job`,
      );
      assert.equal(
        await status(`/api/v1/documents/${id}/download`, token),
        404,
        `${who} downloads from the library`,
      );
    }
  };

  await refused(TEST_CUSTOMER_A_TOKEN, "customer");

  await actAs("import_rep");
  await refused(TEST_UNASSIGNED_TOKEN, "import rep");
  assert.equal(
    await status(
      `/api/v1/jobs/${jobA}/documents/${ids[0]}/extract`,
      TEST_UNASSIGNED_TOKEN,
      "POST",
    ),
    404,
  );
  const asRep = await upload(
    jobA,
    TEST_UNASSIGNED_TOKEN,
    { name: "cost.pdf", bytes: pdf() },
    { documentType: "supplier_invoice" },
  );
  assert.equal(asRep.status, 403);
  const versionAsRep = await upload(
    jobA,
    TEST_UNASSIGNED_TOKEN,
    { name: "cost.pdf", bytes: pdf() },
    { documentType: "other", documentId: ids[0] },
  );
  assert.equal(versionAsRep.status, 404);

  await actAs("finance_rep");
  const financeSees = await listed(TEST_UNASSIGNED_TOKEN);
  const financeFinds = await library(TEST_UNASSIGNED_TOKEN);
  for (const id of ids) {
    assert.ok(financeSees.includes(id));
    assert.ok(financeFinds.includes(id));
    assert.equal(
      await status(
        `/api/v1/jobs/${jobA}/documents/${id}/download`,
        TEST_UNASSIGNED_TOKEN,
      ),
      200,
    );
  }
  for (const id of ids) {
    assert.ok((await listed(TEST_SUPER_ADMIN_TOKEN)).includes(id));
  }
});
