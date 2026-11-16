import "reflect-metadata";
import assert from "node:assert/strict";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_TOKEN,
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

type Expense = {
  id: string;
  category: string;
  amountMinor: number;
  voidedAt: string | null;
};
type ExpenseList = {
  expenses: Expense[];
  totals: Array<{ currency: string; amountMinor: number; count: number }>;
  byCategory: Array<{
    category: string;
    currency: string;
    amountMinor: number;
  }>;
  canSeePayroll: boolean;
};

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });

async function list(token: string, query = ""): Promise<ExpenseList> {
  const response = await call(`/api/v1/finance/expenses${query}`, token);
  assert.equal(response.status, 200);
  return (await response.json()) as ExpenseList;
}

async function record(token: string, body: Record<string, unknown>) {
  const response = await post("/api/v1/finance/expenses", token, {
    spentOn: "2026-11-10",
    currency: "GHS",
    paymentMethod: "cash",
    ...body,
  });
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()) as Expense;
}

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
  // Finance, but not the super admin; and a staff member outside finance.
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
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("finance records expenses and filters them", async () => {
  const fuel = await record(TEST_MATCHING_TOKEN, {
    category: "fuel",
    amountMinor: 50000,
    payee: "Goil Tema",
    reference: "RCPT-881",
  });
  await record(TEST_MATCHING_TOKEN, {
    category: "rent",
    amountMinor: 300000,
    spentOn: "2026-10-01",
    paymentMethod: "bank_transfer",
    description: "Office rent October",
  });
  await record(TEST_MATCHING_TOKEN, {
    category: "software",
    amountMinor: 2000,
    currency: "USD",
    paymentMethod: "card",
  });

  const all = await list(TEST_MATCHING_TOKEN);
  assert.equal(all.expenses.length, 3);
  assert.deepEqual(all.totals, [
    { currency: "GHS", amountMinor: 350000, count: 2 },
    { currency: "USD", amountMinor: 2000, count: 1 },
  ]);
  assert.equal(all.byCategory[0].category, "rent");

  const byCategory = await list(TEST_MATCHING_TOKEN, "?category=fuel");
  assert.deepEqual(
    byCategory.expenses.map((e) => e.id),
    [fuel.id],
  );
  const byGroup = await list(TEST_MATCHING_TOKEN, "?group=premises");
  assert.deepEqual(
    byGroup.expenses.map((e) => e.category),
    ["rent"],
  );
  const byDate = await list(
    TEST_MATCHING_TOKEN,
    "?from=2026-11-01&to=2026-11-30",
  );
  assert.equal(byDate.expenses.length, 2);
  const byMethod = await list(TEST_MATCHING_TOKEN, "?paymentMethod=card");
  assert.deepEqual(
    byMethod.expenses.map((e) => e.category),
    ["software"],
  );
  const byCurrency = await list(TEST_MATCHING_TOKEN, "?currency=usd");
  assert.equal(byCurrency.expenses.length, 1);
  const bySearch = await list(TEST_MATCHING_TOKEN, "?search=goil");
  assert.deepEqual(
    bySearch.expenses.map((e) => e.id),
    [fuel.id],
  );
  // A search for a LIKE wildcard matches only that character, not everything.
  assert.equal(
    (await list(TEST_MATCHING_TOKEN, "?search=%25")).expenses.length,
    0,
  );
});

test("payroll is the super admin's alone", async () => {
  const salary = await record(TEST_SUPER_ADMIN_TOKEN, {
    category: "salaries",
    amountMinor: 900000,
    paymentMethod: "bank_transfer",
  });

  const admin = await list(TEST_SUPER_ADMIN_TOKEN, "?category=salaries");
  assert.equal(admin.canSeePayroll, true);
  assert.deepEqual(
    admin.expenses.map((e) => e.id),
    [salary.id],
  );

  const finance = await list(TEST_MATCHING_TOKEN);
  assert.equal(finance.canSeePayroll, false);
  assert.ok(finance.expenses.every((e) => e.category !== "salaries"));
  assert.ok(finance.totals.every((t) => t.amountMinor < 900000));
  assert.equal(
    (await list(TEST_MATCHING_TOKEN, "?group=payroll")).expenses.length,
    0,
  );

  const recorded = await post("/api/v1/finance/expenses", TEST_MATCHING_TOKEN, {
    spentOn: "2026-11-10",
    category: "ssnit",
    amountMinor: 100,
    currency: "GHS",
    paymentMethod: "cash",
  });
  assert.equal(recorded.status, 403);
  const voided = await post(
    `/api/v1/finance/expenses/${salary.id}/void`,
    TEST_MATCHING_TOKEN,
    { reason: "Wrong" },
  );
  assert.equal(voided.status, 404);
});

