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
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
  testDocumentReader,
} from "./test-application";
import { DocumentReadingError } from "../src/documents/document-reader";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";
import { containerWithCheckDigit, pdfWithText } from "./pdf-helpers";

let application: INestApplication;
let baseUrl: string;
let seaJob: string;
let airJob: string;
let container: string;
let companyId: string;

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
const get = (path: string, token = TEST_MATCHING_TOKEN) => call(path, token);
const json = async <T>(response: Response) => (await response.json()) as T;
const message = async (response: Response) =>
  ((await response.json()) as { message: string }).message;

async function openJob(companyId: string, serviceLine: string) {
  const response = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine,
  });
  return (await json<{ id: string }>(response)).id;
}

async function upload(
  jobId: string,
  bytes: Buffer,
  type: string,
  name: string,
  token = TEST_MATCHING_TOKEN,
) {
  const form = new FormData();
  form.append("documentType", "bill_of_lading");
  form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
  const response = await call(`/api/v1/jobs/${jobId}/documents`, token, {
    method: "POST",
    body: form,
  });
  assert.equal(response.status, 201);
  return (await json<{ id: string }>(response)).id;
}

type Field = {
  key: string;
  value: string;
  sealNumber: string | null;
  evidence: string;
};
type Extraction = {
  id: string;
  status: string;
  textFound: boolean;
  readBy: string | null;
  filename: string | null;
  fields: Field[];
  applied: Array<{
    index: number;
    key: string;
    value: string;
    result: string;
  }> | null;
  reviewedBy: string | null;
};
type Reference = {
  id: string;
  kind: string;
  value: string;
  sealNumber: string | null;
  parentReferenceId: string | null;
};

const references = async (jobId: string) =>
  json<Reference[]>(await get(`/api/v1/jobs/${jobId}/references`));
const extract = (jobId: string, documentId: string) =>
  post(
    `/api/v1/jobs/${jobId}/documents/${documentId}/extract`,
    TEST_MATCHING_TOKEN,
  );
