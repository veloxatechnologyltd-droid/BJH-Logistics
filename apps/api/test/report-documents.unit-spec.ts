import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  JobFinanceRecord,
  JobListRecord,
  OutstandingInvoiceRecord,
  ReportInvoiceRecord,
  ReportPaymentRecord,
} from "../src/database/database.port";
import {
  ageBucket,
  invoicesPaymentsDocument,
  jobMarginDocument,
  receivablesDocument,
  shipmentStatusDocument,
  type ShipmentStatusRow,
} from "../src/reports/report-documents";
import {
  renderReportPdf,
  type ReportBlock,
  type ReportDocument,
} from "../src/reports/report-pdf";

const today = "2026-11-04";

type TableBlock = Extract<ReportBlock, { kind: "table" }>;
const tables = (document: ReportDocument) =>
  document.blocks.filter(
    (block): block is TableBlock => block.kind === "table",
  );
const kpis = (document: ReportDocument) =>
  document.blocks.flatMap((block) =>
    block.kind === "kpis" ? block.items : [],
  );

const owed = (
  over: Partial<OutstandingInvoiceRecord>,
): OutstandingInvoiceRecord => ({
  invoiceId: "i",
  invoiceNumber: "SYN/INV/1",
  jobId: "j",
  fileNumber: "SYN/SI/1",
  customerCompanyId: "c",
  customerCompanyName: "Alpha Ltd",
  currency: "GHS",
  totalMinor: 100_000,
  outstandingMinor: 100_000,
  dueDate: "2026-11-30",
  issuedAt: "2026-10-01T09:00:00Z",
  ...over,
});

test("an invoice falls in the column for how long it is past due", () => {
  assert.equal(ageBucket(null, today), 0);
  assert.equal(ageBucket("2026-11-04", today), 0, "due today is not late");
  assert.equal(ageBucket("2026-12-01", today), 0);
  assert.equal(ageBucket("2026-11-03", today), 1);
  assert.equal(ageBucket("2026-10-05", today), 1, "30 days late");
  assert.equal(ageBucket("2026-10-04", today), 2, "31 days late");
  assert.equal(ageBucket("2026-09-05", today), 2, "60 days late");
  assert.equal(ageBucket("2026-09-04", today), 3, "61 days late");
  assert.equal(ageBucket("2026-08-06", today), 3, "90 days late");
  assert.equal(ageBucket("2026-08-05", today), 4, "91 days late");
});

test("receivables ageing keeps each currency apart and totals every column", () => {
  const document = receivablesDocument({
    today,
    outstanding: [
      owed({ outstandingMinor: 50_000, dueDate: "2026-11-30" }),
      owed({ outstandingMinor: 20_000, dueDate: "2026-10-20" }),
      owed({
        invoiceNumber: "SYN/INV/2",
        customerCompanyName: "Beta Ltd",
        outstandingMinor: 10_000,
        dueDate: "2026-07-01",
      }),
      owed({ currency: "USD", outstandingMinor: 7_500, dueDate: null }),
    ],
  });
  const [ghs, usd, overdue] = tables(document);
  assert.deepEqual(ghs.total, [
    "Total",
    "GHS 500.00",
    "GHS 200.00",
    "-",
    "-",
    "GHS 100.00",
    "GHS 800.00",
  ]);
  assert.deepEqual(usd.total, [
    "Total",
    "USD 75.00",
    "-",
    "-",
    "-",
    "-",
    "USD 75.00",
  ]);
  assert.deepEqual(
    kpis(document).map((item) => [item.label, item.value]),
    [
      ["Owing (GHS)", "GHS 800.00"],
      ["Overdue (GHS)", "GHS 300.00"],
      ["Owing (USD)", "USD 75.00"],
      ["Overdue (USD)", "USD 0.00"],
    ],
  );
  assert.deepEqual(
    kpis(document).map((item) => item.note),
    ["3 invoices", "2 invoices", "1 invoice", "0 invoices"],
    "one invoice is not '1 invoices'",
  );
  assert.deepEqual(
    overdue.rows.map((row) => row[0]),
    ["SYN/INV/2", "SYN/INV/1"],
    "overdue invoices list the oldest first",
  );
  assert.ok(
    document.blocks.some(
      (block) => block.kind === "note" && /no due date/.test(block.text),
    ),
    "an invoice with no due date is said to count as not yet due",
  );
});

