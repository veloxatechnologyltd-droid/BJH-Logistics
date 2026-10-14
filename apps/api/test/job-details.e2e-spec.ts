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
let otherSeaJob: string;
let airJob: string;

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

function post(path: string, token: string, body: unknown) {
  return call(path, token, { method: "POST", body: JSON.stringify(body) });
}

async function openJob(companyId: string, serviceLine: string) {
  const response = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine,
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
  seaJob = await openJob(companyA, "sea_import");
  otherSeaJob = await openJob(companyB, "sea_import");
  airJob = await openJob(companyA, "air_import");
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

let masterId: string;

test("parties can be added, listed and removed on a job", async () => {
  const added = await post(
    `/api/v1/jobs/${seaJob}/parties`,
    TEST_MATCHING_TOKEN,
    {
      role: "consignee",
      name: "  Synthetic Consignee Ltd ",
      details: "Accra, synthetic address",
    },
  );
  assert.equal(added.status, 201);
  const party = (await added.json()) as {
    id: string;
    name: string;
    role: string;
  };
  assert.equal(party.name, "Synthetic Consignee Ltd");
  await post(`/api/v1/jobs/${seaJob}/parties`, TEST_MATCHING_TOKEN, {
    role: "shipper",
    name: "Synthetic Shipper GmbH",
  });
  const list = (await (
    await call(`/api/v1/jobs/${seaJob}/parties`, TEST_MATCHING_TOKEN)
  ).json()) as unknown[];
  assert.equal(list.length, 2);

  const removed = await call(
    `/api/v1/jobs/${seaJob}/parties/${party.id}`,
    TEST_MATCHING_TOKEN,
    {
      method: "DELETE",
    },
  );
  assert.equal(removed.status, 200);
  const after = (await (
    await call(`/api/v1/jobs/${seaJob}/parties`, TEST_MATCHING_TOKEN)
  ).json()) as unknown[];
  assert.equal(after.length, 1);
  const again = await call(
    `/api/v1/jobs/${seaJob}/parties/${party.id}`,
    TEST_MATCHING_TOKEN,
    {
      method: "DELETE",
    },
  );
  assert.equal(again.status, 404);

  for (const [body, message] of [
    [{ name: "x" }, "role must be shipper, consignee, notify_party or agent"],
    [{ role: "agent" }, "name is required"],
    [[], "A party object is required"],
  ] as const) {
    const bad = await post(
      `/api/v1/jobs/${seaJob}/parties`,
      TEST_MATCHING_TOKEN,
      body,
    );
    assert.equal(bad.status, 400);
    assert.equal(((await bad.json()) as { message: string }).message, message);
  }
});

test("one master bill of lading can carry many house bills, containers and a booking", async () => {
  const master = await post(
    `/api/v1/jobs/${seaJob}/references`,
    TEST_MATCHING_TOKEN,
    {
      kind: "master_bl",
      value: "MBL-SYN-001",
    },
  );
  assert.equal(master.status, 201);
  masterId = ((await master.json()) as { id: string }).id;
  for (const value of ["HBL-SYN-001", "HBL-SYN-002"]) {
    const house = await post(
      `/api/v1/jobs/${seaJob}/references`,
      TEST_MATCHING_TOKEN,
      {
        kind: "house_bl",
        value,
        parentReferenceId: masterId,
      },
    );
    assert.equal(house.status, 201);
  }
  const container = await post(
    `/api/v1/jobs/${seaJob}/references`,
    TEST_MATCHING_TOKEN,
    {
      kind: "container",
      value: "SYNU1234568",
      sealNumber: "SEAL-9",
    },
  );
  assert.equal(container.status, 201);
  assert.equal(
    ((await container.json()) as { sealNumber: string }).sealNumber,
    "SEAL-9",
  );
  await post(`/api/v1/jobs/${seaJob}/references`, TEST_MATCHING_TOKEN, {
    kind: "booking",
    value: "BKG-SYN-77",
  });

  const list = (await (
    await call(`/api/v1/jobs/${seaJob}/references`, TEST_MATCHING_TOKEN)
  ).json()) as Array<{
    kind: string;
    parentReferenceId: string | null;
  }>;
  assert.equal(list.length, 5);
  assert.equal(
    list.filter((item) => item.parentReferenceId === masterId).length,
    2,
  );
});

test("invalid references are rejected", async () => {
  const cases: Array<[unknown, number, string]> = [
    [
      { kind: "house_bl", value: "HBL-X" },
      400,
      "A house document must reference its master",
    ],
    [
      { kind: "booking", value: "B", parentReferenceId: masterId },
      400,
      "Only house documents can reference a master",
    ],
    [
      { kind: "master_bl", value: "MBL-SYN-001" },
      409,
      "This reference is already on the job",
    ],
    [
      { kind: "master_bl", value: "mbl-syn-001" },
      409,
      "This reference is already on the job",
    ],
    [
      // A wrong ISO 6346 check digit is a typo.
      { kind: "container", value: "MSCU1234565" },
      400,
      "MSCU1234565 is not a valid container number: check the letters and digits against the bill of lading",
    ],
    [
      // Spaces and case are tidied, so this is the container already recorded.
      { kind: "container", value: "synu 123456 8" },
      409,
      "This reference is already on the job",
    ],
    [
      { kind: "booking", value: "B2", sealNumber: "S" },
      400,
      "Only containers carry a seal number",
    ],
    [
      { kind: "master_awb", value: "AWB-1" },
      400,
      "master_awb cannot be recorded on a sea_import job",
    ],
    [
      { kind: "house_bl", value: "HBL-Y", parentReferenceId: randomUUID() },
      400,
      "parentReferenceId must be an active master of the matching kind on this job",
    ],
    [
      { kind: "teleport", value: "x" },
      400,
      "kind must be master_bl, house_bl, master_awb, house_awb, booking or container",
    ],
  ];
  for (const [body, status, message] of cases) {
    const response = await post(
      `/api/v1/jobs/${seaJob}/references`,
      TEST_MATCHING_TOKEN,
      body,
    );
    assert.equal(response.status, status, message);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      message,
    );
  }
  const air = await post(
    `/api/v1/jobs/${airJob}/references`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      kind: "container",
      value: "SYNU7654320",
    },
  );
  assert.equal(air.status, 400);
  const airMaster = await post(
    `/api/v1/jobs/${airJob}/references`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      kind: "master_awb",
      value: "AWB-SYN-1",
    },
  );
  assert.equal(airMaster.status, 201);
});

