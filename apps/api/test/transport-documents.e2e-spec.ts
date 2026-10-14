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
let seaJob: string;
let airJob: string;
let roadJob: string;

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
const put = (path: string, token: string, body: unknown) =>
  call(path, token, { method: "PUT", body: JSON.stringify(body) });
const get = (path: string, token = TEST_MATCHING_TOKEN) => call(path, token);
const json = async <T>(response: Response) => (await response.json()) as T;
const message = async (response: Response) =>
  ((await response.json()) as { message: string }).message;

type Doc = {
  id: string;
  kind: string;
  documentNumber: string | null;
  status: string;
  fields: Record<string, string>;
  issuedAt: string | null;
  voidReason: string | null;
};
type Prefill = {
  documentNumber: string | null;
  fields: Record<string, string>;
};

async function openJob(companyId: string, serviceLine: string) {
  const response = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine,
  });
  return (await json<{ id: string }>(response)).id;
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
  const [companyA, companyB] = [randomUUID(), randomUUID()];
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
  seaJob = await openJob(companyA, "sea_import");
  airJob = await openJob(companyA, "air_import");
  roadJob = await openJob(companyA, "road_transport");
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

const base = () => `/api/v1/jobs/${seaJob}/transport-documents`;

test("a document starts from what the job already holds", async () => {
  const jobPath = `/api/v1/jobs/${seaJob}`;
  for (const party of [
    {
      role: "shipper",
      name: "Synthetic Shipper Ltd",
      details: "Bolgatanga, Ghana",
    },
    {
      role: "consignee",
      name: "Synthetic Consignee LLC",
      details: "Doral, USA",
    },
    { role: "notify_party", name: "Synthetic Notify Co" },
    { role: "agent", name: "Synthetic Delivery Agent Ltd" },
  ]) {
    assert.equal(
      (await post(`${jobPath}/parties`, TEST_MATCHING_TOKEN, party)).status,
      201,
    );
  }
  const master = await json<{ id: string }>(
    await post(`${jobPath}/references`, TEST_MATCHING_TOKEN, {
      kind: "master_bl",
      value: "SYNBK00042",
    }),
  );
  await post(`${jobPath}/references`, TEST_MATCHING_TOKEN, {
    kind: "house_bl",
    value: "SYN-HBL-0001",
    parentReferenceId: master.id,
  });
  await post(`${jobPath}/references`, TEST_MATCHING_TOKEN, {
    kind: "container",
    value: "SYNU1234568",
    sealNumber: "002686",
  });

  const prefill = await json<Prefill>(
    await get(`${base()}/prefill?kind=house_bl`),
  );
  assert.equal(prefill.documentNumber, "SYN-HBL-0001");
  assert.deepEqual(prefill.fields, {
    shipper: "Synthetic Shipper Ltd\nBolgatanga, Ghana",
    consignee: "Synthetic Consignee LLC\nDoral, USA",
    notifyParty: "Synthetic Notify Co",
    deliveryAgent: "Synthetic Delivery Agent Ltd",
    masterReference: "SYNBK00042",
    containers: "SYNU1234568, seal 002686",
  });

  // With business settings saved, BJH is the forwarding agent.
  await put("/api/v1/settings", TEST_SUPER_ADMIN_TOKEN, {
    issuer: {
      name: "Synthetic Forwarding Ltd",
      address: "1 Test Road",
      email: "docs@synthetic.test",
    },
    currencies: ["GHS"],
    numbering: {
      quotePrefix: "SYN/Q",
      invoicePrefix: "SYN/INV",
      receiptPrefix: "SYN/RCT",
    },
    quoteDefaults: {},
  });
  const withAgent = await json<Prefill>(
    await get(`${base()}/prefill?kind=house_bl`),
  );
  assert.equal(
    withAgent.fields.forwardingAgent,
    "Synthetic Forwarding Ltd\n1 Test Road\ndocs@synthetic.test",
  );

  const wrongLine = await get(`${base()}/prefill?kind=house_awb`);
  assert.equal(wrongLine.status, 400);
  assert.equal(
    await message(wrongLine),
    "House air waybill (HAWB) cannot be prepared on a sea_import job",
  );
  const unknown = await get(`${base()}/prefill?kind=passport`);
  assert.equal(unknown.status, 400);
  assert.equal(
    await message(unknown),
    "kind must be one of house_bl, house_awb, air_manifest",
  );
});

let draft: Doc;

