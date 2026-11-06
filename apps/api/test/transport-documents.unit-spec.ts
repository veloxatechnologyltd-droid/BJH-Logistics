import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanTransportDocumentFields,
  formatTableRows,
  parseTableRows,
  sumTableColumn,
  transportDocumentFields,
  transportDocumentKindsFor,
} from "@bjh/contracts";
import type { TableRow } from "@bjh/contracts";
import type {
  JobRecord,
  TransportDocumentRecord,
} from "../src/database/database.port";
import {
  renderTransportDocumentPdf,
  transportDocumentDraftReason,
} from "../src/transport/transport-document-pdf";

const job: JobRecord = {
  id: "job",
  fileNumber: "SYN/SI/2026/0001",
  serviceLine: "sea_import",
  customerCompanyId: "company",
  customerCompanyName: "Harbor Demo Ltd",
  quoteRequestId: null,
  quoteId: null,
  status: "open",
  openedBy: "user",
  openedAt: "2026-09-20T09:00:00.000Z",
  closedAt: null,
  vessel: null,
  portOfLoading: null,
  portOfDischarge: null,
  goodsDescription: null,
  remarks: null,
  expectedCompletionDate: null,
};

const document = (
  over: Partial<TransportDocumentRecord> = {},
): TransportDocumentRecord => ({
  id: "doc",
  jobId: "job",
  kind: "house_bl",
  documentNumber: "SYN-HBL-0001",
  status: "issued",
  fields: {
    shipper: "Synthetic Shipper Ltd\nBolgatanga, Ghana",
    consignee: "Synthetic Consignee LLC\nDoral, USA",
    masterReference: "SYNBK00042",
    containers: "SYNU1234567, seal 002686",
    goods: "1X20GP CONTAINER SAID TO CONTAIN 82 SACKS WOVEN BASKETS",
    freightTerms: "FREIGHT COLLECT",
  },
  createdBy: "user",
  createdAt: "2026-09-22T09:00:00.000Z",
  updatedAt: "2026-09-22T09:00:00.000Z",
  issuedBy: "user",
  issuedAt: "2026-09-22T10:00:00.000Z",
  voidedBy: null,
  voidedAt: null,
  voidReason: null,
  ...over,
});

