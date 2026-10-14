import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_CUSTOMER_B_TOKEN,
  TEST_CUSTOMER_B_ID,
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import {
  beginTestDatabase,
  endTestDatabase,
  testPostgresPool,
} from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let jobA: string;
let jobB: string;
let companyA: string;
let companyB: string;

const pdf = (extra = "synthetic") =>
  Buffer.from(`%PDF-1.4\n% ${extra}\n%%EOF\n`, "latin1");

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
  companyA = randomUUID();
  companyB = randomUUID();
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

function post(path: string, token: string, body: unknown) {
  return call(path, token, { method: "POST", body: JSON.stringify(body) });
}

async function supplierDocument(jobId: string, documentType: string) {
  const response = await upload(
    jobId,
    TEST_MATCHING_TOKEN,
    { name: `${documentType}.pdf`, bytes: pdf(randomUUID()) },
    { documentType },
  );
  return ((await response.json()) as { id: string }).id;
}

const get = (path: string, token = TEST_MATCHING_TOKEN) => call(path, token);

const dispatchBody = (driverId: string, vehicleId: string, over = {}) => ({
  driverId,
  vehicleId,
  cargoDescription: "82 sacks of woven baskets",
  packages: 82,
  grossWeightKg: 5000.5,
  pickupLocation: "Synthetic terminal",
  deliveryAddress: "1 Test Road, Sample City",
  ...over,
});

type Delivery = {
  id: string;
  waybillNumber: string;
  driverName: string;
  driverPhone: string;
  vehicleRegistration: string;
  cargoDescription: string;
  packages: number | null;
  grossWeightKg: number | null;
  status: string;
  receiverName: string | null;
  deliveredAt: string | null;
  damageNotes: string | null;
  podDocumentId: string | null;
  dispatchedBy: string;
};

let driver: { id: string; name: string };
let vehicle: { id: string };
let delivery: Delivery;

test("staff manage driver and vehicle records", async () => {
  const created = await post("/api/v1/drivers", TEST_MATCHING_TOKEN, {
    name: "  Kofi Synthetic  ",
    phone: "000 111 2222",
  });
  assert.equal(created.status, 201);
  driver = (await created.json()) as typeof driver;
  assert.equal(driver.name, "Kofi Synthetic");

  const truck = await post("/api/v1/vehicles", TEST_MATCHING_TOKEN, {
    registration: " gx 0001-26 ",
    description: "Synthetic truck",
  });
  assert.equal(truck.status, 201);
  vehicle = (await truck.json()) as typeof vehicle;

  const duplicate = await post("/api/v1/vehicles", TEST_UNASSIGNED_TOKEN, {
    registration: "GX 0001-26",
  });
  assert.equal(duplicate.status, 409);

  const cases: Array<[string, unknown, string]> = [
    ["/api/v1/drivers", {}, "name is required"],
    ["/api/v1/drivers", { name: "X" }, "phone is required"],
    ["/api/v1/vehicles", {}, "registration is required"],
  ];
  for (const [path, body, message] of cases) {
    const response = await post(path, TEST_MATCHING_TOKEN, body);
    assert.equal(response.status, 400, message);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      message,
    );
  }

  const off = await post(
    `/api/v1/drivers/${driver.id}/active`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      active: false,
    },
  );
  assert.equal(off.status, 201);
  assert.ok(((await off.json()) as { deactivatedAt: string }).deactivatedAt);
  const on = await post(
    `/api/v1/drivers/${driver.id}/active`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      active: true,
    },
  );
  assert.equal(
    ((await on.json()) as { deactivatedAt: string | null }).deactivatedAt,
    null,
  );
  assert.equal(
    (
      await post(
        `/api/v1/drivers/${randomUUID()}/active`,
        TEST_MATCHING_TOKEN,
        { active: false },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await post(`/api/v1/drivers/${driver.id}/active`, TEST_MATCHING_TOKEN, {
        active: "no",
      })
    ).status,
    400,
  );
  const drivers = (await (await get("/api/v1/drivers")).json()) as unknown[];
  assert.equal(drivers.length, 1);
});

