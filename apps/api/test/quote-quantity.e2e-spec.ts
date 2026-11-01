import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_SUPER_ADMIN_TOKEN,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let companyId: string;

function post(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TEST_SUPER_ADMIN_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const version = (lines: unknown[]) => ({
  currency: "USD",
  title: "Synthetic clearance quotation",
  sizeLabels: [],
  lines,
});

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  companyId = randomUUID();
  await application.get(DatabasePort).createCustomer({
    id: companyId,
    companyName: "Quantity Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("a line is a unit price times a quantity, with an optional container size", async () => {
  const response = await post("/api/v1/quotes", {
    customerCompanyId: companyId,
    serviceLine: "sea_import",
    version: version([
      {
        description: "Shipping line charges",
        basis: "per_container",
        containerSize: " 40ft ",
        quantity: 3,
        amountMinor: 45000,
      },
      { description: "Documentation", basis: "fixed", amountMinor: 12000 },
      { description: "Duty", basis: "at_cost" },
    ]),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const quote = (await response.json()) as {
    versions: Array<{
      lines: Array<{
        containerSize: string | null;
        quantity: number;
        amountMinor: number | null;
      }>;
    }>;
  };
  assert.deepEqual(
    quote.versions[0].lines.map((line) => [
      line.containerSize,
      line.quantity,
      line.amountMinor,
    ]),
    [
      ["40ft", 3, 45000],
      [null, 1, 12000],
      [null, 1, null],
    ],
  );
});

test("quantities must be whole and a per-size line keeps a quantity of 1", async () => {
  for (const [lines, sizeLabels, message] of [
    [
      [{ description: "Fee", basis: "fixed", amountMinor: 100, quantity: 0 }],
      [],
      "quantity must be at least 1",
    ],
    [
      [{ description: "Fee", basis: "fixed", amountMinor: 100, quantity: 1.5 }],
      [],
      "quantity must be a whole number",
    ],
    [
      [
        {
          description: "Fee",
          basis: "fixed",
          sizeAmountsMinor: [100, 200],
          quantity: 2,
        },
      ],
      ["20ft", "40ft"],
      "A line priced per size column has a quantity of 1",
    ],
  ] as const) {
    const response = await post("/api/v1/quotes", {
      customerCompanyId: companyId,
      serviceLine: "sea_import",
      version: { ...version([...lines]), sizeLabels: [...sizeLabels] },
    });
    assert.equal(response.status, 400, message);
    assert.equal(
      ((await response.json()) as { message: string }).message,
      message,
    );
  }
});