const indexOf = (extraction: Extraction, key: string) =>
  extraction.fields.findIndex((field) => field.key === key);

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
  const company = randomUUID();
  companyId = company;
  await database.createCustomer({
    id: company,
    companyName: "Northstar Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  await database.grantCustomerMembership(
    company,
    TEST_CUSTOMER_A_ID,
    TEST_SUPER_ADMIN_ID,
  );
  seaJob = await openJob(company, "sea_import");
  airJob = await openJob(company, "air_import");
  container = containerWithCheckDigit("SYNU987654");
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

let documentId: string;
let firstDraft: Extraction;

test("reading a PDF gives a draft and changes nothing on the job", async () => {
  documentId = await upload(
    seaJob,
    await pdfWithText([
      "TRANSPORT BILL OF LADING",
      "MBL BK NO.: SYNBK00042   HBL NO.: SYN-SYNBK00042A",
      `Container ${container}`,
      "SEAL NO: SL-5501",
      "Booking Number: BK-778899",
    ]),
    "application/pdf",
    "bill-of-lading.pdf",
  );
  const response = await extract(seaJob, documentId);
  assert.equal(response.status, 201);
  firstDraft = await json<Extraction>(response);
  assert.equal(firstDraft.status, "draft");
  assert.equal(firstDraft.textFound, true);
  assert.equal(firstDraft.readBy, null);
  assert.equal(firstDraft.filename, "bill-of-lading.pdf");
  assert.deepEqual(
    firstDraft.fields
      .map((field) => [field.key, field.value, field.sealNumber])
      .sort(),
    [
      ["booking", "BK-778899", null],
      ["container", container, "SL-5501"],
      ["house_bl", "SYN-SYNBK00042A", null],
      ["master_bl", "SYNBK00042", null],
    ],
  );
  assert.ok(firstDraft.fields.every((field) => field.evidence.length > 0));
  assert.deepEqual(
    await references(seaJob),
    [],
    "a draft never touches the job",
  );
  const listed = await json<Extraction[]>(
    await get(`/api/v1/jobs/${seaJob}/extractions`),
  );
  assert.deepEqual(
    listed.map((item) => item.id),
    [firstDraft.id],
  );
});

test("approval applies the chosen fields, masters first, with corrections", async () => {
  const path = `/api/v1/jobs/${seaJob}/extractions/${firstDraft.id}/approve`;
  const pick = (key: string, over: Record<string, unknown> = {}) => {
    const index = indexOf(firstDraft, key);
    const field = firstDraft.fields[index];
    return { index, value: field.value, sealNumber: field.sealNumber, ...over };
  };
  const rejected = [
    [{ fields: [] }, "Choose at least one field to apply"],
    [{ fields: [{ index: 99, value: "X" }] }, "field 99 is not in this draft"],
    [
      { fields: [pick("booking"), pick("booking")] },
      "field " + indexOf(firstDraft, "booking") + " is listed twice",
    ],
    [{}, "fields must be a list"],
  ] as const;
  for (const [body, expected] of rejected) {
    const response = await post(path, TEST_MATCHING_TOKEN, body);
    assert.equal(response.status, 400, expected);
    assert.equal(await message(response), expected);
  }

  // The house document is listed first, yet the master is applied before it.
  const approved = await post(path, TEST_MATCHING_TOKEN, {
    fields: [
      pick("house_bl"),
      pick("master_bl"),
      pick("container", { sealNumber: "SL-5501-CORRECTED" }),
    ],
  });
  assert.equal(approved.status, 201);
  const reviewed = await json<Extraction>(approved);
  assert.equal(reviewed.status, "approved");
  assert.equal(reviewed.reviewedBy, TEST_MATCHING_USER_ID);
  assert.deepEqual(
    reviewed.applied!.map((item) => [item.key, item.result]),
    [
      ["master_bl", "added"],
      ["house_bl", "added"],
      ["container", "added"],
    ].sort((a, b) => indexOf(firstDraft, a[0]) - indexOf(firstDraft, b[0])),
  );

  const onJob = await references(seaJob);
  const master = onJob.find((item) => item.kind === "master_bl")!;
  assert.deepEqual(onJob.map((item) => item.kind).sort(), [
    "container",
    "house_bl",
    "master_bl",
  ]);
  assert.equal(
    onJob.find((item) => item.kind === "house_bl")!.parentReferenceId,
    master.id,
  );
  assert.equal(
    onJob.find((item) => item.kind === "container")!.sealNumber,
    "SL-5501-CORRECTED",
  );
  // The proposed fields themselves are kept as read.
  const [stored] = (
    await json<Extraction[]>(await get(`/api/v1/jobs/${seaJob}/extractions`))
  ).filter((item) => item.id === firstDraft.id);
  assert.equal(
    stored.fields.find((field) => field.key === "container")!.sealNumber,
    "SL-5501",
  );

  const again = await post(path, TEST_MATCHING_TOKEN, {
    fields: [pick("booking")],
  });
  assert.equal(again.status, 409);
  assert.equal(await message(again), "This draft was already reviewed");
});

test("a value can be corrected before it is applied, and repeats are reported", async () => {
  const second = await json<Extraction>(await extract(seaJob, documentId));
  const booking = indexOf(second, "booking");
  const dup = indexOf(second, "container");
  const response = await post(
    `/api/v1/jobs/${seaJob}/extractions/${second.id}/approve`,
    TEST_MATCHING_TOKEN,
    {
      fields: [
        { index: booking, value: "  BK-CORRECTED-1  " },
        { index: dup, value: container, sealNumber: "SL-5501-CORRECTED" },
      ],
    },
  );
  const reviewed = await json<Extraction>(response);
  assert.deepEqual(
    reviewed.applied!.map((item) => [item.key, item.value, item.result]),
    [
      ...[
        ["booking", "BK-CORRECTED-1", "added"],
        ["container", container, "already on the job"],
      ],
    ].sort((a, b) => indexOf(second, a[0]) - indexOf(second, b[0])),
  );
  assert.ok(
    (await references(seaJob)).some((item) => item.value === "BK-CORRECTED-1"),
  );
});

test("a house document needs its master, and sea documents do not belong on an air job", async () => {
  const lone = await openJob(companyId, "sea_import");
  const loneDocument = await upload(
    lone,
    await pdfWithText(["HBL NO.: SYN-LONE-0001"]),
    "application/pdf",
    "lone.pdf",
  );
  const draft = await json<Extraction>(await extract(lone, loneDocument));
  const noMaster = await json<Extraction>(
    await post(
      `/api/v1/jobs/${lone}/extractions/${draft.id}/approve`,
      TEST_MATCHING_TOKEN,
      {
        fields: [{ index: 0, value: draft.fields[0].value }],
      },
    ),
  );
  assert.equal(noMaster.status, "approved");
  assert.equal(
    noMaster.applied![0].result,
    "not added: apply or add the master (master_bl) first",
  );
  assert.deepEqual(await references(lone), []);

  const airDocument = await upload(
    airJob,
    await pdfWithText([`Container ${container}`]),
    "application/pdf",
    "air.pdf",
    TEST_SUPER_ADMIN_TOKEN,
  );
  const airDraft = await json<Extraction>(
    await post(
      `/api/v1/jobs/${airJob}/documents/${airDocument}/extract`,
      TEST_SUPER_ADMIN_TOKEN,
    ),
  );
  const refused = await json<Extraction>(
    await post(
      `/api/v1/jobs/${airJob}/extractions/${airDraft.id}/approve`,
      TEST_SUPER_ADMIN_TOKEN,
      {
        fields: [{ index: 0, value: container }],
      },
    ),
  );
  assert.equal(
    refused.applied![0].result,
    "not added: container cannot be recorded on a air_import job",
  );
  assert.deepEqual(
    await json<Reference[]>(
      await get(`/api/v1/jobs/${airJob}/references`, TEST_SUPER_ADMIN_TOKEN),
    ),
    [],
  );
});

test("a closed job takes no applied fields", async () => {
  const closing = await openJob(companyId, "sea_import");
  const closingDocument = await upload(
    closing,
    await pdfWithText(["Booking Number: BK-CLOSED-1"]),
    "application/pdf",
    "closing.pdf",
  );
  const draft = await json<Extraction>(await extract(closing, closingDocument));
  for (const status of ["in_progress", "ready_to_close", "closed"]) {
    assert.equal(
      (
        await post(`/api/v1/jobs/${closing}/status`, TEST_MATCHING_TOKEN, {
          status,
        })
      ).status,
      201,
    );
  }
  const blocked = await post(
    `/api/v1/jobs/${closing}/extractions/${draft.id}/approve`,
    TEST_MATCHING_TOKEN,
    {
      fields: [{ index: 0, value: "BK-CLOSED-1" }],
    },
  );
  assert.equal(blocked.status, 409);
  assert.equal(await message(blocked), "Reopen the job before changing it");
});

test("scans and images are not read, and a draft can be rejected", async () => {
  const blank = await upload(
    seaJob,
    await pdfWithText([]),
    "application/pdf",
    "scan.pdf",
  );
  const scanned = await json<Extraction>(await extract(seaJob, blank));
  assert.equal(scanned.textFound, false);
  assert.deepEqual(scanned.fields, []);

  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from("synthetic image"),
  ]);
  const image = await upload(seaJob, png, "image/png", "photo.png");
  const refused = await extract(seaJob, image);
  assert.equal(refused.status, 400);
  assert.match(
    await message(refused),
    /Only a PDF has text to read; images need AI reading/,
  );

  const path = `/api/v1/jobs/${seaJob}/extractions/${scanned.id}`;
  const rejected = await post(`${path}/reject`, TEST_MATCHING_TOKEN);
  assert.equal(rejected.status, 201);
  const result = await json<Extraction>(rejected);
  assert.equal(result.status, "rejected");
  assert.equal(result.applied, null);
  assert.equal((await post(`${path}/reject`, TEST_MATCHING_TOKEN)).status, 409);
  assert.equal(
    (
      await post(`${path}/approve`, TEST_MATCHING_TOKEN, {
        fields: [{ index: 0, value: "X" }],
      })
    ).status,
    409,
  );
});

