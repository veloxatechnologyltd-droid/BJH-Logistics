import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_CUSTOMER_B_ID,
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
let companyA: string;
let companyB: string;

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}

function post(path: string, token: string, body: unknown) {
  return call(path, token, { method: "POST", body: JSON.stringify(body) });
}

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
    TEST_UNASSIGNED_USER_ID,
    "export_rep",
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
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

function put(path: string, token: string, body: unknown) {
  return call(path, token, { method: "PUT", body: JSON.stringify(body) });
}

const content = (currency = "GHS") => ({
  currency,
  title: "Synthetic clearance quotation",
  procedureSteps: [],
  requiredDocuments: [],
  terms: [],
  sizeLabels: ["20ft", "40ft"],
  lines: [
    {
      description: "BJH service fee",
      basis: "per_container",
      sizeAmountsMinor: [150000, 180000],
    },
  ],
});

const settings = (over: Record<string, unknown> = {}) => ({
  issuer: {
    name: "  Synthetic Forwarding Ltd  ",
    address: "1 Test Road",
    phone: "000 000 0000",
    email: "hello@synthetic.test",
    website: "synthetic.test",
  },
  currencies: ["usd", "GHS"],
  taxLines: [{ name: "Synthetic VAT", rateBasisPoints: 1500 }],
  paymentTermsDays: 14,
  numbering: {
    quotePrefix: "SYN/Q",
    invoicePrefix: "SYN/INV",
    receiptPrefix: "SYN/RCT",
  },
  quoteDefaults: {
    procedureSteps: ["Review documents"],
    terms: ["Synthetic terms."],
  },
  ...over,
});

type Revision = {
  revisionNumber: number;
  changedBy: string;
  settings: {
    issuer: { name: string };
    currencies: string[];
    quoteDefaults: { procedureSteps: string[]; intro: string | null };
    taxLines: unknown[];
  };
};

test("before anything is saved there are no settings, and staff can read that", async () => {
  const response = await call("/api/v1/settings", TEST_MATCHING_TOKEN);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { current: null });
});

test("the super admin saves settings; every save is a new revision", async () => {
  const first = await put(
    "/api/v1/settings",
    TEST_SUPER_ADMIN_TOKEN,
    settings(),
  );
  assert.equal(first.status, 200);
  const revision = (await first.json()) as Revision;
  assert.equal(revision.revisionNumber, 1);
  assert.equal(revision.changedBy, TEST_SUPER_ADMIN_ID);
  assert.equal(revision.settings.issuer.name, "Synthetic Forwarding Ltd");
  assert.deepEqual(revision.settings.currencies, ["USD", "GHS"]);
  assert.equal(revision.settings.quoteDefaults.intro, null);

  const second = await put(
    "/api/v1/settings",
    TEST_SUPER_ADMIN_TOKEN,
    settings({ taxLines: [] }),
  );
  assert.equal(((await second.json()) as Revision).revisionNumber, 2);

  const current = (await (
    await call("/api/v1/settings", TEST_MATCHING_TOKEN)
  ).json()) as { current: Revision };
  assert.equal(current.current.revisionNumber, 2);
  assert.deepEqual(current.current.settings.taxLines, []);

  const history = (await (
    await call("/api/v1/settings/revisions", TEST_SUPER_ADMIN_TOKEN)
  ).json()) as Revision[];
  assert.deepEqual(
    history.map((item) => [item.revisionNumber, item.settings.taxLines.length]),
    [
      [2, 0],
      [1, 1],
    ],
  );
});

test("invalid settings are rejected", async () => {
  const cases: Array<[unknown, string]> = [
    [[], "A settings object is required"],
    [
      settings({ issuer: { name: " " } }),
      "issuer name must contain 1 to 160 characters",
    ],
    [
      settings({ issuer: { name: "X", email: "not-an-email" } }),
      "email must be a valid email address",
    ],
    [settings({ currencies: [] }), "Configure at least one currency"],
    [
      settings({ currencies: ["dollars"] }),
      "currencies must be 3-letter codes such as USD or GHS",
    ],
    [settings({ currencies: ["USD", "usd"] }), "currencies must not repeat"],
    [
      settings({ taxLines: [{ name: "VAT", rateBasisPoints: 15.5 }] }),
      "rateBasisPoints must be a whole number",
    ],
    [
      settings({ taxLines: [{ name: "VAT", rateBasisPoints: 10001 }] }),
      "rateBasisPoints must be 0 to 10000",
    ],
    [settings({ paymentTermsDays: 400 }), "paymentTermsDays must be 0 to 365"],
    [
      settings({
        numbering: {
          quotePrefix: "bad prefix!",
          invoicePrefix: "I",
          receiptPrefix: "R",
        },
      }),
      'quotePrefix must be 1 to 20 letters, digits, "/" or "-"',
    ],
  ];
  for (const [body, message] of cases) {
    const response = await put(
      "/api/v1/settings",
      TEST_SUPER_ADMIN_TOKEN,
      body,
    );
    assert.equal(response.status, 400, message);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      message,
    );
  }
  const history = (await (
    await call("/api/v1/settings/revisions", TEST_SUPER_ADMIN_TOKEN)
  ).json()) as unknown[];
  assert.equal(history.length, 2);
});