test("dispatching numbers the waybill and freezes the driver, vehicle and cargo", async () => {
  const response = await post(
    `/api/v1/jobs/${jobA}/deliveries`,
    TEST_MATCHING_TOKEN,
    dispatchBody(driver.id, vehicle.id),
  );
  assert.equal(response.status, 201);
  delivery = (await response.json()) as Delivery;
  assert.match(
    delivery.waybillNumber,
    new RegExp(`^BJH/WB/${new Date().getUTCFullYear()}/0001$`),
  );
  assert.equal(delivery.driverName, "Kofi Synthetic");
  assert.equal(delivery.vehicleRegistration, "gx 0001-26");
  assert.equal(delivery.packages, 82);
  assert.equal(delivery.grossWeightKg, 5000.5);
  assert.equal(delivery.status, "dispatched");
  assert.equal(delivery.dispatchedBy, TEST_MATCHING_USER_ID);

  const second = (await (
    await post(
      `/api/v1/jobs/${jobA}/deliveries`,
      TEST_MATCHING_TOKEN,
      dispatchBody(driver.id, vehicle.id),
    )
  ).json()) as Delivery;
  assert.match(second.waybillNumber, /\/0002$/);

  // Taking the driver off the road afterwards leaves the issued waybill as it was.
  await post(`/api/v1/drivers/${driver.id}/active`, TEST_MATCHING_TOKEN, {
    active: false,
  });
  const listed = (await (
    await get(`/api/v1/jobs/${jobA}/deliveries`)
  ).json()) as Delivery[];
  assert.equal(listed.length, 2);
  assert.equal(listed[0].driverName, "Kofi Synthetic");
  assert.equal(listed[0].driverPhone, "000 111 2222");

  const unavailableDriver = await post(
    `/api/v1/jobs/${jobA}/deliveries`,
    TEST_MATCHING_TOKEN,
    dispatchBody(driver.id, vehicle.id),
  );
  assert.equal(unavailableDriver.status, 400);
  assert.equal(
    ((await unavailableDriver.json()) as { message: string }).message,
    "driverId must be an active driver",
  );
  await post(`/api/v1/drivers/${driver.id}/active`, TEST_MATCHING_TOKEN, {
    active: true,
  });
  await post(`/api/v1/vehicles/${vehicle.id}/active`, TEST_MATCHING_TOKEN, {
    active: false,
  });
  const unavailableVehicle = await post(
    `/api/v1/jobs/${jobA}/deliveries`,
    TEST_MATCHING_TOKEN,
    dispatchBody(driver.id, vehicle.id),
  );
  assert.equal(
    ((await unavailableVehicle.json()) as { message: string }).message,
    "vehicleId must be an active vehicle",
  );
  await post(`/api/v1/vehicles/${vehicle.id}/active`, TEST_MATCHING_TOKEN, {
    active: true,
  });
});

test("invalid deliveries are rejected", async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ driverId: "nope" }, "driverId must be a valid ID"],
    [
      { cargoDescription: " " },
      "cargoDescription must contain 1 to 500 characters",
    ],
    [
      { deliveryAddress: "" },
      "deliveryAddress must contain 1 to 500 characters",
    ],
    [{ packages: 0 }, "packages must be 1 to 1000000"],
    [{ packages: 1.5 }, "packages must be a whole number"],
    [{ grossWeightKg: -1 }, "grossWeightKg must be 0 to 100000000"],
  ];
  for (const [over, message] of cases) {
    const response = await post(
      `/api/v1/jobs/${jobA}/deliveries`,
      TEST_MATCHING_TOKEN,
      dispatchBody(driver.id, vehicle.id, over),
    );
    assert.equal(response.status, 400, message);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      message,
    );
  }
  const unknownDriver = await post(
    `/api/v1/jobs/${jobA}/deliveries`,
    TEST_MATCHING_TOKEN,
    dispatchBody(randomUUID(), vehicle.id),
  );
  assert.equal(unknownDriver.status, 400);
});