test("access: staff only, within the job's department; unknown IDs are 404", async () => {
  const path = `/api/v1/jobs/${seaJob}`;
  assert.equal(
    (await get(`${path}/extractions`, TEST_CUSTOMER_A_TOKEN)).status,
    403,
  );
  assert.equal(
    (
      await post(
        `${path}/documents/${documentId}/extract`,
        TEST_CUSTOMER_A_TOKEN,
      )
    ).status,
    403,
  );
  assert.equal(
    (await get(`${path}/extractions`, TEST_UNASSIGNED_TOKEN)).status,
    404,
  );
  assert.equal(
    (
      await post(
        `${path}/documents/${documentId}/extract`,
        TEST_UNASSIGNED_TOKEN,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await post(
        `${path}/documents/${randomUUID()}/extract`,
        TEST_MATCHING_TOKEN,
      )
    ).status,
    404,
  );
  assert.equal(
    (await post(`${path}/documents/not-a-uuid/extract`, TEST_MATCHING_TOKEN))
      .status,
    404,
  );
  assert.equal(
    (
      await post(
        `${path}/extractions/${randomUUID()}/reject`,
        TEST_MATCHING_TOKEN,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await post(
        `${path}/documents/${documentId}/extract?version=0`,
        TEST_MATCHING_TOKEN,
      )
    ).status,
    400,
  );
  // Another job's document ID is not reachable through this job.
  assert.equal(
    (
      await post(
        `/api/v1/jobs/${airJob}/documents/${documentId}/extract`,
        TEST_SUPER_ADMIN_TOKEN,
      )
    ).status,
    404,
  );
});

test("with AI reading set up, a photo is read into a draft that records the model", async () => {
  testDocumentReader.model = "claude-haiku-5-5";
  testDocumentReader.calls = [];
  try {
    const photoContainer = containerWithCheckDigit("PHOU123456");
    testDocumentReader.result = [
      {
        key: "master_bl",
        label: "Master B/L or booking number",
        value: "PHOTOMBL001",
        sealNumber: null,
        evidence: "B/L No. PHOTOMBL001",
      },
      {
        key: "container",
        label: "Container",
        value: photoContainer,
        sealNumber: "PH-77",
        evidence: `${photoContainer} SEAL PH-77`,
      },
    ];
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.from("synthetic photo of a bill of lading"),
    ]);
    const photo = await upload(seaJob, jpeg, "image/jpeg", "bl-photo.jpg");
    const before = (await references(seaJob)).length;

    const response = await extract(seaJob, photo);
    assert.equal(response.status, 201);
    const draft = await json<Extraction>(response);
    assert.equal(draft.readBy, "claude-haiku-5-5");
    assert.equal(draft.status, "draft");
    assert.deepEqual(
      draft.fields.map((field) => field.value),
      ["PHOTOMBL001", photoContainer],
    );
    assert.deepEqual(testDocumentReader.calls, [
      { contentType: "image/jpeg", size: jpeg.length },
    ]);
    // A draft changes nothing on the job.
    assert.equal((await references(seaJob)).length, before);

    const applied = await post(
      `/api/v1/jobs/${seaJob}/extractions/${draft.id}/approve`,
      TEST_MATCHING_TOKEN,
      {
        fields: [
          { index: 0, value: "PHOTOMBL001" },
          { index: 1, value: photoContainer, sealNumber: "PH-77" },
        ],
      },
    );
    assert.equal(applied.status, 201);
    const result = await json<Extraction>(applied);
    assert.deepEqual(
      result.applied?.map((item) => item.result),
      ["added", "added"],
    );
    const saved = await references(seaJob);
    assert.ok(
      saved.some(
        (item) => item.value === photoContainer && item.sealNumber === "PH-77",
      ),
    );

    // A failed reading says why and leaves no draft behind.
    const drafts = (
      await json<Extraction[]>(await get(`/api/v1/jobs/${seaJob}/extractions`))
    ).length;
    testDocumentReader.result = new DocumentReadingError(
      "The AI service is busy or over its limit",
    );
    const failed = await extract(seaJob, photo);
    assert.equal(failed.status, 503);
    assert.match(await message(failed), /^The AI service is busy/);
    assert.equal(
      (
        await json<Extraction[]>(
          await get(`/api/v1/jobs/${seaJob}/extractions`),
        )
      ).length,
      drafts,
    );

    // Customers still cannot ask for a reading.
    assert.equal(
      (
        await post(
          `/api/v1/jobs/${seaJob}/documents/${photo}/extract`,
          TEST_CUSTOMER_A_TOKEN,
        )
      ).status,
      403,
    );
  } finally {
    testDocumentReader.model = null;
    testDocumentReader.result = [];
  }
});