test("a draft is edited, numbered and issued; an issued document is frozen", async () => {
  const prefill = await json<Prefill>(
    await get(`${base()}/prefill?kind=house_bl`),
  );
  const cases: Array<[Record<string, unknown>, string]> = [
    [
      { kind: "house_bl", fields: { masterAwb: "x" } },
      "masterAwb is not a field of this document",
    ],
    [
      { kind: "house_bl", fields: { vessel: "x".repeat(301) } },
      "Vessel must be at most 300 characters",
    ],
    [
      { kind: "manifest" },
      "kind must be one of house_bl, house_awb, air_manifest",
    ],
    [{ kind: "house_bl", fields: "no" }, "fields must be an object"],
  ];
  for (const [body, expected] of cases) {
    const rejected = await post(base(), TEST_MATCHING_TOKEN, body);
    assert.equal(rejected.status, 400, expected);
    assert.equal(await message(rejected), expected);
  }

  const created = await post(base(), TEST_MATCHING_TOKEN, {
    kind: "house_bl",
    fields: prefill.fields,
  });
  assert.equal(created.status, 201);
  draft = await json<Doc>(created);
  assert.equal(draft.status, "draft");
  assert.equal(draft.documentNumber, null);
  assert.equal(
    draft.fields.shipper,
    "Synthetic Shipper Ltd\nBolgatanga, Ghana",
  );

  const noNumber = await post(
    `${base()}/${draft.id}/issue`,
    TEST_MATCHING_TOKEN,
  );
  assert.equal(noNumber.status, 400);
  assert.equal(
    await message(noNumber),
    "Enter the document number before issuing",
  );

  const edited = await put(`${base()}/${draft.id}`, TEST_MATCHING_TOKEN, {
    documentNumber: "  SYN-HBL-0001  ",
    fields: {
      ...prefill.fields,
      vessel: "IONIKOS",
      voyage: "2639N",
      goods: "82 SACKS WOVEN BASKETS",
      freightTerms: "FREIGHT COLLECT",
    },
  });
  assert.equal(edited.status, 200);
  const updated = await json<Doc>(edited);
  assert.equal(updated.documentNumber, "SYN-HBL-0001");
  assert.equal(updated.fields.vessel, "IONIKOS");

  const issued = await post(`${base()}/${draft.id}/issue`, TEST_MATCHING_TOKEN);
  assert.equal(issued.status, 201);
  const frozen = await json<Doc>(issued);
  assert.equal(frozen.status, "issued");
  assert.ok(frozen.issuedAt);

  const edit = await put(`${base()}/${draft.id}`, TEST_MATCHING_TOKEN, {
    documentNumber: "OTHER",
    fields: {},
  });
  assert.equal(edit.status, 409);
  assert.match(await message(edit), /Only a draft can be edited/);
  assert.equal(
    (await post(`${base()}/${draft.id}/issue`, TEST_MATCHING_TOKEN)).status,
    409,
  );
  assert.equal(
    (
      await put(`${base()}/${randomUUID()}`, TEST_MATCHING_TOKEN, {
        fields: {},
      })
    ).status,
    404,
  );
  assert.equal(
    (await put(`${base()}/not-a-uuid`, TEST_MATCHING_TOKEN, { fields: {} }))
      .status,
    404,
  );
});