test("quotes use the configured currencies and numbering prefix", async () => {
  const refused = await post("/api/v1/quotes", TEST_MATCHING_TOKEN, {
    customerCompanyId: companyA,
    serviceLine: "sea_import",
    version: content("EUR"),
  });
  assert.equal(refused.status, 400);
  assert.equal(
    ((await refused.json()) as { message: string }).message,
    "currency must be one of the configured currencies: USD, GHS",
  );

  const created = (await (
    await post("/api/v1/quotes", TEST_MATCHING_TOKEN, {
      customerCompanyId: companyA,
      serviceLine: "sea_import",
      version: content("usd"),
    })
  ).json()) as { id: string; versions: Array<{ currency: string }> };
  assert.equal(created.versions[0].currency, "USD");

  const edit = await put(
    `/api/v1/quotes/${created.id}/draft`,
    TEST_MATCHING_TOKEN,
    content("EUR"),
  );
  assert.equal(edit.status, 400);

  const issued = (await (
    await post(`/api/v1/quotes/${created.id}/issue`, TEST_MATCHING_TOKEN, {})
  ).json()) as { quoteNumber: string };
  assert.match(
    issued.quoteNumber,
    new RegExp(`^SYN/Q/SI/${new Date().getUTCFullYear()}/0001$`),
  );
});

test("access boundaries: only the super admin edits; staff read; customers see nothing", async () => {
  const repWrite = await put(
    "/api/v1/settings",
    TEST_MATCHING_TOKEN,
    settings(),
  );
  assert.equal(repWrite.status, 403);
  const repHistory = await call(
    "/api/v1/settings/revisions",
    TEST_MATCHING_TOKEN,
  );
  assert.equal(repHistory.status, 403);
  const customerRead = await call("/api/v1/settings", TEST_CUSTOMER_A_TOKEN);
  assert.equal(customerRead.status, 403);
  const customerWrite = await put(
    "/api/v1/settings",
    TEST_CUSTOMER_A_TOKEN,
    settings(),
  );
  assert.equal(customerWrite.status, 403);
  assert.equal((await fetch(`${baseUrl}/api/v1/settings`)).status, 401);
  const unchanged = (await (
    await call("/api/v1/settings", TEST_SUPER_ADMIN_TOKEN)
  ).json()) as { current: Revision };
  assert.equal(unchanged.current.revisionNumber, 2);
});

test("a quote keeps the bank account chosen from Settings, and a new version copies it", async () => {
  const usd = {
    id: "5f0f2b9e-0a53-4f3e-9d57-1a2b3c4d5e02",
    bankName: "Synthetic Bank",
    accountName: "Synthetic Forwarding Ltd",
    accountNumber: "0002000200020",
    currency: "USD",
  };
  const ghs = {
    ...usd,
    id: "5f0f2b9e-0a53-4f3e-9d57-1a2b3c4d5e01",
    accountNumber: "0001000100010",
    currency: "GHS",
  };
  assert.equal(
    (
      await put(
        "/api/v1/settings",
        TEST_SUPER_ADMIN_TOKEN,
        settings({ bankAccounts: [ghs, usd] }),
      )
    ).status,
    200,
  );
  type Created = {
    id: string;
    versions: Array<{ bankAccount: { id: string } | null }>;
  };
  const create = async (version: Record<string, unknown>) =>
    post("/api/v1/quotes", TEST_MATCHING_TOKEN, {
      customerCompanyId: companyA,
      serviceLine: "sea_import",
      version,
    });

  // Not chosen: the account in the quote's currency.
  const automatic = (await (await create(content("USD"))).json()) as Created;
  assert.equal(automatic.versions[0].bankAccount?.id, usd.id);

  // Chosen: that account; an id Settings does not list is refused.
  const chosen = (await (
    await create({ ...content("USD"), bankAccountId: ghs.id })
  ).json()) as Created;
  assert.equal(chosen.versions[0].bankAccount?.id, ghs.id);
  const unknown = await create({
    ...content("USD"),
    bankAccountId: "5f0f2b9e-0a53-4f3e-9d57-1a2b3c4d5eff",
  });
  assert.equal(unknown.status, 400);

  // Issue, then revise: the new draft starts with the same account.
  await post(`/api/v1/quotes/${chosen.id}/issue`, TEST_MATCHING_TOKEN, {});
  const revised = (await (
    await post(`/api/v1/quotes/${chosen.id}/versions`, TEST_MATCHING_TOKEN, {})
  ).json()) as Created;
  assert.equal(revised.versions.at(-1)?.bankAccount?.id, ghs.id);
});