test("the proof of delivery is recorded once, with an optional signed delivery note", async () => {
  const path = `/api/v1/jobs/${jobA}/deliveries/${delivery.id}/proof`;
  const wrongType = await supplierDocument(jobA, "commercial_invoice");
  const otherJob = await supplierDocument(jobB, "delivery_note");
  const cases: Array<[Record<string, unknown>, number, string]> = [
    [{}, 400, "receiverName is required"],
    [
      { receiverName: "R", deliveredAt: "sometime" },
      400,
      "deliveredAt must be a date and time",
    ],
    [
      {
        receiverName: "R",
        deliveredAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
      400,
      "deliveredAt cannot be in the future",
    ],
    [
      { receiverName: "R", podDocumentId: wrongType },
      400,
      "podDocumentId must be a delivery note document on this job",
    ],
    [
      { receiverName: "R", podDocumentId: otherJob },
      400,
      "podDocumentId must be a delivery note document on this job",
    ],
  ];
  for (const [body, status, message] of cases) {
    const response = await post(path, TEST_MATCHING_TOKEN, body);
    assert.equal(response.status, status, message);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      message,
    );
  }

  const note = await supplierDocument(jobA, "delivery_note");
  const recorded = await post(path, TEST_MATCHING_TOKEN, {
    receiverName: "  A. Receiver  ",
    receiverPhone: "000 333 4444",
    deliveredAt: "2026-09-25T10:30:00Z",
    damageNotes: "One sack torn",
    podDocumentId: note,
  });
  assert.equal(recorded.status, 201);
  const done = (await recorded.json()) as Delivery;
  assert.equal(done.status, "delivered");
  assert.equal(done.receiverName, "A. Receiver");
  assert.equal(done.deliveredAt, "2026-09-25T10:30:00.000Z");
  assert.equal(done.damageNotes, "One sack torn");
  assert.equal(done.podDocumentId, note);
  assert.equal(done.driverName, "Kofi Synthetic");

  const again = await post(path, TEST_MATCHING_TOKEN, {
    receiverName: "Someone else",
  });
  assert.equal(again.status, 409);
  const wrongJob = await post(
    `/api/v1/jobs/${jobB}/deliveries/${delivery.id}/proof`,
    TEST_SUPER_ADMIN_TOKEN,
    { receiverName: "R" },
  );
  assert.equal(wrongJob.status, 404);
  const unknown = await post(
    `/api/v1/jobs/${jobA}/deliveries/${randomUUID()}/proof`,
    TEST_MATCHING_TOKEN,
    { receiverName: "R" },
  );
  assert.equal(unknown.status, 404);
});

test("the waybill fills the dispatched and delivered steps, without a second message", async () => {
  const timeline = (await (
    await get(`/api/v1/jobs/${jobA}/milestones`)
  ).json()) as {
    events: Array<{
      milestoneKey: string;
      source: string;
      note: string | null;
    }>;
  };
  const step = (key: string) =>
    timeline.events.find((event) => event.milestoneKey === key);
  assert.equal(step("container_dispatched")?.source, "system");
  // The latest waybill dispatched on the job.
  assert.match(step("container_dispatched")?.note ?? "", /\/WB\/\d{4}\/\d{4}$/);
  assert.equal(step("delivery_note_signed")?.source, "system");
  assert.match(step("delivery_note_signed")?.note ?? "", /A\. Receiver/);

  // Recording the step by hand as well is allowed, but the customer was
  // already told by the waybill, so no milestone message is added.
  const before = await testPostgresPool.query(
    "SELECT count(*)::int AS count FROM app.notification WHERE job_id = $1 AND event = 'milestone'",
    [jobA],
  );
  const manual = await post(
    `/api/v1/jobs/${jobA}/milestones`,
    TEST_MATCHING_TOKEN,
    {
      milestoneKey: "delivery_note_signed",
    },
  );
  assert.equal(manual.status, 201);
  const afterwards = await testPostgresPool.query(
    "SELECT count(*)::int AS count FROM app.notification WHERE job_id = $1 AND event = 'milestone'",
    [jobA],
  );
  assert.equal(afterwards.rows[0].count, before.rows[0].count);
  // Control: a key step on the same job is still announced.
  await post(`/api/v1/jobs/${jobA}/milestones`, TEST_MATCHING_TOKEN, {
    milestoneKey: "cargo_arrived",
  });
  const control = await testPostgresPool.query(
    "SELECT count(*)::int AS count FROM app.notification WHERE job_id = $1 AND event = 'milestone'",
    [jobA],
  );
  assert.equal(control.rows[0].count, Number(before.rows[0].count) + 1);
});

