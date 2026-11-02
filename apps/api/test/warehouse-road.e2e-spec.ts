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
let warehouseJob: string;
let warehouseJobB: string;
let roadJob: string;
let seaJob: string;
let bayA: string;
let bayB: string;

const year = new Date().getUTCFullYear();

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
const get = (path: string, token = TEST_MATCHING_TOKEN) => call(path, token);
const json = async <T>(response: Response) => (await response.json()) as T;
const message = async (response: Response) =>
  ((await response.json()) as { message: string }).message;

type Job = { id: string; fileNumber: string };
async function openJob(
  companyId: string,
  serviceLine: string,
  token = TEST_MATCHING_TOKEN,
) {
  const response = await post("/api/v1/jobs", token, {
    customerCompanyId: companyId,
    serviceLine,
  });
  assert.equal(response.status, 201, serviceLine);
  return json<Job>(response);
}

type Balance = {
  locationName: string;
  item: string;
  unit: string;
  balance: number;
  fileNumber: string;
};
type Stock = {
  movements: Array<{ kind: string; quantity: number }>;
  balances: Balance[];
};

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
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "customer_service_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "finance_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "export_rep",
    TEST_SUPER_ADMIN_ID,
  );
  [companyA, companyB] = [randomUUID(), randomUUID()];
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

test("warehousing and road jobs are shared work with their own file numbers", async () => {
  const warehouse = await openJob(companyA, "warehousing");
  const road = await openJob(companyA, "road_transport");
  const sea = await openJob(companyA, "sea_import");
  warehouseJob = warehouse.id;
  roadJob = road.id;
  seaJob = sea.id;
  warehouseJobB = (
    await openJob(companyB, "warehousing", TEST_UNASSIGNED_TOKEN)
  ).id;
  assert.equal(warehouse.fileNumber, `BJH/WH/${year}/0001`);
  assert.equal(road.fileNumber, `BJH/RT/${year}/0001`);
  assert.equal(sea.fileNumber, `BJH/SI/${year}/0001`);

  // A rep for another line opens and sees them (no separate role), but not another line's jobs.
  assert.equal(
    (await get(`/api/v1/jobs/${warehouseJob}`, TEST_UNASSIGNED_TOKEN)).status,
    200,
  );
  assert.equal(
    (await get(`/api/v1/jobs/${roadJob}`, TEST_UNASSIGNED_TOKEN)).status,
    200,
  );
  assert.equal(
    (await get(`/api/v1/jobs/${seaJob}`, TEST_UNASSIGNED_TOKEN)).status,
    404,
  );
  // Customers still see only their own company's.
  assert.equal(
    (await get(`/api/v1/jobs/${warehouseJob}`, TEST_CUSTOMER_A_TOKEN)).status,
    200,
  );
  assert.equal(
    (await get(`/api/v1/jobs/${warehouseJob}`, TEST_CUSTOMER_B_TOKEN)).status,
    404,
  );
  assert.equal(
    (await get(`/api/v1/jobs/${roadJob}`, TEST_CUSTOMER_B_TOKEN)).status,
    404,
  );
  // Customers cannot open one.
  assert.equal(
    (
      await post("/api/v1/jobs", TEST_CUSTOMER_A_TOKEN, {
        customerCompanyId: companyA,
        serviceLine: "warehousing",
      })
    ).status,
    403,
  );
});

test("these lines take a booking or container reference and no milestones", async () => {
  const ok = await post(
    `/api/v1/jobs/${warehouseJob}/references`,
    TEST_MATCHING_TOKEN,
    {
      kind: "booking",
      value: "WH-BOOK-1",
    },
  );
  assert.equal(ok.status, 201);
  const bill = await post(
    `/api/v1/jobs/${warehouseJob}/references`,
    TEST_MATCHING_TOKEN,
    {
      kind: "master_bl",
      value: "MBL-1",
    },
  );
  assert.equal(bill.status, 400);
  assert.match(await message(bill), /cannot be recorded on a warehousing job/);
  const milestone = await post(
    `/api/v1/jobs/${roadJob}/milestones`,
    TEST_MATCHING_TOKEN,
    {
      milestoneKey: "cargo_arrived",
    },
  );
  assert.equal(milestone.status, 400);
});