test("a wrong entry is voided with a reason and leaves the totals", async () => {
  const wrong = await record(TEST_MATCHING_TOKEN, {
    category: "water",
    amountMinor: 7000,
  });
  const noReason = await post(
    `/api/v1/finance/expenses/${wrong.id}/void`,
    TEST_MATCHING_TOKEN,
    {},
  );
  assert.equal(noReason.status, 400);

  const voided = await post(
    `/api/v1/finance/expenses/${wrong.id}/void`,
    TEST_MATCHING_TOKEN,
    { reason: "Recorded twice" },
  );
  assert.equal(voided.status, 201);
  assert.ok(((await voided.json()) as Expense).voidedAt);

  const again = await post(
    `/api/v1/finance/expenses/${wrong.id}/void`,
    TEST_MATCHING_TOKEN,
    { reason: "Again" },
  );
  assert.equal(again.status, 409);

  assert.equal(
    (await list(TEST_MATCHING_TOKEN, "?category=water")).expenses.length,
    0,
  );
  const withVoided = await list(
    TEST_MATCHING_TOKEN,
    "?category=water&includeVoided=true",
  );
  assert.equal(withVoided.expenses.length, 1);
  assert.deepEqual(withVoided.totals, []);
});

test("bad input is refused", async () => {
  const cases: Array<Record<string, unknown>> = [
    { category: "other", amountMinor: 100 },
    { category: "fuel", amountMinor: 0 },
    { category: "yachts", amountMinor: 100 },
    { category: "fuel", amountMinor: 100, paymentMethod: "barter" },
    { category: "fuel", amountMinor: 100, spentOn: "2026-02-30" },
  ];
  for (const body of cases) {
    const response = await post(
      "/api/v1/finance/expenses",
      TEST_MATCHING_TOKEN,
      {
        spentOn: "2026-11-10",
        currency: "GHS",
        paymentMethod: "cash",
        ...body,
      },
    );
    assert.equal(response.status, 400, JSON.stringify(body));
  }
  const badFilter = await call(
    "/api/v1/finance/expenses?category=yachts",
    TEST_MATCHING_TOKEN,
  );
  assert.equal(badFilter.status, 400);
});

test("the finance summary carries expense totals for profit after expenses", async () => {
  type Summary = {
    trend: { months: string[] };
    expenses: {
      totals: Array<{ currency: string; amountMinor: number }>;
      months: Array<{ month: string; currency: string; amountMinor: number }>;
      includesPayroll: boolean;
    };
  };
  // Per month, only within the chart's six months (the window moves with today).
  const inWindow = (
    summary: Summary,
    expected: Array<{ month: string; currency: string; amountMinor: number }>,
  ) =>
    assert.deepEqual(
      summary.expenses.months,
      expected.filter((row) => row.month >= summary.trend.months[0]),
    );
  const byCurrency = (summary: Summary) =>
    Object.fromEntries(
      summary.expenses.totals.map((t) => [t.currency, t.amountMinor]),
    );
  const read = async (token: string) => {
    const response = await call("/api/v1/finance/summary", token);
    assert.equal(response.status, 200);
    return (await response.json()) as Summary;
  };

  // Live so far: fuel 500 + rent 3,000 GHS, software 20 USD, salaries 9,000
  // GHS (payroll); the water entry was voided and never counts.
  const finance = await read(TEST_MATCHING_TOKEN);
  assert.equal(finance.expenses.includesPayroll, false);
  assert.deepEqual(byCurrency(finance), { GHS: 350000, USD: 2000 });
  inWindow(finance, [
    { month: "2026-10", currency: "GHS", amountMinor: 300000 },
    { month: "2026-11", currency: "GHS", amountMinor: 50000 },
    { month: "2026-11", currency: "USD", amountMinor: 2000 },
  ]);

  const admin = await read(TEST_SUPER_ADMIN_TOKEN);
  assert.equal(admin.expenses.includesPayroll, true);
  assert.deepEqual(byCurrency(admin), { GHS: 1250000, USD: 2000 });
  inWindow(admin, [
    { month: "2026-10", currency: "GHS", amountMinor: 300000 },
    { month: "2026-11", currency: "GHS", amountMinor: 950000 },
    { month: "2026-11", currency: "USD", amountMinor: 2000 },
  ]);
});

test("people outside finance and customers are refused", async () => {
  for (const token of [TEST_UNASSIGNED_TOKEN, TEST_CUSTOMER_A_TOKEN]) {
    const read = await call("/api/v1/finance/expenses", token);
    assert.equal(read.status, 403);
    const write = await post("/api/v1/finance/expenses", token, {
      spentOn: "2026-11-10",
      category: "fuel",
      amountMinor: 100,
      currency: "GHS",
      paymentMethod: "cash",
    });
    assert.equal(write.status, 403);
  }
});