test("access boundaries: customers read their own waybills; only staff dispatch", async () => {
  const ownCustomer = await get(
    `/api/v1/jobs/${jobA}/deliveries`,
    TEST_CUSTOMER_A_TOKEN,
  );
  assert.equal(ownCustomer.status, 200);
  assert.equal(((await ownCustomer.json()) as unknown[]).length, 2);
  assert.equal(
    (await get(`/api/v1/jobs/${jobA}/deliveries`, TEST_CUSTOMER_B_TOKEN))
      .status,
    404,
  );
  assert.equal(
    (await get(`/api/v1/jobs/${jobA}/deliveries`, TEST_UNASSIGNED_TOKEN))
      .status,
    404,
  );
  assert.equal(
    (await fetch(`${baseUrl}/api/v1/jobs/${jobA}/deliveries`)).status,
    401,
  );

  const body = dispatchBody(driver.id, vehicle.id);
  assert.equal(
    (await post(`/api/v1/jobs/${jobA}/deliveries`, TEST_CUSTOMER_A_TOKEN, body))
      .status,
    403,
  );
  assert.equal(
    (await post(`/api/v1/jobs/${jobA}/deliveries`, TEST_UNASSIGNED_TOKEN, body))
      .status,
    404,
  );
  assert.equal(
    (
      await post(
        `/api/v1/jobs/${jobA}/deliveries/${delivery.id}/proof`,
        TEST_CUSTOMER_A_TOKEN,
        { receiverName: "R" },
      )
    ).status,
    403,
  );
  // Driver and vehicle records are internal.
  assert.equal(
    (await get("/api/v1/drivers", TEST_CUSTOMER_A_TOKEN)).status,
    403,
  );
  assert.equal(
    (await get("/api/v1/vehicles", TEST_CUSTOMER_A_TOKEN)).status,
    403,
  );
  assert.equal((await fetch(`${baseUrl}/api/v1/vehicles`)).status, 401);

  const cancelled = await post(
    `/api/v1/jobs/${jobB}/status`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      status: "cancelled",
      reason: "Customer withdrew",
    },
  );
  assert.equal(cancelled.status, 201);
  assert.equal(
    (
      await post(
        `/api/v1/jobs/${jobB}/deliveries`,
        TEST_SUPER_ADMIN_TOKEN,
        body,
      )
    ).status,
    409,
  );
});

test("the waybill prefix comes from the settings once configured", async () => {
  const saved = await call("/api/v1/settings", TEST_SUPER_ADMIN_TOKEN, {
    method: "PUT",
    body: JSON.stringify({
      issuer: { name: "Synthetic Ltd" },
      currencies: ["GHS"],
      numbering: {
        quotePrefix: "S/Q",
        invoicePrefix: "S/I",
        receiptPrefix: "S/R",
        waybillPrefix: "SYN/WB",
      },
    }),
  });
  assert.equal(saved.status, 200);
  const response = await post(
    `/api/v1/jobs/${jobA}/deliveries`,
    TEST_MATCHING_TOKEN,
    dispatchBody(driver.id, vehicle.id),
  );
  assert.match(
    ((await response.json()) as Delivery).waybillNumber,
    new RegExp(`^SYN/WB/${new Date().getUTCFullYear()}/0003$`),
  );
});

test("the waybill PDF is served within the same access boundary as the delivery", async () => {
  const path = `/api/v1/jobs/${jobA}/deliveries/${delivery.id}/pdf`;
  const staff = await get(path);
  assert.equal(staff.status, 200);
  assert.equal(staff.headers.get("content-type"), "application/pdf");
  assert.match(
    staff.headers.get("content-disposition") ?? "",
    /^inline; filename="waybill-BJH-WB-\d{4}-0001\.pdf"$/,
  );
  const bytes = Buffer.from(await staff.arrayBuffer());
  assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");

  assert.equal((await get(path, TEST_CUSTOMER_A_TOKEN)).status, 200);
  assert.equal((await get(path, TEST_CUSTOMER_B_TOKEN)).status, 404);
  assert.equal((await get(path, TEST_UNASSIGNED_TOKEN)).status, 404);
  assert.equal(
    (await get(`/api/v1/jobs/${jobA}/deliveries/${randomUUID()}/pdf`)).status,
    404,
  );
  assert.equal(
    (await get(`/api/v1/jobs/${jobB}/deliveries/${delivery.id}/pdf`)).status,
    404,
  );
});