test("staff manage warehouse locations", async () => {
  const path = "/api/v1/warehouse/locations";
  const created = await post(path, TEST_MATCHING_TOKEN, { name: "  Bay A1 " });
  assert.equal(created.status, 201);
  bayA = (await json<{ id: string; name: string }>(created)).id;
  bayB = (
    await json<{ id: string }>(
      await post(path, TEST_UNASSIGNED_TOKEN, { name: "Bay B2" }),
    )
  ).id;
  assert.equal(
    (await post(path, TEST_MATCHING_TOKEN, { name: "bay a1" })).status,
    409,
  );
  const missing = await post(path, TEST_MATCHING_TOKEN, {});
  assert.equal(missing.status, 400);
  assert.equal(await message(missing), "name is required");
  assert.equal((await json<unknown[]>(await get(path))).length, 2);
  for (const token of [TEST_CUSTOMER_A_TOKEN, TEST_CUSTOMER_B_TOKEN]) {
    assert.equal((await get(path, token)).status, 403);
    assert.equal((await post(path, token, { name: "x" })).status, 403);
  }
  assert.equal(
    (
      await post(`${path}/${randomUUID()}/active`, TEST_MATCHING_TOKEN, {
        active: false,
      })
    ).status,
    404,
  );
});

const movement = (over: Record<string, unknown> = {}) => ({
  locationId: bayA,
  kind: "receipt",
  item: "Cartons of tiles",
  unit: "cartons",
  quantity: 10,
  occurredAt: "2026-01-01T09:00:00Z",
  ...over,
});