test("a number is used once; voiding frees it for the corrected document", async () => {
  const second = await json<Doc>(
    await post(base(), TEST_MATCHING_TOKEN, {
      kind: "house_bl",
      documentNumber: "syn-hbl-0001",
      fields: { shipper: "Corrected Shipper" },
    }),
  );
  const taken = await post(`${base()}/${second.id}/issue`, TEST_MATCHING_TOKEN);
  assert.equal(taken.status, 409);
  assert.match(await message(taken), /number syn-hbl-0001 is already issued/);

  const noReason = await post(
    `${base()}/${draft.id}/void`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(noReason.status, 400);
  const voided = await post(`${base()}/${draft.id}/void`, TEST_MATCHING_TOKEN, {
    reason: "Wrong shipper",
  });
  assert.equal(voided.status, 201);
  assert.equal((await json<Doc>(voided)).voidReason, "Wrong shipper");
  assert.equal(
    (
      await post(`${base()}/${draft.id}/void`, TEST_MATCHING_TOKEN, {
        reason: "again",
      })
    ).status,
    409,
  );

  const corrected = await post(
    `${base()}/${second.id}/issue`,
    TEST_MATCHING_TOKEN,
  );
  assert.equal(corrected.status, 201);
  const all = await json<Doc[]>(await get(base()));
  assert.deepEqual(
    all.map((item) => item.status),
    ["void", "issued"],
  );
});

test("the PDF is served to staff, and customers reach only issued documents of their own company", async () => {
  const all = await json<Doc[]>(await get(base()));
  const issued = all.find((item) => item.status === "issued")!;
  const voided = all.find((item) => item.status === "void")!;
  const hidden = await json<Doc>(
    await post(base(), TEST_MATCHING_TOKEN, {
      kind: "house_bl",
      fields: { shipper: "Never sent" },
    }),
  );

  const pdf = await get(`${base()}/${issued.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(
    pdf.headers.get("content-disposition") ?? "",
    /^inline; filename="house-bl-syn-hbl-0001\.pdf"$/,
  );
  assert.equal(
    Buffer.from(await pdf.arrayBuffer())
      .subarray(0, 5)
      .toString("latin1"),
    "%PDF-",
  );
  assert.equal(
    (await get(`${base()}/${hidden.id}/pdf`)).status,
    200,
    "staff can preview a draft",
  );

  // The customer sees the issued document and the one voided after issue, never a draft.
  const asCustomer = await json<Doc[]>(
    await get(base(), TEST_CUSTOMER_A_TOKEN),
  );
  assert.deepEqual(
    asCustomer.map((item) => item.id).sort(),
    [issued.id, voided.id].sort(),
  );
  assert.equal(
    (await get(`${base()}/${issued.id}/pdf`, TEST_CUSTOMER_A_TOKEN)).status,
    200,
  );
  assert.equal(
    (await get(`${base()}/${hidden.id}/pdf`, TEST_CUSTOMER_A_TOKEN)).status,
    404,
  );
  assert.equal((await get(base(), TEST_CUSTOMER_B_TOKEN)).status, 404);
  assert.equal(
    (await get(`${base()}/${issued.id}/pdf`, TEST_CUSTOMER_B_TOKEN)).status,
    404,
  );
  assert.equal((await get(base(), TEST_UNASSIGNED_TOKEN)).status, 404);

  for (const [method, path] of [
    ["POST", base()],
    ["GET", `${base()}/prefill?kind=house_bl`],
    ["PUT", `${base()}/${hidden.id}`],
    ["POST", `${base()}/${hidden.id}/issue`],
    ["POST", `${base()}/${issued.id}/void`],
  ] as const) {
    const response = await call(path, TEST_CUSTOMER_A_TOKEN, {
      method,
      body:
        method === "GET"
          ? undefined
          : JSON.stringify({ kind: "house_bl", reason: "x", fields: {} }),
    });
    assert.equal(response.status, 403, `${method} ${path}`);
  }
  assert.equal(
    (await get(`/api/v1/jobs/${roadJob}/transport-documents/${issued.id}/pdf`))
      .status,
    404,
  );
});

test("air jobs take a house air waybill and a manifest; other lines take none", async () => {
  const air = `/api/v1/jobs/${airJob}/transport-documents`;
  await post(`/api/v1/jobs/${airJob}/references`, TEST_SUPER_ADMIN_TOKEN, {
    kind: "master_awb",
    value: "999-12345678",
  });
  const master = (
    await json<Array<{ id: string }>>(
      await get(`/api/v1/jobs/${airJob}/references`, TEST_SUPER_ADMIN_TOKEN),
    )
  )[0];
  await post(`/api/v1/jobs/${airJob}/references`, TEST_SUPER_ADMIN_TOKEN, {
    kind: "house_awb",
    value: "SYN-2026A1",
    parentReferenceId: master.id,
  });

  const prefill = await json<Prefill>(
    await get(`${air}/prefill?kind=air_manifest`, TEST_SUPER_ADMIN_TOKEN),
  );
  assert.equal(prefill.documentNumber, "SYN-2026A1");
  assert.equal(prefill.fields.masterAwb, "999-12345678");
  assert.equal(prefill.fields.houseAwb, "SYN-2026A1");

  for (const kind of ["house_awb", "air_manifest"]) {
    const created = await post(air, TEST_SUPER_ADMIN_TOKEN, {
      kind,
      documentNumber: `SYN-${kind}`,
      fields: { masterAwb: "999-12345678", carrier: "SYNTHETIC AIR" },
    });
    assert.equal(created.status, kind === "house_awb" ? 201 : 400, kind);
  }
  const manifest = await post(air, TEST_SUPER_ADMIN_TOKEN, {
    kind: "air_manifest",
    documentNumber: "SYN-MANIFEST-1",
    fields: {
      masterAwb: "999-12345678",
      shipmentLines: "SYN-2026A1 | 259 CTNS",
    },
  });
  assert.equal(manifest.status, 201);
  const wrong = await post(air, TEST_SUPER_ADMIN_TOKEN, {
    kind: "house_bl",
    fields: {},
  });
  assert.equal(wrong.status, 400);
  assert.equal(
    await message(wrong),
    "Transport bill of lading (house B/L) cannot be prepared on a air_import job",
  );
  const road = await post(
    `/api/v1/jobs/${roadJob}/transport-documents`,
    TEST_SUPER_ADMIN_TOKEN,
    { kind: "house_bl", fields: {} },
  );
  assert.equal(road.status, 400);
});

test("a closed job takes no new documents", async () => {
  const closing = await openJob(
    await (async () => {
      const jobs = await json<Array<{ id: string; customerCompanyId: string }>>(
        await get("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN),
      );
      return jobs[0].customerCompanyId;
    })(),
    "sea_import",
  );
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
    `/api/v1/jobs/${closing}/transport-documents`,
    TEST_MATCHING_TOKEN,
    { kind: "house_bl", fields: {} },
  );
  assert.equal(blocked.status, 409);
  assert.equal(await message(blocked), "Reopen the job before changing it");
});
