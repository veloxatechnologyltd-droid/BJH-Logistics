import assert from "node:assert/strict";
import { test } from "node:test";
import { buildContactRows } from "./contactRows.ts";
import type { CustomerCompany } from "../customers/customerApi.ts";
import type { Lead } from "../customers/leadApi.ts";

const customer = (
  id: string,
  customerNumber: string,
  contacts: string[],
): CustomerCompany =>
  ({
    id,
    customerNumber,
    companyName: `Co ${id}`,
    phone: "030 000",
    companyEmail: `info@${id}.test`,
    contacts: contacts.map((name) => ({
      id: `${id}-${name}`,
      name,
      email: `${name}@${id}.test`,
      phone: null,
    })),
  }) as unknown as CustomerCompany;

const lead = (over: Partial<Lead>): Lead =>
  ({
    id: "l1",
    companyName: "Lead Co",
    contactName: null,
    email: null,
    phone: null,
    source: "campaign",
    customerCompanyId: null,
    ...over,
  }) as Lead;

test("a customer row carries its number and a Direct source", () => {
  const [row] = buildContactRows([customer("a", "C-1", ["Ama"])], []);
  assert.equal(row.id, "C-1");
  assert.equal(row.kind, "Customer");
  assert.equal(row.source, "Direct");
});

test("a customer with no contact still gets a row", () => {
  const rows = buildContactRows([customer("a", "C-1", [])], []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].email, "info@a.test");
});

test("a customer made from a campaign lead keeps the Campaign source and the lead is not listed twice", () => {
  const rows = buildContactRows(
    [customer("a", "C-1", ["Ama"])],
    [lead({ customerCompanyId: "a" })],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "Campaign");
});

test("an open lead is a Lead with no ID and its own source", () => {
  const rows = buildContactRows([], [lead({ source: "referral" })]);
  assert.equal(rows[0].kind, "Lead");
  assert.equal(rows[0].id, null);
  assert.equal(rows[0].source, "Referral");
});

test("an address on the do-not-email list is marked, whatever its case", () => {
  const rows = buildContactRows(
    [customer("a", "C-1", ["Ama"])],
    [lead({ email: "Stop@Example.test" })],
    new Set(["stop@example.test", "ama@a.test"]),
  );
  assert.deepEqual(
    rows.map((row) => [row.kind, row.optedOut]),
    [
      ["Customer", true],
      ["Lead", true],
    ],
  );
  assert.equal(buildContactRows([], [lead({})])[0].optedOut, false);
});

test("a lead opens the board that holds it, searched by name", () => {
  const [found, manual] = buildContactRows(
    [],
    [
      lead({ companyName: "A & B", source: "campaign" }),
      lead({ id: "l2", companyName: "Zed", source: "referral" }),
    ],
  );
  assert.equal(found.href, "/sales/pipeline?search=A%20%26%20B");
  assert.equal(manual.href, "/customers/leads?search=Zed");
});