test("goods received and released keep a balance that never goes negative", async () => {
  const path = `/api/v1/jobs/${warehouseJob}/stock`;
  const received = await post(
    path,
    TEST_MATCHING_TOKEN,
    movement({ conditionNotes: "  2 cartons damp  ", reference: " DN-1 " }),
  );
  assert.equal(received.status, 201);
  const entry = await json<{
    conditionNotes: string;
    reference: string;
    locationName: string;
  }>(received);
  assert.equal(entry.conditionNotes, "2 cartons damp");
  assert.equal(entry.reference, "DN-1");
  assert.equal(entry.locationName, "Bay A1");

  assert.equal(
    (
      await post(
        path,
        TEST_MATCHING_TOKEN,
        movement({
          kind: "release",
          quantity: 4,
          occurredAt: "2026-02-01T09:00:00Z",
        }),
      )
    ).status,
    201,
  );
  const tooMany = await post(
    path,
    TEST_MATCHING_TOKEN,
    movement({
      kind: "release",
      item: "cartons of TILES",
      unit: "CARTONS",
      quantity: 7,
      occurredAt: "2026-03-01T09:00:00Z",
    }),
  );
  assert.equal(tooMany.status, 409);
  assert.match(await message(tooMany), /^Insufficient stock/);
  // A backdated release that would leave an earlier date short is refused too.
  const early = await post(
    path,
    TEST_MATCHING_TOKEN,
    movement({
      kind: "release",
      quantity: 8,
      occurredAt: "2026-01-15T09:00:00Z",
    }),
  );
  assert.equal(early.status, 409);
  assert.equal(
    (
      await post(
        path,
        TEST_MATCHING_TOKEN,
        movement({
          kind: "release",
          quantity: 6,
          occurredAt: "2026-03-01T09:00:00Z",
        }),
      )
    ).status,
    201,
  );
  // Nothing is left; another location or another item is a different stock line.
  assert.equal(
    (
      await post(
        path,
        TEST_MATCHING_TOKEN,
        movement({
          kind: "release",
          quantity: 1,
          occurredAt: "2026-03-02T09:00:00Z",
        }),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await post(
        path,
        TEST_MATCHING_TOKEN,
        movement({
          kind: "release",
          locationId: bayB,
          quantity: 1,
          occurredAt: "2026-03-02T09:00:00Z",
        }),
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await post(
        path,
        TEST_MATCHING_TOKEN,
        movement({
          locationId: bayB,
          item: "Paint",
          unit: "tins",
          quantity: 20,
          occurredAt: "2026-03-03T09:00:00Z",
        }),
      )
    ).status,
    201,
  );

  const stock = await json<Stock>(await get(path));
  assert.equal(stock.movements.length, 4);
  assert.deepEqual(
    stock.balances.map((item) => [
      item.locationName,
      item.item,
      item.unit,
      item.balance,
    ]),
    [["Bay B2", "Paint", "tins", 20]],
  );
});

test("invalid movements are rejected", async () => {
  const path = `/api/v1/jobs/${warehouseJob}/stock`;
  const cases: Array<[Record<string, unknown>, number, string]> = [
    [{ locationId: "nope" }, 400, "locationId must be a valid ID"],
    [{ kind: "move" }, 400, "kind must be receipt or release"],
    [{ item: "  " }, 400, "item must contain 1 to 200 characters"],
    [{ quantity: 0 }, 400, "quantity must be 1 to 100000000"],
    [{ quantity: 1.5 }, 400, "quantity must be a whole number"],
    [{ occurredAt: "soon" }, 400, "occurredAt must be a date and time"],
    [
      { occurredAt: new Date(Date.now() + 3_600_000).toISOString() },
      400,
      "occurredAt cannot be in the future",
    ],
    [{ locationId: randomUUID() }, 400, "locationId must be a location in use"],
  ];
  for (const [over, status, expected] of cases) {
    const response = await post(path, TEST_MATCHING_TOKEN, movement(over));
    assert.equal(response.status, status, expected);
    assert.equal(await message(response), expected);
  }
  // A location taken out of use takes no new goods.
  const retired = await json<{ id: string }>(
    await post("/api/v1/warehouse/locations", TEST_MATCHING_TOKEN, {
      name: "Retired bay",
    }),
  );
  await post(
    `/api/v1/warehouse/locations/${retired.id}/active`,
    TEST_MATCHING_TOKEN,
    { active: false },
  );
  const inUse = await post(
    path,
    TEST_MATCHING_TOKEN,
    movement({ locationId: retired.id }),
  );
  assert.equal(inUse.status, 400);
  // Stock belongs to a warehousing job only.
  const wrongJob = await post(
    `/api/v1/jobs/${seaJob}/stock`,
    TEST_MATCHING_TOKEN,
    movement(),
  );
  assert.equal(wrongJob.status, 409);
  assert.equal(
    await message(wrongJob),
    "Stock is recorded on a warehousing job",
  );
});

test("stock is company-scoped: customers read their own, never another company's", async () => {
  const path = `/api/v1/jobs/${warehouseJob}/stock`;
  assert.equal((await get(path, TEST_CUSTOMER_A_TOKEN)).status, 200);
  assert.equal((await get(path, TEST_CUSTOMER_B_TOKEN)).status, 404);
  assert.equal(
    (await post(path, TEST_CUSTOMER_A_TOKEN, movement())).status,
    403,
  );
  assert.equal((await get(`/api/v1/jobs/${randomUUID()}/stock`)).status, 404);
  // Company B's warehouse job holds its own goods.
  await post(
    `/api/v1/jobs/${warehouseJobB}/stock`,
    TEST_UNASSIGNED_TOKEN,
    movement({ item: "Steel drums", unit: "drums", quantity: 5 }),
  );
  const own = await json<Stock>(
    await get(`/api/v1/jobs/${warehouseJobB}/stock`, TEST_CUSTOMER_B_TOKEN),
  );
  assert.deepEqual(
    own.balances.map((item) => item.item),
    ["Steel drums"],
  );
});

test("the stock report is dated, per customer and within the caller's scope", async () => {
  const report = async (query: string, token = TEST_MATCHING_TOKEN) =>
    json<{ asOf: string | null; balances: Balance[] }>(
      await get(`/api/v1/stock/report${query}`, token),
    );
  const tiles = (rows: Balance[]) =>
    rows
      .filter((row) => row.item === "Cartons of tiles")
      .map((row) => row.balance);

  assert.deepEqual(tiles((await report("?asOf=2026-01-15")).balances), [10]);
  assert.deepEqual(tiles((await report("?asOf=2026-02-01")).balances), [6]);
  assert.deepEqual(tiles((await report("?asOf=2026-03-01")).balances), []);
  assert.deepEqual(tiles((await report("?asOf=2025-12-31")).balances), []);
  const now = await report("");
  assert.equal(now.asOf, null);
  assert.deepEqual(now.balances.map((row) => row.item).sort(), [
    "Paint",
    "Steel drums",
  ]);

  const forCompany = await report(`?companyId=${companyB}`);
  assert.deepEqual(
    forCompany.balances.map((row) => row.item),
    ["Steel drums"],
  );
  // Customers see their own company's stock only, whatever they ask for.
  assert.deepEqual(
    (await report("", TEST_CUSTOMER_B_TOKEN)).balances.map((row) => row.item),
    ["Steel drums"],
  );
  assert.deepEqual(
    (await report(`?companyId=${companyB}`, TEST_CUSTOMER_A_TOKEN)).balances,
    [],
  );
  for (const [query, expected] of [
    ["?asOf=2026-02-30", "asOf must be a date (YYYY-MM-DD)"],
    ["?asOf=tomorrow", "asOf must be a date (YYYY-MM-DD)"],
    ["?companyId=nope", "companyId must be a valid ID"],
  ]) {
    const response = await get(`/api/v1/stock/report${query}`);
    assert.equal(response.status, 400, query);
    assert.equal(await message(response), expected);
  }
});

test("a closed warehouse job takes no more stock", async () => {
  for (const status of ["in_progress", "ready_to_close", "closed"]) {
    assert.equal(
      (
        await post(
          `/api/v1/jobs/${warehouseJobB}/status`,
          TEST_UNASSIGNED_TOKEN,
          { status },
        )
      ).status,
      201,
    );
  }
  const closed = await post(
    `/api/v1/jobs/${warehouseJobB}/stock`,
    TEST_UNASSIGNED_TOKEN,
    movement({ item: "More drums", unit: "drums" }),
  );
  assert.equal(closed.status, 409);
  assert.equal(await message(closed), "Reopen the job before changing it");
});

test("a standalone road job dispatches a waybill, is quoted and invoiced like any other", async () => {
  const driver = await json<{ id: string }>(
    await post("/api/v1/drivers", TEST_MATCHING_TOKEN, {
      name: "Kofi",
      phone: "000",
    }),
  );
  const vehicle = await json<{ id: string }>(
    await post("/api/v1/vehicles", TEST_MATCHING_TOKEN, {
      registration: "GX 7-26",
    }),
  );
  const dispatched = await post(
    `/api/v1/jobs/${roadJob}/deliveries`,
    TEST_MATCHING_TOKEN,
    {
      driverId: driver.id,
      vehicleId: vehicle.id,
      cargoDescription: "20 pallets of bagged cement",
      packages: 20,
      pickupLocation: "Tema depot",
      deliveryAddress: "Kumasi site 4",
    },
  );
  assert.equal(dispatched.status, 201);
  const delivery = await json<{ id: string; waybillNumber: string }>(
    dispatched,
  );
  assert.match(delivery.waybillNumber, /^BJH\/WB\/\d{4}\/0001$/);
  assert.equal(
    (
      await get(
        `/api/v1/jobs/${roadJob}/deliveries/${delivery.id}/pdf`,
        TEST_CUSTOMER_A_TOKEN,
      )
    ).status,
    200,
  );

  const quote = await post("/api/v1/quotes", TEST_MATCHING_TOKEN, {
    customerCompanyId: companyA,
    serviceLine: "road_transport",
    version: {
      currency: "GHS",
      title: "Road haulage Tema to Kumasi",
      procedureSteps: [],
      requiredDocuments: [],
      terms: [],
      lines: [
        {
          description: "Haulage, 1 truck",
          basis: "fixed",
          amountMinor: 450000,
        },
      ],
    },
  });
  assert.equal(quote.status, 201);
  const quoteId = (await json<{ id: string }>(quote)).id;
  const issued = await post(
    `/api/v1/quotes/${quoteId}/issue`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(issued.status, 201);
  assert.equal(
    (await json<{ quoteNumber: string }>(issued)).quoteNumber,
    `BJH/Q/RT/${year}/0001`,
  );

  const invoice = await post(
    `/api/v1/jobs/${roadJob}/invoices`,
    TEST_MATCHING_TOKEN,
    {
      currency: "GHS",
      lines: [{ description: "Haulage, 1 truck", amountMinor: 450000 }],
    },
  );
  assert.equal(invoice.status, 201);
});