test("a report with nothing owed says so instead of drawing empty tables", () => {
  const document = receivablesDocument({ today, outstanding: [] });
  assert.ok(
    document.blocks.some(
      (block) => block.kind === "note" && /Nothing is owed/.test(block.text),
    ),
  );
  assert.deepEqual(kpis(document), []);
});

const invoiceRow = (
  over: Partial<ReportInvoiceRecord["invoice"]>,
): ReportInvoiceRecord =>
  ({
    jobId: "j",
    fileNumber: "SYN/SI/1",
    customerCompanyName: "Alpha Ltd",
    invoice: {
      id: "i",
      status: "issued",
      invoiceNumber: "SYN/INV/1",
      issuedAt: "2026-11-02T10:00:00Z",
      dueDate: "2026-11-30",
      currency: "GHS",
      totalMinor: 100_000,
      ...over,
    },
  }) as ReportInvoiceRecord;
const paymentRow = (
  over: Partial<ReportPaymentRecord["payment"]>,
  currency = "GHS",
): ReportPaymentRecord =>
  ({
    jobId: "j",
    fileNumber: "SYN/SI/1",
    customerCompanyId: "c",
    customerCompanyName: "Alpha Ltd",
    currency,
    invoiceNumber: "SYN/INV/1",
    payment: {
      id: "p",
      receiptNumber: "SYN/RCT/1",
      receivedOn: "2026-11-03",
      method: "cash",
      amountMinor: 30_000,
      reversal: null,
      ...over,
    },
  }) as ReportPaymentRecord;

test("invoices and payments leave out drafts, voids and reversed payments", () => {
  const document = invoicesPaymentsDocument({
    from: "2026-11-01",
    to: today,
    invoices: [
      invoiceRow({ totalMinor: 100_000 }),
      invoiceRow({ status: "void", totalMinor: 999_900 }),
      invoiceRow({ status: "draft", totalMinor: 888_800 }),
      invoiceRow({ currency: "USD", totalMinor: 50_000 }),
    ],
    payments: [
      paymentRow({ amountMinor: 30_000 }),
      paymentRow({
        amountMinor: 777_700,
        reversal: { reason: "x", reversedBy: "u", reversedAt: "x" },
      }),
    ],
  });
  const [summary] = tables(document);
  assert.deepEqual(summary.rows, [
    ["GHS", "1", "GHS 1,000.00", "1", "GHS 300.00"],
    ["USD", "1", "USD 500.00", "0", "USD 0.00"],
  ]);
});

// Only the fields the reports read; the rest of a job record is not their business.
const job = (over: Partial<JobListRecord>) =>
  ({
    id: "j1",
    fileNumber: "SYN/SI/1",
    serviceLine: "sea_import",
    customerCompanyId: "c",
    customerCompanyName: "Alpha Ltd",
    quoteRequestId: null,
    quoteId: null,
    status: "open",
    openedBy: "u",
    openedAt: "2026-11-02T09:00:00Z",
    closedAt: null,
    vessel: null,
    portOfLoading: null,
    portOfDischarge: null,
    currentEtaAt: null,
    leadUserId: null,
    ...over,
  }) as JobListRecord;
const money = (over: Partial<JobFinanceRecord>): JobFinanceRecord => ({
  jobId: "j1",
  fileNumber: "SYN/SI/1",
  customerCompanyName: "Alpha Ltd",
  currency: "GHS",
  invoicedMinor: 500_000,
  receivedMinor: 200_000,
  costMinor: 300_000,
  ...over,
});

test("a job's margin needs both an invoice and a recorded cost, and only jobs opened in the period count", () => {
  const document = jobMarginDocument({
    from: "2026-11-01",
    to: today,
    jobs: [
      job({ id: "j1", fileNumber: "A" }),
      job({ id: "j2", fileNumber: "B" }),
      job({ id: "j3", fileNumber: "C", openedAt: "2026-09-01T09:00:00Z" }),
    ],
    finance: [
      money({ jobId: "j1", fileNumber: "A" }),
      money({ jobId: "j2", fileNumber: "B", costMinor: 0 }),
      money({ jobId: "j3", fileNumber: "C" }),
    ],
  });
  const [table] = tables(document);
  assert.deepEqual(
    table.rows.map((row) => [row[0], row[6]]),
    [
      ["A", "GHS 2,000.00"],
      ["B", "-"],
    ],
    "job C opened before the period, and B has no cost to take away",
  );
  assert.deepEqual(table.total?.slice(3), [
    "GHS 10,000.00",
    "GHS 4,000.00",
    "GHS 3,000.00",
    "GHS 2,000.00",
  ]);
});