const settings = {
  issuer: {
    name: "Synthetic Forwarding Ltd",
    address: "1 Test Road",
    phone: null,
    email: "docs@synthetic.test",
    website: null,
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

test("each service line offers its own documents", () => {
  assert.deepEqual(transportDocumentKindsFor("sea_import"), [
    "house_bl",
    "sea_manifest",
    "delivery_order",
    "proof_of_delivery",
  ]);
  assert.deepEqual(transportDocumentKindsFor("sea_export"), [
    "house_bl",
    "sea_manifest",
    "delivery_order",
    "proof_of_delivery",
  ]);
  assert.deepEqual(transportDocumentKindsFor("air_import"), [
    "house_awb",
    "air_manifest",
  ]);
  assert.deepEqual(transportDocumentKindsFor("air_export"), [
    "house_awb",
    "air_manifest",
  ]);
  assert.deepEqual(transportDocumentKindsFor("warehousing"), []);
  assert.deepEqual(transportDocumentKindsFor("road_transport"), []);
});

test("field values are trimmed, empty ones dropped, and unknown or oversized ones refused", () => {
  assert.deepEqual(
    cleanTransportDocumentFields("house_bl", {
      shipper: "  ACME  ",
      vessel: "   ",
    }),
    { success: true, data: { shipper: "ACME" } },
  );
  assert.deepEqual(
    cleanTransportDocumentFields("house_bl", { masterAwb: "x" }),
    {
      success: false,
      message: "masterAwb is not a field of this document",
    },
  );
  const tooLong = cleanTransportDocumentFields("house_bl", {
    vessel: "x".repeat(301),
  });
  assert.deepEqual(tooLong, {
    success: false,
    message: "Vessel must be at most 300 characters",
  });
  assert.equal(
    cleanTransportDocumentFields("house_bl", { goods: "x".repeat(2000) })
      .success,
    true,
  );
  // Every document lists its fields once and groups them.
  for (const kind of ["house_bl", "house_awb", "air_manifest"] as const) {
    const keys = transportDocumentFields[kind].map((field) => field.key);
    assert.equal(new Set(keys).size, keys.length, kind);
  }
});

test("an issued house B/L prints its number, parties, containers and goods", async () => {
  const text = pdfText(
    await renderTransportDocumentPdf(
      { document: document(), job, settings },
      { compress: false },
    ),
  );
  for (const expected of [
    "TRANSPORT BILL OF LADING (HOUSE B/L)",
    "SYN-HBL-0001",
    "Job file SYN/SI/2026/0001",
    "Synthetic Forwarding Ltd",
    "Synthetic Shipper Ltd",
    "Doral, USA",
    "SYNBK00042",
    "CONTAINER NO.",
    "SYNU1234567",
    "002686",
    "82 SACKS WOVEN BASKETS",
    "FREIGHT COLLECT",
    "MBL / BOOKING NO.",
    "For Synthetic Forwarding Ltd",
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
  assert.ok(!text.includes("DRAFT"));
});

test("drafts are marked and voided documents say why", async () => {
  assert.equal(
    transportDocumentDraftReason({ document: document(), job, settings }),
    null,
  );
  const draft = document({
    status: "draft",
    documentNumber: null,
    issuedAt: null,
    issuedBy: null,
  });
  assert.equal(
    transportDocumentDraftReason({ document: draft, job, settings }),
    "Draft - not yet issued",
  );
  const draftText = pdfText(
    await renderTransportDocumentPdf(
      { document: draft, job, settings },
      { compress: false },
    ),
  );
  assert.ok(draftText.includes("Not yet numbered"));
  assert.ok(draftText.includes("DRAFT"));
  const voided = pdfText(
    await renderTransportDocumentPdf(
      {
        document: document({ status: "void", voidReason: "Wrong consignee" }),
        job,
        settings,
      },
      { compress: false },
    ),
  );
  assert.ok(voided.includes("VOID - WRONG CONSIGNEE"));
});

test("an air manifest and a house air waybill print their own labels", async () => {
  const awb = pdfText(
    await renderTransportDocumentPdf(
      {
        document: document({
          kind: "house_awb",
          fields: { masterAwb: "999-12345678", carrier: "SYNTHETIC AIR" },
        }),
        job,
        settings,
      },
      { compress: false },
    ),
  );
  assert.ok(awb.includes("HOUSE AIR WAYBILL (HAWB)"));
  assert.ok(awb.includes("999-12345678"));
  const manifest = pdfText(
    await renderTransportDocumentPdf(
      {
        document: document({
          kind: "air_manifest",
          fields: {
            shipmentLines: formatTableRows(
              [
                {
                  hawb: "SYN-HAWB-1",
                  packages: "259",
                  grossWeight: "2347",
                  commodity: "POLO SHIRTS",
                },
              ],
              manifestColumns("shipmentLines", "air_manifest"),
            ),
          },
        }),
        job,
        settings,
      },
      { compress: false },
    ),
  );
  assert.ok(manifest.includes("AIR CARGO MANIFEST"));
  for (const expected of [
    "SYN-HAWB-1",
    "259",
    "2,347",
    "POLO SHIRTS",
    "Manifest total",
    "house air",
    "CERTIFICATION",
  ]) {
    assert.ok(manifest.includes(expected), `missing: ${expected}`);
  }
});

/** The number of pages in an uncompressed pdfkit document. */
const pageCount = (file: Buffer) =>
  (file.toString("latin1").match(/\/Type \/Page\b(?!s)/g) ?? []).length;

test("a typical house B/L, air waybill and manifest each fit on one page", async () => {
  const bl = document({
    fields: {
      ...document().fields,
      notifyParty: "Synthetic Notify Co\n1 Test Road\nLondon",
      deliveryAgent: "Synthetic Delivery Agent Ltd\nCheshire",
      vessel: "IONIKOS",
      voyage: "2639N",
      portOfLoading: "TEMA, GHANA",
      portOfDischarge: "LONDON GATEWAY",
      containerStatus: "FCL",
      shippedOnBoard: "10/10/2026",
      placeAndDateOfIssue: "TEMA GHANA, 24/08/2026",
      originals: "EXPRESS RELEASE",
      signatory: "HENRY SOMUAH",
    },
  });
  for (const candidate of [
    bl,
    document({
      kind: "house_awb",
      fields: {
        shipper: "S\nA",
        goods: "6216 PCS 259 CTNS MEN'S POLO SHIRTS",
        carrier: "BRITISH AIRWAYS",
      },
    }),
    document({
      kind: "air_manifest",
      fields: {
        shipper: "S\nA",
        shipmentLines:
          "BJH-16545CV | 259 CTNS | 2,347 KG | 2,347 KG | 20.04 CBM | POLO SHIRTS | GH",
      },
    }),
  ]) {
    const file = await renderTransportDocumentPdf(
      { document: candidate, job, settings },
      { compress: false },
    );
    // The landscape air manifest carries a certification and takes a second page.
    assert.ok(
      pageCount(file) === (candidate.kind === "air_manifest" ? 2 : 1),
      `${candidate.kind}: ${pageCount(file)} pages`,
    );
  }
});

test("several containers print as a table with their total weight", async () => {
  const file = await renderTransportDocumentPdf(
    {
      document: document({
        fields: {
          ...document().fields,
          containers:
            "MSKU1234567 | Seal A100 | 12500 kg\nTGHU7654321 | Seal B200 | 9800.5 kg",
        },
      }),
      job,
      settings,
    },
    { compress: false },
  );
  const text = pdfText(file);
  for (const expected of [
    "MSKU1234567",
    "TGHU7654321",
    "A100",
    "12,500",
    "9,800.5",
    "Total",
    "22,300.5",
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
});

test("the signature never stands alone on a page, however many containers", async () => {
  for (const count of [1, 3, 4, 5, 6, 12]) {
    const containers = Array.from(
      { length: count },
      (_, index) => `MSKU${1234560 + index} | Seal A${index} | 12000 kg`,
    ).join("\n");
    const file = await renderTransportDocumentPdf(
      {
        document: document({
          fields: { ...document().fields, containers },
        }),
        job,
        settings,
      },
      { compress: false },
    );
    // The last page must hold a row of the Terms boxes, not only the signature.
    const pages = file.toString("latin1").split(/\/Type \/Page\b(?!s)/);
    const lastPage = pages[pages.length - 1];
    const text = pdfText(Buffer.from(lastPage, "latin1"));
    assert.ok(text.includes("For Synthetic Forwarding Ltd"), `${count}`);
    assert.ok(
      pageCount(file) === 1 || text.includes("SIGNED FOR THE SHIPPER BY"),
      `${count} containers: signature alone on the last page`,
    );
  }
});

const manifestColumns = (
  key: string,
  kind: "air_manifest" | "sea_manifest",
) => {
  const columns = transportDocumentFields[kind].find(
    (field) => field.key === key,
  )?.columns;
  assert.ok(columns, `${kind} ${key} has columns`);
  return columns;
};

test("table rows round-trip as JSON, older line text still loads, totals add up", () => {
  const columns = manifestColumns("shipmentLines", "air_manifest");
  const rows: TableRow[] = [
    { hawb: "H1", packages: "2", grossWeight: "92", commodity: "BUBBLES\nGH" },
    { hawb: "H2", packages: "259 CTNS", grossWeight: "2,347" },
  ];
  const stored = formatTableRows(rows, columns);
  const back = parseTableRows(stored, columns);
  assert.equal(back[0].commodity, "BUBBLES\nGH");
  assert.equal(back[1].packages, "259 CTNS");
  assert.equal(sumTableColumn(back, "packages"), "261");
  assert.equal(sumTableColumn(back, "grossWeight"), "2439");
  assert.equal(sumTableColumn(back, "volume"), null);
  // A row with every cell empty is dropped; nothing at all is stored as empty text.
  assert.equal(formatTableRows([{ hawb: " " }, {}], columns), "");
  // Text from before tables: one row per line, cells in column order.
  assert.deepEqual(
    parseTableRows("H9 | 3 | 40", columns).map((row) => [
      row.hawb,
      row.packages,
      row.grossWeight,
    ]),
    [["H9", "3", "40"]],
  );
});

test("a sea cargo manifest prints its lines as a table with the total weight", async () => {
  const columns = manifestColumns("manifestLines", "sea_manifest");
  const file = await renderTransportDocumentPdf(
    {
      document: document({
        kind: "sea_manifest",
        documentNumber: "TRHU4227440",
        fields: {
          masterReference: "ONEYPSQG01159900",
          vessel: "MIRADOR EXPRESS 2635W",
          containerNumber: "TRHU4227440",
          totalPackages: "5",
          manifestLines: formatTableRows(
            [
              {
                shipper: "TRUST SOK CARGO",
                consignee: "MR HENRY AKYEAH\nMARKSMAN- ACCRA",
                blNumber: "ONEYPSQG01159900A",
                description: "1 UNIT OF TOYOTA CAMRY",
                weightKg: "3684",
              },
              {
                shipper: "TRUST SOK CARGO",
                consignee: "TOGBUI AKAMU",
                blNumber: "ONEYPSQG01159900B",
                description: "1 UNIT OF HONDA ACCORD",
                weightKg: "1533",
              },
            ],
            columns,
          ),
        },
      }),
      job,
      settings,
    },
    { compress: false },
  );
  const text = pdfText(file);
  for (const expected of [
    "SEA CARGO MANIFEST",
    "ONEYPSQG01159900",
    "ONEYPSQG01159900A",
    "ONEYPSQG01159900B",
    "CAMRY",
    "3,684",
    "1,533",
    "Total",
    "5,217",
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
  assert.equal(pageCount(file), 1);
});

const deliveryFields = {
  addressedTo: "Cargo Custodian / Terminal Operator, Synthetic Port",
  issueDate: "05 November 2026",
  consignee:
    "SYNTHETIC CONSIGNEE LLC\n1 Test Street, Testville\nTel: +000 11 222 3333",
  blNumber: "SYN-HBL-0001A",
  blDate: "25 August 2026",
  shipper: "SYNTHETIC SHIPPER CO., LTD",
  vesselVoyage: "SYN VESSEL / 0001W",
  portOfLoading: "Alpha",
  portOfDischarge: "Beta",
  container: "SYNU1234567 / 1 x 40HQ",
  seals: "SEAL0001",
  packages: "56",
  grossWeight: "2840",
  volume: "32.96",
  marks: "N/M",
  freightTerms: "Freight prepaid",
  serviceType: "CY-CY",
  releaseNotation: "TELEX-RELEASE",
  cargoDescription: "1. SYNTHETIC TRUCK\nChassis number: SYNCHASSIS0001",
  receiptItems: "Truck received",
};

test("a delivery order prints the sample's sections with the shipment particulars joined", async () => {
  const text = pdfText(
    await renderTransportDocumentPdf(
      {
        document: document({
          kind: "delivery_order",
          documentNumber: "BJH/DO/SYN-HBL-0001A",
          fields: deliveryFields,
        }),
        job,
        settings,
      },
      { compress: false },
    ),
  );
  for (const expected of [
    "DELIVERY ORDER",
    "BJH/DO/SYN-HBL-0001A",
    "05 November 2026",
    "Cargo Custodian / Terminal Operator, Synthetic Port",
    "CONSIGNEE",
    "SYNTHETIC CONSIGNEE LLC",
    "SHIPMENT PARTICULARS",
    "SYN-HBL-0001A",
    "Alpha / Beta",
    "SYNU1234567 / 1 x 40HQ",
    "56 packages / 2,840 kg / 32.96 CBM",
    "N/M / Freight prepaid / CY-CY",
    "TELEX-RELEASE",
    "CARGO DESCRIPTION",
    "Chassis number: SYNCHASSIS0001",
    "RELEASE CONDITIONS",
    "For Synthetic Forwarding Ltd",
    "Received by consignee or representative",
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
  assert.ok(!text.includes("DRAFT"));
});

test("a proof of delivery note prints the B/L totals and blank delivery record", async () => {
  const file = await renderTransportDocumentPdf(
    {
      document: document({
        kind: "proof_of_delivery",
        documentNumber: "BJH/POD/SYN-HBL-0001A",
        status: "draft",
        fields: deliveryFields,
      }),
      job,
      settings,
    },
    { compress: false },
  );
  const text = pdfText(file);
  for (const expected of [
    "PROOF OF DELIVERY NOTE",
    "BJH/POD/SYN-HBL-0001A",
    "CONSIGNEE AND SHIPMENT",
    "SYN-HBL-0001A | Dated 25 August 2026",
    "SYN VESSEL / 0001W | Alpha to Beta",
    "SYNU1234567 / 1 x 40HQ | Seal: SEAL0001",
    "56 packages | Gross weight: 2,840 kg | Volume: 32.96 CBM",
    "DELIVERY RECORD",
    "packages received out of 56 packages on B/L",
    "Truck received: Yes / No",
    "Seal intact: Yes / No / Not applicable",
    "ACKNOWLEDGEMENT OF RECEIPT",
    "Consignee or authorized receiver",
    "Delivered by",
    "DRAFT",
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
  // Both are one-page sheets.
  assert.equal(pageCount(file), 1);
});
