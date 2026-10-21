import assert from "node:assert/strict";
import { test } from "node:test";
import type { StatementEntryRecord } from "../src/database/database.port";
import { buildStatement } from "../src/finance/statement";

let sequence = 0;
const entry = (
  over: Partial<StatementEntryRecord> &
    Pick<StatementEntryRecord, "kind" | "date" | "amountMinor">,
): StatementEntryRecord => ({
  recordedAt: `2026-01-01T00:00:${String((sequence += 1)).padStart(2, "0")}.000Z`,
  currency: "GHS",
  invoiceNumber: "SYN/INV/2026/0001",
  fileNumber: "SYN/SI/2026/0001",
  jobReferences: [],
  receiptNumber: null,
  method: null,
  reference: null,
  ...over,
});

const all = { from: null, to: null };

test("invoices add to the balance, payments take from it, and it runs down the lines", () => {
  const [section] = buildStatement(
    [
      entry({ kind: "invoice", date: "2026-09-23", amountMinor: 1_146_733 }),
      entry({ kind: "invoice", date: "2026-09-23", amountMinor: 1_226_365 }),
      entry({ kind: "payment", date: "2026-09-30", amountMinor: 500_000 }),
    ],
    all,
  );
  assert.deepEqual(
    section.lines.map((line) => line.balanceMinor),
    [1_146_733, 2_373_098, 1_873_098],
  );
  assert.equal(section.debitMinor, 2_373_098);
  assert.equal(section.creditMinor, 500_000);
  assert.equal(section.openingMinor, 0);
  assert.equal(section.closingMinor, 1_873_098);
  // The closing balance is always opening + debits - credits.
  assert.equal(
    section.closingMinor,
    section.openingMinor + section.debitMinor - section.creditMinor,
  );
});

test("on the same day invoices come before payments so the balance never dips below zero", () => {
  const [section] = buildStatement(
    [
      entry({ kind: "payment", date: "2026-10-09", amountMinor: 1_000 }),
      entry({ kind: "invoice", date: "2026-10-09", amountMinor: 1_000 }),
    ],
    all,
  );
  assert.deepEqual(
    section.lines.map((line) => [line.kind, line.balanceMinor]),
    [
      ["invoice", 1_000],
      ["payment", 0],
    ],
  );
});

test("a start date folds earlier entries into the opening balance and an end date drops later ones", () => {
  const entries = [
    entry({ kind: "invoice", date: "2026-08-01", amountMinor: 10_000 }),
    entry({ kind: "payment", date: "2026-08-15", amountMinor: 4_000 }),
    entry({ kind: "invoice", date: "2026-09-10", amountMinor: 7_000 }),
    entry({ kind: "invoice", date: "2026-10-10", amountMinor: 9_000 }),
  ];
  const [section] = buildStatement(entries, {
    from: "2026-09-01",
    to: "2026-09-30",
  });
  assert.equal(section.openingMinor, 6_000);
  assert.equal(section.lines.length, 1);
  assert.equal(section.lines[0].balanceMinor, 13_000);
  assert.equal(section.closingMinor, 13_000);
  // The boundary days belong to the period.
  const [edge] = buildStatement(entries, {
    from: "2026-09-10",
    to: "2026-09-10",
  });
  assert.equal(edge.lines.length, 1);
  assert.equal(edge.openingMinor, 6_000);
});

test("each currency is its own section and amounts are never added across currencies", () => {
  const sections = buildStatement(
    [
      entry({
        kind: "invoice",
        date: "2026-09-01",
        amountMinor: 5_000,
        currency: "USD",
      }),
      entry({ kind: "invoice", date: "2026-09-02", amountMinor: 8_000 }),
      entry({
        kind: "payment",
        date: "2026-09-03",
        amountMinor: 2_000,
        currency: "USD",
      }),
    ],
    all,
  );
  assert.deepEqual(
    sections.map((section) => [section.currency, section.closingMinor]),
    [
      ["GHS", 8_000],
      ["USD", 3_000],
    ],
  );
});

test("a currency with nothing in the period and nothing owed before it is left out", () => {
  const entries = [
    entry({
      kind: "invoice",
      date: "2026-01-05",
      amountMinor: 5_000,
      currency: "USD",
    }),
    entry({
      kind: "payment",
      date: "2026-01-06",
      amountMinor: 5_000,
      currency: "USD",
    }),
    entry({
      kind: "invoice",
      date: "2026-01-05",
      amountMinor: 3_000,
      currency: "EUR",
    }),
    entry({ kind: "invoice", date: "2026-09-05", amountMinor: 1_000 }),
  ];
  const sections = buildStatement(entries, { from: "2026-09-01", to: null });
  // USD is settled before the period (opening 0, no lines); EUR still owes; GHS has a line.
  assert.deepEqual(
    sections.map((section) => [
      section.currency,
      section.openingMinor,
      section.lines.length,
    ]),
    [
      ["EUR", 3_000, 0],
      ["GHS", 0, 1],
    ],
  );
});

test("an invoice line names its invoice, job file and containers, bills and air waybills", () => {
  const [section] = buildStatement(
    [
      entry({
        kind: "invoice",
        date: "2026-09-23",
        amountMinor: 1_000,
        invoiceNumber: "SYN/INV/2026/0523",
        fileNumber: "SYN/SI/2026/0042",
        jobReferences: [
          { kind: "container", value: "SYNU1234567" },
          { kind: "container", value: "SYNU7654321" },
          { kind: "master_bl", value: "MBL-1" },
          { kind: "house_bl", value: "HBL-1" },
          { kind: "booking", value: "BK-1" },
        ],
      }),
      entry({
        kind: "invoice",
        date: "2026-09-24",
        amountMinor: 1_000,
        jobReferences: [{ kind: "master_awb", value: "125-0000" }],
      }),
    ],
    all,
  );
  assert.equal(
    section.lines[0].reference,
    "SYN/INV/2026/0523 - SYN/SI/2026/0042 - CONT#: SYNU1234567, SYNU7654321 - B/L#: MBL-1, HBL-1",
  );
  assert.match(section.lines[1].reference, /AWB#: 125-0000$/);
});

test("a payment line names its receipt, method, reference and the invoice it settles", () => {
  const [section] = buildStatement(
    [
      entry({ kind: "invoice", date: "2026-09-01", amountMinor: 5_000 }),
      entry({
        kind: "payment",
        date: "2026-09-02",
        amountMinor: 2_000,
        invoiceNumber: "SYN/INV/2026/0001",
        receiptNumber: "SYN/RCT/2026/0007",
        method: "bank_transfer",
        reference: "TT-884",
      }),
      entry({
        kind: "payment",
        date: "2026-09-03",
        amountMinor: 1_000,
        method: "cash",
      }),
    ],
    all,
  );
  assert.equal(
    section.lines[1].reference,
    "Receipt SYN/RCT/2026/0007 - Bank transfer (TT-884) - for SYN/INV/2026/0001",
  );
  // An older payment has no receipt number and no reference.
  assert.equal(
    section.lines[2].reference,
    "Payment - Cash - for SYN/INV/2026/0001",
  );
});

test("no entries give no sections", () => {
  assert.deepEqual(buildStatement([], all), []);
});
