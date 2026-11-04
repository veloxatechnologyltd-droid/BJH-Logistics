import "reflect-metadata";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { addMonths } from "../src/database/postgres-database.service";
import { VEHICLE_NOTICE_DAYS } from "../src/notifications/notification-dispatcher.service";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;

type Vehicle = {
  id: string;
  registration: string;
  insuranceStartOn: string | null;
  insuranceEndOn: string | null;
  dvlaExpiresOn: string | null;
  serviceEveryMonths: number | null;
  lastServicedOn: string | null;
  nextServiceOn: string | null;
};
type Notice = { kind: string; title: string; vehicleId: string | null };

function call(path: string, token: string, method = "GET", body?: unknown) {
  const headers = new Headers({ authorization: `Bearer ${token}` });
  if (body !== undefined) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  await application
    .get(DatabasePort)
    .assignStaffRole(TEST_MATCHING_USER_ID, "import_rep", TEST_SUPER_ADMIN_ID);
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("months are added as PostgreSQL does, ending on a short month's last day", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2026-11-15", 3), "2027-02-15");
  assert.equal(addMonths("2024-11-30", 3), "2025-02-28");
});

test("a vehicle keeps its insurance, DVLA and servicing dates; bad ones are refused", async () => {
  const created = await call(
    "/api/v1/vehicles",
    TEST_SUPER_ADMIN_TOKEN,
    "POST",
    {
      registration: "GT 1001-26",
      insuranceStartOn: "2026-01-01",
      insuranceEndOn: "2026-12-31",
      dvlaExpiresOn: "2027-03-01",
      serviceEveryMonths: 3,
      lastServicedOn: "2026-10-15",
    },
  );
  assert.equal(created.status, 201, await created.clone().text());
  const vehicle = (await created.json()) as Vehicle;
  assert.equal(vehicle.insuranceEndOn, "2026-12-31");
  assert.equal(vehicle.dvlaExpiresOn, "2027-03-01");
  assert.equal(vehicle.nextServiceOn, "2027-01-15");

  const updated = (await (
    await call(
      `/api/v1/vehicles/${vehicle.id}`,
      TEST_SUPER_ADMIN_TOKEN,
      "PUT",
      {
        registration: "GT 1001-26",
        serviceEveryMonths: 3,
        lastServicedOn: "2026-11-03",
        insuranceEndOn: "",
      },
    )
  ).json()) as Vehicle;
  assert.equal(updated.lastServicedOn, "2026-11-03");
  assert.equal(updated.nextServiceOn, "2027-02-03");
  assert.equal(updated.insuranceEndOn, null);

  for (const [body, message] of [
    [
      {
        registration: "X",
        insuranceStartOn: "2026-05-01",
        insuranceEndOn: "2026-04-01",
      },
      "The insurance end date must be on or after its start date",
    ],
    [
      { registration: "X", dvlaExpiresOn: "31/12/2026" },
      "dvlaExpiresOn must be a date (YYYY-MM-DD)",
    ],
    [
      { registration: "X", serviceEveryMonths: 0 },
      "serviceEveryMonths must be 1 to 60",
    ],
  ] as const) {
    const refused = await call(
      "/api/v1/vehicles",
      TEST_MATCHING_TOKEN,
      "POST",
      body,
    );
    assert.equal(refused.status, 400, message);
    assert.equal(
      ((await refused.json()) as { message: string }).message,
      message,
    );
  }
  const missing = await call(
    "/api/v1/vehicles/00000000-0000-4000-8000-000000000000",
    TEST_SUPER_ADMIN_TOKEN,
    "PUT",
    { registration: "GT 9-26" },
  );
  assert.equal(missing.status, 404);
});

test("the super admin is told 14 days before each date and again on the day, once each", async () => {
  const database = application.get(DatabasePort);
  const soon = (await (
    await call("/api/v1/vehicles", TEST_SUPER_ADMIN_TOKEN, "POST", {
      registration: "GT 2002-26",
      insuranceEndOn: day(10),
      dvlaExpiresOn: day(0),
      serviceEveryMonths: 3,
      lastServicedOn: addMonths(day(-30), -3),
    })
  ).json()) as Vehicle;
  // Far off: no notice yet. Out of service: none at all.
  await call("/api/v1/vehicles", TEST_SUPER_ADMIN_TOKEN, "POST", {
    registration: "GT 3003-26",
    insuranceEndOn: day(60),
  });
  const parked = (await (
    await call("/api/v1/vehicles", TEST_SUPER_ADMIN_TOKEN, "POST", {
      registration: "GT 4004-26",
      insuranceEndOn: day(1),
    })
  ).json()) as Vehicle;
  await call(
    `/api/v1/vehicles/${parked.id}/active`,
    TEST_MATCHING_TOKEN,
    "POST",
    {
      active: false,
    },
  );

  // Insurance soon, DVLA today, service a month overdue: three notices.
  assert.equal(await database.raiseVehicleNotices(VEHICLE_NOTICE_DAYS), 3);
  assert.equal(await database.raiseVehicleNotices(VEHICLE_NOTICE_DAYS), 0);

  const admin = (await (
    await call("/api/v1/staff-notifications", TEST_SUPER_ADMIN_TOKEN)
  ).json()) as { due: Notice[] };
  const titles = admin.due
    .filter((notice) => notice.kind === "vehicle_due")
    .map((notice) => notice.title)
    .sort();
  assert.equal(titles.length, 3);
  assert.ok(
    titles.some((title) =>
      title.startsWith("DVLA roadworthy for GT 2002-26 was due on"),
    ),
  );
  assert.ok(
    titles.some((title) =>
      title.startsWith("Insurance for GT 2002-26 is due on"),
    ),
  );
  assert.ok(
    titles.some((title) =>
      title.startsWith("Servicing for GT 2002-26 was due on"),
    ),
  );
  assert.ok(
    admin.due
      .filter((notice) => notice.kind === "vehicle_due")
      .every((notice) => notice.vehicleId === soon.id),
  );
  // Other staff are not told.
  const rep = (await (
    await call("/api/v1/staff-notifications", TEST_MATCHING_TOKEN)
  ).json()) as { due: Notice[] };
  assert.ok(!rep.due.some((notice) => notice.kind === "vehicle_due"));

  // A service recorded today moves the date: no new notice.
  await call(`/api/v1/vehicles/${soon.id}`, TEST_SUPER_ADMIN_TOKEN, "PUT", {
    registration: "GT 2002-26",
    insuranceEndOn: day(10),
    dvlaExpiresOn: day(0),
    serviceEveryMonths: 3,
    lastServicedOn: day(0),
  });
  assert.equal(await database.raiseVehicleNotices(VEHICLE_NOTICE_DAYS), 0);
});
