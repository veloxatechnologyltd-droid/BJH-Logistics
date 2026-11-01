import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cleanTransportDocumentFields,
  transportDocumentFields,
  transportDocumentKindsFor,
} from "@bjh/contracts";
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
  assert.deepEqual(transportDocumentKindsFor("sea_import"), ["house_bl"]);
  assert.deepEqual(transportDocumentKindsFor("sea_export"), ["house_bl"]);
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
    "SYNU1234567, seal 002686",
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
          fields: { shipmentLines: "SYN-HAWB-1 | 259 CTNS | 2,347 KG" },
        }),
        job,
        settings,
      },
      { compress: false },
    ),
  );
  assert.ok(manifest.includes("AIR CARGO MANIFEST"));
  assert.ok(manifest.includes("SYN-HAWB-1 | 259 CTNS | 2,347 KG"));
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
          "BJH-16545CV | 259 CTNS | 2,347 KG | 20.04 CBM | POLO SHIRTS | GH",
      },
    }),
  ]) {
    const file = await renderTransportDocumentPdf(
      { document: candidate, job, settings },
      { compress: false },
    );
    assert.equal(pageCount(file), 1, candidate.kind);
  }
});