test("a master with active houses cannot be removed; a foreign master cannot be used as parent", async () => {
  const blocked = await call(
    `/api/v1/jobs/${seaJob}/references/${masterId}`,
    TEST_MATCHING_TOKEN,
    {
      method: "DELETE",
    },
  );
  assert.equal(blocked.status, 409);

  const foreignMaster = await post(
    `/api/v1/jobs/${otherSeaJob}/references`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      kind: "master_bl",
      value: "MBL-SYN-OTHER",
    },
  );
  const foreignId = ((await foreignMaster.json()) as { id: string }).id;
  const cross = await post(
    `/api/v1/jobs/${seaJob}/references`,
    TEST_MATCHING_TOKEN,
    {
      kind: "house_bl",
      value: "HBL-CROSS",
      parentReferenceId: foreignId,
    },
  );
  assert.equal(cross.status, 400);
  const crossDelete = await call(
    `/api/v1/jobs/${seaJob}/references/${foreignId}`,
    TEST_MATCHING_TOKEN,
    {
      method: "DELETE",
    },
  );
  assert.equal(crossDelete.status, 404);
});

test("jobs are searchable by any reference, seal or party name", async () => {
  const search = async (term: string, token = TEST_SUPER_ADMIN_TOKEN) =>
    (
      (await (
        await call(`/api/v1/jobs?search=${encodeURIComponent(term)}`, token)
      ).json()) as Array<{ id: string }>
    ).map((job) => job.id);
  assert.deepEqual(await search("HBL-SYN-002"), [seaJob]);
  assert.deepEqual(await search("mbl-syn-001"), [seaJob]);
  assert.deepEqual(await search("SYNU1234568"), [seaJob]);
  assert.deepEqual(await search("SEAL-9"), [seaJob]);
  assert.deepEqual(await search("BKG-SYN-77"), [seaJob]);
  assert.deepEqual(await search("Synthetic Shipper"), [seaJob]);
  assert.deepEqual(await search("AWB-SYN-1"), [airJob]);
  assert.deepEqual(await search("MBL-SYN-OTHER"), [otherSeaJob]);
  assert.deepEqual(await search("no-such-reference"), []);
  // scope still applies: company A's customer cannot find company B's job by reference
  assert.deepEqual(await search("MBL-SYN-OTHER", TEST_CUSTOMER_A_TOKEN), []);
  assert.deepEqual(await search("HBL-SYN-002", TEST_CUSTOMER_A_TOKEN), [
    seaJob,
  ]);
});

test("removed references stop matching search", async () => {
  const container = (await (
    await call(`/api/v1/jobs/${seaJob}/references`, TEST_MATCHING_TOKEN)
  ).json()) as Array<{
    id: string;
    kind: string;
  }>;
  const containerId = container.find((item) => item.kind === "container")!.id;
  const removed = await call(
    `/api/v1/jobs/${seaJob}/references/${containerId}`,
    TEST_MATCHING_TOKEN,
    {
      method: "DELETE",
    },
  );
  assert.equal(removed.status, 200);
  const found = (await (
    await call("/api/v1/jobs?search=SYNU1234568", TEST_SUPER_ADMIN_TOKEN)
  ).json()) as unknown[];
  assert.equal(found.length, 0);
});

test("access boundaries for parties and references", async () => {
  assert.equal(
    (await call(`/api/v1/jobs/${seaJob}/references`, TEST_UNASSIGNED_TOKEN))
      .status,
    404,
  );
  assert.equal(
    (
      await post(`/api/v1/jobs/${seaJob}/references`, TEST_UNASSIGNED_TOKEN, {
        kind: "booking",
        value: "Z",
      })
    ).status,
    404,
  );
  assert.equal(
    (await call(`/api/v1/jobs/${seaJob}/parties`, TEST_CUSTOMER_B_TOKEN))
      .status,
    404,
  );
  assert.equal(
    (await call(`/api/v1/jobs/${seaJob}/parties`, TEST_CUSTOMER_A_TOKEN))
      .status,
    200,
  );
  assert.equal(
    (
      await post(`/api/v1/jobs/${seaJob}/parties`, TEST_CUSTOMER_A_TOKEN, {
        role: "agent",
        name: "X",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        `/api/v1/jobs/${seaJob}/references/${masterId}`,
        TEST_CUSTOMER_A_TOKEN,
        { method: "DELETE" },
      )
    ).status,
    403,
  );
});

test("a closed job cannot be edited until reopened", async () => {
  await post(`/api/v1/jobs/${otherSeaJob}/status`, TEST_SUPER_ADMIN_TOKEN, {
    status: "cancelled",
    reason: "Test",
  });
  const blocked = await post(
    `/api/v1/jobs/${otherSeaJob}/parties`,
    TEST_SUPER_ADMIN_TOKEN,
    {
      role: "agent",
      name: "Late Agent",
    },
  );
  assert.equal(blocked.status, 409);
});
