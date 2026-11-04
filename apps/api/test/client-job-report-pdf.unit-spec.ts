import assert from "node:assert/strict";
import { test } from "node:test";
import { renderClientJobReportPdf } from "../src/jobs/client-job-report-pdf";
import type {
  ClientJobReportRow,
  ClientJobReportView,
} from "../src/jobs/client-job-report.service";

const settings = {
  issuer: {
    name: "Synthetic Forwarding Ltd",
    address: "1 Synthetic Road, Testville",
    phone: "000 000 0000",
    email: "reports@example.test",
    website: "https://example.test",
  },
  currencies: ["GHS"],
  taxLines: [],
  paymentTermsDays: null,
  numbering: {
    quotePrefix: "SYN/Q",
    invoicePrefix: "SYN/INV",
    receiptPrefix: "SYN/RCT",
    waybillPrefix: "SYN/WB",
  },
  quoteDefaults: {
    intro: null,
    atCostNote: null,
    procedureSteps: [],
    requiredDocuments: [],
    documentsNote: null,
    timeline: null,
    terms: [],
  },
  notifications: { channels: "both" as const },
};

const row = (over: Partial<ClientJobReportRow> = {}): ClientJobReportRow => ({
  jobId: "job",
  fileNumber: "BJH/SI/2026/0001",
  customer: "Report Synthetic Ltd",
  billNumbers: ["HBL-0001", "MBL-0001"],
  goods: "2X40 STC CARTONS",
  vessel: "MV SYNTHETIC",
  eta: "2026-11-11",
  portOfDischarge: "TEMA",
  status: "BOE PROCESSING",
  completionDate: "2026-11-30",
  ...over,
});

const view = (
  over: Partial<ClientJobReportView> = {},
): ClientJobReportView => ({
  company: { id: "company", name: "Report Synthetic Ltd" },
  generatedOn: "2026-11-03",
  sections: [{ serviceLine: "sea_import", rows: [row()] }],
  completed: [],
  ...over,
});

/** The text drawn on the pages of an uncompressed pdfkit document. */
function pdfText(file: Buffer): string {
  const source = file.toString("latin1");
  const drawn: string[] = [];
  for (const match of source.matchAll(/\[([^\]]*)\]\s*TJ/g)) {
    drawn.push(
      [...match[1].matchAll(/<([0-9a-f]+)>/gi)]
        .map((hex) => Buffer.from(hex[1], "hex").toString("latin1"))
        .join(""),
    );
  }
  return drawn.join("\n");
}

const render = (report: ClientJobReportView, withSettings = true) =>
  renderClientJobReportPdf(
    { report, settings: withSettings ? settings : null },
    { compress: false },
  );

test("the report carries the sample's heading, columns, dates and footer", async () => {
  const file = await render(
    view({
      completed: [
        row({
          fileNumber: "BJH/SI/2026/0002",
          status: "CARGO HAS ARRIVED",
          completionDate: "2026-11-02",
        }),
      ],
    }),
  );
  assert.equal(file.subarray(0, 5).toString("latin1"), "%PDF-");
  const text = pdfText(file);
  // A heading or name may wrap inside its column, as in the sample.
  const flat = (value: string) => value.replace(/\s+/g, " ");
  for (const expected of [
    "Synthetic Forwarding Ltd",
    "Client Job Report",
    "Report Synthetic Ltd",
    "Generated on 03/11/2026",
    "Sea import",
    "Job No.",
    "BL / AWB No.",
    "Description of Goods",
    "Vessel / Flight",
    "Port of Discharge",
    "Status / Remarks",
    "Completion Date",
    "BJH/SI/2026/0001",
    "HBL-0001",
    "MBL-0001",
    "2X40 STC CARTONS",
    "MV SYNTHETIC",
    "11/11/2026",
    "TEMA",
    "BOE PROCESSING",
    "30/11/2026",
    "Completed jobs",
    "CARGO HAS ARRIVED",
    "02/11/2026",
    "000 000 0000  -  reports@example.test  -  https://example.test  -  Page 1 of 1",
  ]) {
    assert.ok(flat(text).includes(flat(expected)), `missing: ${expected}`);
  }
  assert.ok(
    text.indexOf("Sea import") < text.indexOf("Completed jobs"),
    "open jobs come before completed ones",
  );
});

test("a section with no jobs is left out, and an empty report says so", async () => {
  const empty = pdfText(await render(view({ sections: [], completed: [] })));
  assert.ok(empty.includes("There are no jobs to report."));
  assert.ok(!empty.includes("Completed jobs"));
  assert.ok(!empty.includes("Job No."));

  const onlyCompleted = pdfText(
    await render(view({ sections: [], completed: [row()] })),
  );
  assert.ok(onlyCompleted.includes("Completed jobs"));
  assert.ok(!onlyCompleted.includes("Sea import"));
});

test("a missing value leaves its cell blank and no issuer still renders", async () => {
  const file = await render(
    view({
      sections: [
        {
          serviceLine: "air_export",
          rows: [
            row({
              billNumbers: [],
              goods: null,
              vessel: null,
              eta: null,
              portOfDischarge: null,
              completionDate: null,
            }),
          ],
        },
      ],
    }),
    false,
  );
  const text = pdfText(file);
  assert.ok(text.includes("Issuer details not configured"));
  assert.ok(text.includes("Air export"));
  assert.ok(text.includes("BOE PROCESSING"));
  assert.ok(!text.includes("undefined") && !text.includes("null"));
});

test("a long list runs onto more pages and repeats the column headings", async () => {
  const rows = Array.from({ length: 60 }, (_, index) =>
    row({ fileNumber: `BJH/SI/2026/${String(index + 1).padStart(4, "0")}` }),
  );
  const text = pdfText(
    await render(view({ sections: [{ serviceLine: "sea_import", rows }] })),
  );
  const pages = Number(/Page 1 of (\d+)/.exec(text)?.[1]);
  assert.ok(pages > 1, "60 jobs need more than one landscape page");
  assert.ok(text.includes(`Page ${pages} of ${pages}`));
  assert.equal(
    text.split("Job No.").length - 1,
    pages,
    "every page starts with the column headings",
  );
  assert.ok(text.includes("BJH/SI/2026/0060"), "the last job is not lost");
});