// Goods, remark and expected finish come with a later release; see report-documents.ts.
type ClientFields = {
  goodsDescription?: string | null;
  remarks?: string | null;
  expectedCompletionDate?: string | null;
};
const shipRow = (
  id: string,
  over: Partial<JobListRecord> & ClientFields = {},
  extra: Partial<ShipmentStatusRow> = {},
): ShipmentStatusRow => ({
  job: job({ id, fileNumber: id, ...over }),
  billNumbers: [],
  lastStep: null,
  ...extra,
});
const shipment = (
  over: Partial<Parameters<typeof shipmentStatusDocument>[0]> = {},
) =>
  shipmentStatusDocument({
    from: "2026-11-01",
    to: today,
    today,
    serviceLine: null,
    customerName: null,
    open: [],
    totalOpen: 0,
    completed: [],
    totalCompleted: 0,
    ...over,
  });

test("the shipment update counts what is arriving, late and undated, and says when it is cut short", () => {
  const document = shipment({
    serviceLine: "sea_import",
    totalOpen: 9,
    open: [
      shipRow("late", { currentEtaAt: "2026-11-01T00:00:00Z" }),
      shipRow("soon", { currentEtaAt: "2026-11-06T00:00:00Z" }),
      shipRow("far", { currentEtaAt: "2026-12-25T00:00:00Z" }),
      shipRow("none"),
    ],
  });
  assert.deepEqual(
    kpis(document).map((item) => [item.label, item.value]),
    [
      ["Open jobs", "9"],
      ["Arriving in 7 days", "1"],
      ["Expected date passed", "1"],
      ["No expected date", "1"],
      ["Completed", "0"],
    ],
  );
  const [open] = tables(document);
  assert.deepEqual(
    open.rows.map((cells) => cells[0]),
    ["late", "soon", "far", "none"],
    "earliest expected date first, undated last",
  );
  assert.match(document.subtitle, /Sea import/);
  assert.ok(
    document.blocks.some(
      (block) => block.kind === "note" && /4 jobs .* of 9/.test(block.text),
    ),
  );
});

test("the shipment update follows the reps' own columns: bill numbers, goods, remarks and completion date", () => {
  const document = shipment({
    customerName: "Sample Importer Ltd",
    serviceLine: "sea_import",
    totalOpen: 3,
    open: [
      shipRow(
        "SYN/SI/1",
        {
          goodsDescription: "2 PALLETS OF CARTONS",
          vessel: "MV SYNTHETIC",
          portOfDischarge: "Tema",
          currentEtaAt: "2026-11-10T00:00:00Z",
          remarks: "RELEASE ONGOING",
          expectedCompletionDate: "2026-11-30",
        },
        {
          billNumbers: ["HBL-1", "MBL-9"],
          lastStep: { label: "Vessel arrived", at: "2026-11-03T10:00:00Z" },
        },
      ),
      shipRow("SYN/SI/2", { status: "on_hold", goodsDescription: null }),
      shipRow("SYN/SI/3", {
        status: "in_progress",
        goodsDescription: null,
      }),
    ],
  });
  assert.equal(document.title, "Shipment status update: Sample Importer Ltd");
  const [open] = tables(document);
  // One customer and one service are in the title and subtitle, so those columns are dropped.
  assert.deepEqual(
    open.columns.map((column) => column.header),
    [
      "Job",
      "BL / AWB",
      "Description of goods",
      "Vessel / flight",
      "Port of discharge",
      "ETA",
      "Status / remarks",
      "Completion date",
    ],
  );
  assert.deepEqual(open.rows[0], [
    "SYN/SI/1",
    "HBL-1\nMBL-9",
    "2 PALLETS OF CARTONS",
    "MV SYNTHETIC",
    "Tema",
    "10 Nov 2026",
    "RELEASE ONGOING\nLast step: Vessel arrived, 3 Nov 2026",
    "30 Nov 2026",
  ]);
  assert.equal(open.rows[1][6], "On hold", "no remark: the job's status");
  assert.equal(open.rows[2][6], "In progress");
});

