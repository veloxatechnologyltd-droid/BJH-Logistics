import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_TOKEN,
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let company: string;

const CREATED_USER_ID = "50000000-0000-4000-8000-000000000005";
const password = "secure-example-password";

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const send = (
  method: string,
  path: string,
  body?: unknown,
  token = TEST_SUPER_ADMIN_TOKEN,
) =>
  call(path, token, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const message = async (response: Response) =>
  ((await response.json()) as { message: string }).message;

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
  company = randomUUID();
  await database.createCustomer({
    id: company,
    companyName: "Northstar Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("only the super admin manages customer accounts", async () => {
  for (const token of [TEST_MATCHING_TOKEN, TEST_CUSTOMER_A_TOKEN]) {
    assert.equal(
      (await send("GET", "/api/v1/admin/customer-accounts", undefined, token))
        .status,
      403,
    );
    assert.equal(
      (
        await send(
          "POST",
          "/api/v1/admin/customer-accounts",
          { email: "x@example.test", password, companyId: company },
          token,
        )
      ).status,
      403,
    );
  }
});

test("accounts people opened themselves wait for the admin to link them", async () => {
  const pending = async () =>
    (
      (await (
        await send("GET", "/api/v1/admin/customer-accounts/pending")
      ).json()) as Array<{ id: string }>
    ).map((account) => account.id);
  const before = await pending();
  assert.ok(before.includes(TEST_UNASSIGNED_USER_ID));
  assert.ok(!before.includes(TEST_SUPER_ADMIN_ID));
  assert.ok(!before.includes(TEST_MATCHING_USER_ID));
  assert.equal(
    (await call("/api/v1/admin/customer-accounts/pending", TEST_MATCHING_TOKEN))
      .status,
    403,
  );

  const link = `/api/v1/admin/company-memberships`;
  assert.equal(
    (
      await send("POST", link, {
        userId: TEST_UNASSIGNED_USER_ID,
        companyId: company,
      })
    ).status,
    201,
  );
  assert.ok(!(await pending()).includes(TEST_UNASSIGNED_USER_ID));
  assert.equal(
    (await send("DELETE", `${link}/${TEST_UNASSIGNED_USER_ID}/${company}`))
      .status,
    200,
  );
});

test("the super admin creates a customer account linked to a company, with no staff role", async () => {
  const cases: Array<[Record<string, unknown>, number, string]> = [
    [{ password, companyId: company }, 400, "email is required"],
    [
      { email: "not-an-email", password, companyId: company },
      400,
      "email must be a valid email address",
    ],
    [
      { email: "a@example.test", password: "short", companyId: company },
      400,
      "Password must be at least 12 characters",
    ],
    [{ email: "a@example.test", password }, 400, "companyId is required"],
    [
      { email: "a@example.test", password, companyId: "nope" },
      400,
      "companyId must be a valid ID",
    ],
    [
      { email: "a@example.test", password, companyId: randomUUID() },
      404,
      "Customer company was not found",
    ],
  ];
  for (const [body, status, expected] of cases) {
    const response = await send(
      "POST",
      "/api/v1/admin/customer-accounts",
      body,
    );
    assert.equal(response.status, status, expected);
    assert.equal(await message(response), expected);
  }

  const created = await send("POST", "/api/v1/admin/customer-accounts", {
    email: "  New.Customer@Example.TEST ",
    password,
    companyId: company,
  });
  assert.equal(created.status, 201);
  const body = (await created.json()) as {
    user: { id: string; email: string };
    company: { companyId: string; companyName: string };
  };
  assert.equal(body.user.id, CREATED_USER_ID);
  assert.equal(body.user.email, "new.customer@example.test");
  assert.equal(body.company.companyName, "Northstar Synthetic Ltd");

  const database = application.get(DatabasePort);
  assert.deepEqual(await database.getActiveStaffRoles(CREATED_USER_ID), []);
  assert.deepEqual(
    await database.getActiveCustomerCompanyIds(CREATED_USER_ID),
    [company],
  );

  const listed = (await (
    await send("GET", "/api/v1/admin/customer-accounts")
  ).json()) as Array<{
    id: string;
    email: string;
    suspended: boolean;
    companies: Array<{ companyId: string; companyName: string }>;
  }>;
  const account = listed.find((item) => item.id === CREATED_USER_ID);
  assert.ok(account);
  assert.equal(account.suspended, false);
  assert.deepEqual(account.companies, [
    { companyId: company, companyName: "Northstar Synthetic Ltd" },
  ]);
});

test("password replacement and suspension apply to customer accounts only", async () => {
  const path = `/api/v1/admin/customer-accounts/${CREATED_USER_ID}`;
  const short = await send("PATCH", `${path}/password`, { password: "short" });
  assert.equal(short.status, 400);
  assert.equal(
    (await send("PATCH", `${path}/password`, { password })).status,
    200,
  );

  assert.equal((await send("POST", `${path}/suspend`)).status, 201);
  const suspended = (
    (await (
      await send("GET", "/api/v1/admin/customer-accounts")
    ).json()) as Array<{
      id: string;
      suspended: boolean;
    }>
  ).find((item) => item.id === CREATED_USER_ID)!;
  assert.equal(suspended.suspended, true);
  const again = await send("POST", `${path}/suspend`);
  assert.equal(again.status, 409);
  assert.equal(await message(again), "Customer account is already suspended");
  assert.equal((await send("POST", `${path}/activate`)).status, 201);
  assert.equal((await send("POST", `${path}/activate`)).status, 409);

  // Unknown users and staff accounts are not customer accounts.
  const unknown = `/api/v1/admin/customer-accounts/${randomUUID()}`;
  assert.equal((await send("POST", `${unknown}/suspend`)).status, 404);
  assert.equal(
    (await send("PATCH", `${unknown}/password`, { password })).status,
    404,
  );
  const staffPath = `/api/v1/admin/customer-accounts/${TEST_MATCHING_USER_ID}`;
  assert.equal((await send("POST", `${staffPath}/suspend`)).status, 404);
  await application
    .get(DatabasePort)
    .grantCustomerMembership(
      company,
      TEST_MATCHING_USER_ID,
      TEST_SUPER_ADMIN_ID,
    );
  const staff = await send("POST", `${staffPath}/suspend`);
  assert.equal(staff.status, 409);
  assert.equal(
    await message(staff),
    "This is a staff account: manage it under staff management",
  );
});
