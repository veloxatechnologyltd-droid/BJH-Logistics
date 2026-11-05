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
  // A house B/L is numbered by the system, not from the job's House B/L reference.
  assert.equal(prefill.documentNumber, null);
  assert.deepEqual(prefill.fields, {
    shipper: "Synthetic Shipper Ltd\nBolgatanga, Ghana",
    consignee: "Synthetic Consignee LLC\nDoral, USA",
    notifyParty: "Synthetic Notify Co",
    deliveryAgent: "Synthetic Delivery Agent Ltd",
    masterReference: "SYNBK00042",
    containers: "SYNU1234568 | Seal 002686",
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
    "kind must be one of house_bl, house_awb, air_manifest, sea_manifest, delivery_order, proof_of_delivery",
  );
});

let draft: Doc;
let draftNumber: string | null = null;

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
      "kind must be one of house_bl, house_awb, air_manifest, sea_manifest, delivery_order, proof_of_delivery",
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
  // The draft is numbered as soon as it is prepared, so its preview shows it.
  assert.match(draft.documentNumber ?? "", /^BJH\/BL\/\d{4}\/\d{4}$/);
  assert.equal(
    draft.fields.shipper,
    "Synthetic Shipper Ltd\nBolgatanga, Ghana",
  );

  const edited = await put(`${base()}/${draft.id}`, TEST_MATCHING_TOKEN, {
    documentNumber: "  IGNORED-TYPED-NUMBER  ",
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
  // A number typed for a house B/L is ignored; editing does not change it.
  assert.equal(updated.documentNumber, draft.documentNumber);
  assert.equal(updated.fields.vessel, "IONIKOS");

  const issued = await post(`${base()}/${draft.id}/issue`, TEST_MATCHING_TOKEN);
  assert.equal(issued.status, 201);
  const frozen = await json<Doc>(issued);
  assert.equal(frozen.status, "issued");
  assert.ok(frozen.issuedAt);
  assert.match(frozen.documentNumber ?? "", /^BJH\/BL\/\d{4}\/\d{4}$/);
  assert.equal(frozen.documentNumber, draft.documentNumber);
  draftNumber = frozen.documentNumber;

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

test("voiding a house B/L does not reuse its number; the corrected one takes the next", async () => {
  const second = await json<Doc>(
    await post(base(), TEST_MATCHING_TOKEN, {
      kind: "house_bl",
      fields: { shipper: "Corrected Shipper" },
    }),
  );

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
  const correctedNumber = (await json<Doc>(corrected)).documentNumber;
  assert.match(correctedNumber ?? "", /^BJH\/BL\/\d{4}\/\d{4}$/);
  assert.notEqual(correctedNumber, draftNumber);
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
    /^inline; filename="house-bl-bjh-bl-\d{4}-\d{4}\.pdf"$/i,
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

test("a house B/L takes the next BJH/BL number when prepared; other kinds still need a typed one", async () => {
  const year = new Date().getUTCFullYear();
  const pattern = new RegExp(`^BJH/BL/${year}/(\\d{4})$`);
  const prepare = async (body: Record<string, unknown> = {}) =>
    json<Doc>(
      await post(base(), TEST_MATCHING_TOKEN, {
        kind: "house_bl",
        fields: {},
        ...body,
      }),
    );
  const sequence = (doc: Doc) =>
    Number(pattern.exec(doc.documentNumber ?? "")![1]);

  const first = await prepare();
  assert.match(first.documentNumber ?? "", pattern);
  assert.equal(first.status, "draft");
  const second = await prepare();
  assert.equal(sequence(second), sequence(first) + 1);

  // A typed number is ignored, and issuing keeps the number the draft already had.
  const typed = await prepare({ documentNumber: "SYN-HBL-TYPED" });
  assert.equal(sequence(typed), sequence(second) + 1);
  const issued = await json<Doc>(
    await post(`${base()}/${typed.id}/issue`, TEST_MATCHING_TOKEN),
  );
  assert.equal(issued.documentNumber, typed.documentNumber);

  // Air documents are not auto-numbered: the airline's number is typed.
  const air = `/api/v1/jobs/${airJob}/transport-documents`;
  const awb = await json<Doc>(
    await post(air, TEST_SUPER_ADMIN_TOKEN, { kind: "house_awb", fields: {} }),
  );
  const refused = await post(`${air}/${awb.id}/issue`, TEST_SUPER_ADMIN_TOKEN);
  assert.equal(refused.status, 400);
  assert.equal(
    await message(refused),
    "Enter the document number before issuing",
  );
});

test("a sea cargo manifest starts from the job, is issued, and is refused on an air job", async () => {
  const prefill = await json<Prefill>(
    await get(`${base()}/prefill?kind=sea_manifest`),
  );
  // One manifest per container: the container number is its number.
  assert.equal(prefill.documentNumber, "SYNU1234568");
  assert.equal(prefill.fields.containerNumber, "SYNU1234568");
  assert.equal(prefill.fields.masterReference, "SYNBK00042");
  assert.equal(
    prefill.fields.shipper,
    "Synthetic Shipper Ltd\nBolgatanga, Ghana",
  );
  // Fields the manifest does not have are not offered (they would be refused on save).
  assert.equal(prefill.fields.forwardingAgent, undefined);
  assert.equal(prefill.fields.notifyParty, undefined);

  const lines = JSON.stringify([
    {
      shipper: "Synthetic Shipper Ltd",
      consignee: "Synthetic Consignee LLC",
      blNumber: "SYN-HBL-0001A",
      description: "1 UNIT OF SYNTHETIC CAR",
      weightKg: "1500",
    },
  ]);
  const created = await post(base(), TEST_MATCHING_TOKEN, {
    kind: "sea_manifest",
    documentNumber: prefill.documentNumber,
    fields: { ...prefill.fields, manifestLines: lines },
  });
  assert.equal(created.status, 201);
  const manifest = await json<Doc>(created);
  assert.equal(manifest.kind, "sea_manifest");
  assert.equal(manifest.fields.manifestLines, lines);

  // A table can be longer than a text box: past the old 2000 characters.
  const long = JSON.stringify(
    Array.from({ length: 40 }, (_, index) => ({
      blNumber: `SYN-HBL-${index}`,
      description: "x".repeat(100),
    })),
  );
  assert.ok(long.length > 2000);
  const edited = await put(`${base()}/${manifest.id}`, TEST_MATCHING_TOKEN, {
    documentNumber: manifest.documentNumber,
    fields: { manifestLines: long },
  });
  assert.equal(edited.status, 200);

  const issued = await post(
    `${base()}/${manifest.id}/issue`,
    TEST_MATCHING_TOKEN,
  );
  assert.equal(issued.status, 201);
  const pdf = await get(`${base()}/${manifest.id}/pdf`);
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");

  // A sea manifest belongs to sea jobs only.
  const wrong = await post(
    `/api/v1/jobs/${airJob}/transport-documents`,
    TEST_SUPER_ADMIN_TOKEN,
    { kind: "sea_manifest", fields: {} },
  );
  assert.equal(wrong.status, 400);
  assert.equal(
    await message(wrong),
    "Sea cargo manifest cannot be prepared on a air_import job",
  );

  // The customer of the job reads it once issued; another customer cannot.
  assert.equal(
    (await get(`${base()}/${manifest.id}/pdf`, TEST_CUSTOMER_A_TOKEN)).status,
    200,
  );
  assert.equal(
    (await get(`${base()}/${manifest.id}/pdf`, TEST_CUSTOMER_B_TOKEN)).status,
    404,
  );
});

test("a delivery order and a proof of delivery start from the B/L, and belong to sea jobs", async () => {
  const order = await json<Prefill>(
    await get(`${base()}/prefill?kind=delivery_order`),
  );
  // Numbered after the house B/L reference; the date is today's.
  assert.equal(order.documentNumber, "BJH/DO/SYN-HBL-0001");
  assert.equal(order.fields.blNumber, "SYN-HBL-0001");
  assert.equal(order.fields.container, "SYNU1234568");
  assert.equal(order.fields.seals, "002686");
  assert.equal(order.fields.consignee, "Synthetic Consignee LLC\nDoral, USA");
  assert.match(order.fields.issueDate, /^\d{2} [A-Z][a-z]+ \d{4}$/);
  assert.equal(order.fields.notifyParty, undefined);

  const pod = await json<Prefill>(
    await get(`${base()}/prefill?kind=proof_of_delivery`),
  );
  assert.equal(pod.documentNumber, "BJH/POD/SYN-HBL-0001");
  assert.equal(pod.fields.issueDate, undefined);

  for (const [kind, prefill] of [
    ["delivery_order", order],
    ["proof_of_delivery", pod],
  ] as const) {
    const created = await post(base(), TEST_MATCHING_TOKEN, {
      kind,
      documentNumber: prefill.documentNumber,
      fields: { ...prefill.fields, packages: "56", grossWeight: "2840" },
    });
    assert.equal(created.status, 201, kind);
    const document = await json<Doc>(created);
    assert.equal(document.kind, kind);
    const issued = await post(
      `${base()}/${document.id}/issue`,
      TEST_MATCHING_TOKEN,
    );
    assert.equal(issued.status, 201, kind);
    const pdf = await get(`${base()}/${document.id}/pdf`);
    assert.equal(pdf.status, 200, kind);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    // Another customer cannot read it.
    assert.equal(
      (await get(`${base()}/${document.id}/pdf`, TEST_CUSTOMER_B_TOKEN)).status,
      404,
    );
  }

  const wrong = await post(
    `/api/v1/jobs/${airJob}/transport-documents`,
    TEST_SUPER_ADMIN_TOKEN,
    { kind: "delivery_order", fields: {} },
  );
  assert.equal(wrong.status, 400);
  assert.equal(
    await message(wrong),
    "Delivery order cannot be prepared on a air_import job",
  );
});
