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
const json = async <T>(response: Response) => (await response.json()) as T;

type Item = {
  kind: string;
  id: string;
  jobId: string;
  fileNumber: string;
  serviceLine: string;
  customerCompanyName: string;
  number: string | null;
  status: string;
  date: string;
};
const list = async (token: string) =>
  json<Item[]>(await call("/api/v1/shipping-documents", token));
const summary = (items: Item[]) =>
  items.map((item) => `${item.kind}:${item.number ?? "-"}:${item.status}`);

async function openJob(companyId: string, serviceLine: string) {
  const response = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine,
  });
  return (await json<{ id: string }>(response)).id;
}

/** A house document, optionally numbered and issued. */
async function houseDocument(
  jobId: string,
  kind: string,
  number: string | null,
) {
  const created = await json<{ id: string }>(
    await post(
      `/api/v1/jobs/${jobId}/transport-documents`,
      TEST_SUPER_ADMIN_TOKEN,
      { kind, ...(number ? { documentNumber: number } : {}) },
    ),
  );
  if (number) {
    const issued = await post(
      `/api/v1/jobs/${jobId}/transport-documents/${created.id}/issue`,
      TEST_SUPER_ADMIN_TOKEN,
    );
    assert.equal(issued.status, 201);
  }
  return created.id;
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
    "air_import_rep",
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
  roadJob = await openJob(companyB, "road_transport");

  await houseDocument(seaJob, "house_bl", "SYN-HBL-1");
  await houseDocument(airJob, "house_awb", "SYN-HAWB-1");
  await houseDocument(airJob, "air_manifest", null);

  const driver = await json<{ id: string }>(
    await post("/api/v1/drivers", TEST_SUPER_ADMIN_TOKEN, {
      name: "Kofi Synthetic",
      phone: "000 111 2222",
    }),
  );
  const vehicle = await json<{ id: string }>(
    await post("/api/v1/vehicles", TEST_SUPER_ADMIN_TOKEN, {
      registration: "GX 0001-26",
    }),
  );
  const dispatched = await post(
    `/api/v1/jobs/${roadJob}/deliveries`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      driverId: driver.id,
      vehicleId: vehicle.id,
      cargoDescription: "82 sacks of woven baskets",
      deliveryAddress: "1 Test Road, Sample City",
    },
  );
  assert.equal(dispatched.status, 201);
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("one list holds the bill of lading, air waybill, manifest and road waybill of every job", async () => {
  const items = await list(TEST_SUPER_ADMIN_TOKEN);
  assert.equal(items.length, 4);
  assert.deepEqual(
    summary(items)
      .map((line) => line.replace(/BJH\/WB\/\d{4}\/\d+/, "WAYBILL"))
      .sort(),
    [
      "air_manifest:-:draft",
      "house_awb:SYN-HAWB-1:issued",
      "house_bl:SYN-HBL-1:issued",
      "waybill:WAYBILL:dispatched",
    ].sort(),
  );
  const bill = items.find((item) => item.kind === "house_bl")!;
  assert.equal(bill.jobId, seaJob);
  assert.equal(bill.serviceLine, "sea_import");
  assert.equal(bill.customerCompanyName, "Northstar Synthetic Ltd");
  assert.match(bill.fileNumber, /\/SI\//);
  const waybill = items.find((item) => item.kind === "waybill")!;
  assert.equal(waybill.jobId, roadJob);
  assert.equal(waybill.customerCompanyName, "Southwind Synthetic Ltd");
  // Newest first.
  assert.deepEqual(
    items.map((item) => item.date),
    items
      .map((item) => item.date)
      .sort()
      .reverse(),
  );
});

test("a voided house document stays in the list with its status", async () => {
  const id = await houseDocument(seaJob, "house_bl", "SYN-HBL-2");
  const voided = await post(
    `/api/v1/jobs/${seaJob}/transport-documents/${id}/void`,
    TEST_SUPER_ADMIN_TOKEN,
    { reason: "Wrong consignee" },
  );
  assert.equal(voided.status, 201);
  const item = (await list(TEST_SUPER_ADMIN_TOKEN)).find(
    (entry) => entry.id === id,
  )!;
  assert.equal(item.status, "void");
  assert.equal(item.number, "SYN-HBL-2");
});

test("a rep sees their own service lines and the shared road work, not other departments' bills", async () => {
  // Sea-import rep: the sea bill of lading and the road waybill (road work is shared).
  const sea = await list(TEST_MATCHING_TOKEN);
  assert.deepEqual([...new Set(sea.map((item) => item.serviceLine))].sort(), [
    "road_transport",
    "sea_import",
  ]);
  assert.ok(sea.every((item) => item.kind !== "house_awb"));
  // Air-import rep: both air documents and the road waybill, no sea bill.
  const air = await list(TEST_UNASSIGNED_TOKEN);
  assert.deepEqual([...new Set(air.map((item) => item.kind))].sort(), [
    "air_manifest",
    "house_awb",
    "waybill",
  ]);
});

test("customers and anonymous callers cannot read the list", async () => {
  for (const token of [TEST_CUSTOMER_A_TOKEN, TEST_CUSTOMER_B_TOKEN]) {
    assert.equal((await call("/api/v1/shipping-documents", token)).status, 403);
  }
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/shipping-documents`)).status,
    401,
  );
});