test("before jobs carry goods, remarks and an expected finish, those columns are left out; a completed job still shows its day", () => {
  const document = shipment({
    serviceLine: "sea_import",
    open: [shipRow("OPEN-1")],
    totalOpen: 1,
    completed: [
      shipRow("DONE-1", { status: "closed", closedAt: "2026-11-03T09:00:00Z" }),
    ],
    totalCompleted: 1,
  });
  const [open, completed] = tables(document);
  assert.deepEqual(
    open.columns.map((column) => column.header),
    [
      "Job",
      "Customer",
      "BL / AWB",
      "Vessel / flight",
      "Port of discharge",
      "ETA",
      "Status / remarks",
    ],
  );
  assert.equal(completed.columns.at(-1)?.header, "Completion date");
  assert.deepEqual(completed.rows[0].slice(-2), ["Completed", "3 Nov 2026"]);
  assert.ok(
    !document.blocks.some(
      (block) => block.kind === "note" && /completion date/.test(block.text),
    ),
  );
});

test("the all-customers update names each customer and service, and lists jobs completed in the period", () => {
  const document = shipment({
    open: [shipRow("OPEN-1", { customerCompanyName: "Alpha Ltd" })],
    totalOpen: 1,
    completed: [
      shipRow("DONE-OLD", {
        status: "closed",
        closedAt: "2026-11-01T09:00:00Z",
      }),
      shipRow("DONE-NEW", {
        status: "closed",
        closedAt: "2026-11-03T09:00:00Z",
        remarks: "CARGO HAS ARRIVED",
      }),
    ],
    totalCompleted: 2,
  });
  assert.equal(document.title, "Shipment status update");
  const [open, completed] = tables(document);
  assert.deepEqual(
    open.columns.slice(0, 3).map((c) => c.header),
    ["Job", "Customer", "Service"],
  );
  assert.deepEqual(
    completed.rows.map((cells) => [cells[0], cells.at(-2), cells.at(-1)]),
    [
      ["DONE-NEW", "CARGO HAS ARRIVED", "3 Nov 2026"],
      ["DONE-OLD", "Completed", "1 Nov 2026"],
    ],
    "most recently completed first; the closing day is the completion date",
  );
  assert.equal(kpis(document).at(-1)?.value, "2");
});

test("every kind of block draws into a real PDF, and a long table runs onto more pages", async () => {
  const rows = Array.from({ length: 120 }, (_, i) => [`Row ${i}`, "x"]);
  const document: ReportDocument = {
    title: "Synthetic report",
    subtitle: "Period: test",
    orientation: "landscape",
    blocks: [
      {
        kind: "kpis",
        items: Array.from({ length: 6 }, (_, i) => ({
          label: `A fairly long tile label number ${i}`,
          value: "GHS 123,456,789,012.00",
          note: "A note that is longer than the tile can hold on one line",
        })),
      },
      { kind: "heading", text: "Bars" },
      {
        kind: "bars",
        rows: [
          ["One", 3],
          ["Two", 0],
          ["Three", 9],
        ],
        empty: "-",
      },
      { kind: "bars", rows: [], empty: "Nothing here." },
      { kind: "note", text: "A closing note." },
      { kind: "heading", text: "Table" },
      {
        kind: "table",
        columns: [
          { header: "Name", width: 3 },
          { header: "Value", width: 1, align: "right" },
        ],
        rows,
        total: ["Total", "120"],
        empty: "",
      },
      {
        kind: "table",
        columns: [{ header: "Name", width: 1 }],
        rows: [],
        empty: "No rows.",
      },
    ],
  };
  const pdf = await renderReportPdf(
    { document, settings: null, generatedOn: today },
    { compress: false },
  );
  const text = pdf.toString("latin1");
  assert.ok(text.startsWith("%PDF-"));
  assert.ok(text.trimEnd().endsWith("%%EOF"));
  const pages = (text.match(/\/Type \/Page(?!s)/g) ?? []).length;
  assert.ok(
    pages >= 3,
    `120 rows should need several landscape pages, got ${pages}`,
  );
});
