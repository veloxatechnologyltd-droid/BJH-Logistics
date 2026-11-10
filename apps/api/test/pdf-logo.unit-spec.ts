import assert from "node:assert/strict";
import { test } from "node:test";
import type { BusinessSettings } from "@bjh/contracts";
import type {
  DeliveryRecord,
  InvoicePaymentRecord,
  JobRecord,
  TransportDocumentRecord,
} from "../src/database/database.port";
import {
  renderBatchReceiptPdf,
  renderPaymentSummaryPdf,
} from "../src/finance/receipt-pdf";
import { renderJobReportPdf } from "../src/finance/job-report-pdf";
import { renderStatementPdf } from "../src/finance/statement-pdf";
import { renderClientJobReportPdf } from "../src/jobs/client-job-report-pdf";
import { renderReportPdf } from "../src/reports/report-pdf";
import { renderTransportDocumentPdf } from "../src/transport/transport-document-pdf";
import { renderWaybillPdf } from "../src/transport/waybill-pdf";

// Every printable carries BJH's logo; a PNG drawn by pdfkit is an image object.
const hasLogo = (file: Buffer) =>
  file.toString("latin1").includes("/Subtype /Image");

const settings: BusinessSettings = {
  issuer: {
    name: "Synthetic Forwarding Ltd",
    address: "1 Test Road",
    phone: null,
    email: null,
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
  notifications: { channels: "both" },
};

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
  etdAt: null,
};

const company = { id: "company", name: "Harbor Demo Ltd" };
const compress = { compress: false };

test("the statement carries the logo", async () => {
  const file = await renderStatementPdf(
    {
      statement: {
        company: { ...company, customerNumber: null },
        from: null,
        to: null,
        serviceLine: null,
        generatedOn: "2026-11-05",
        sections: [],
      },
      settings,
    },
    compress,
  );
  assert.ok(hasLogo(file));
});

test("the finance job report carries the logo", async () => {
  const file = await renderJobReportPdf(
    {
      report: {
        company: { ...company, customerNumber: null },
        from: null,
        to: null,
        generatedOn: "2026-11-05",
        jobs: [],
        totals: [],
        credit: [],
      },
      settings,
    },
    compress,
  );
  assert.ok(hasLogo(file));
});

test("the client job report carries the logo", async () => {
  const file = await renderClientJobReportPdf(
    {
      report: {
        company,
        generatedOn: "2026-11-05",
        sections: [],
        completed: [],
      },
      settings,
    },
    compress,
  );
  assert.ok(hasLogo(file));
});

test("the reports PDF carries the logo", async () => {
  const file = await renderReportPdf(
    {
      document: {
        title: "Synthetic report",
        subtitle: "As of today",
        orientation: "portrait",
        blocks: [],
      },
      settings,
      generatedOn: "2026-11-05",
    },
    compress,
  );
  assert.ok(hasLogo(file));
});

test("the payment summary and a batch receipt carry the logo", async () => {
  const summary = await renderPaymentSummaryPdf(
    {
      companyName: "Harbor Demo Ltd",
      from: null,
      to: null,
      lines: [],
      settings,
    },
    compress,
  );
  assert.ok(hasLogo(summary));

  const payment: InvoicePaymentRecord = {
    id: "payment",
    invoiceId: "invoice",
    receiptNumber: "SYN/RCT/2026/0001",
    creditId: null,
    batchId: "batch",
    amountMinor: 100000,
    receivedOn: "2026-09-25",
    method: "bank_transfer",
    reference: null,
    evidenceDocumentId: null,
    note: null,
    recordedBy: "user",
    recordedAt: "2026-09-25T11:00:00.000Z",
    reversal: null,
  };
  const receipt = await renderBatchReceiptPdf(
    {
      lines: [
        {
          payment,
          invoiceNumber: "SYN/INV/2026/0001",
          jobId: "job",
          fileNumber: job.fileNumber,
          customerCompanyId: "company",
          customerCompanyName: "Harbor Demo Ltd",
          currency: "GHS",
          invoiceTotalMinor: 100000,
          invoiceOutstandingMinor: 0,
        },
      ],
      settings,
    },
    compress,
  );
  assert.ok(hasLogo(receipt));
});

test("the waybill carries the logo", async () => {
  const delivery: DeliveryRecord = {
    id: "delivery",
    jobId: "job",
    waybillNumber: "SYN/WB/2026/0007",
    driverId: "driver",
    vehicleId: "vehicle",
    driverName: "Kofi Synthetic",
    driverPhone: "000 111 2222",
    vehicleRegistration: "GX 0001-26",
    cargoDescription: "Baskets",
    packages: 1,
    grossWeightKg: 100,
    pickupLocation: "Synthetic terminal",
    deliveryAddress: "1 Test Road",
    dispatchedAt: "2026-09-22T09:30:00.000Z",
    dispatchedBy: "user",
    status: "dispatched",
    receiverName: null,
    receiverPhone: null,
    deliveredAt: null,
    damageNotes: null,
    podDocumentId: null,
    podRecordedBy: null,
    podRecordedAt: null,
  };
  const file = await renderWaybillPdf(
    { delivery, job, parties: [], references: [], settings },
    compress,
  );
  assert.ok(hasLogo(file));
});

test("a house B/L carries the logo", async () => {
  const document: TransportDocumentRecord = {
    id: "doc",
    jobId: "job",
    kind: "house_bl",
    documentNumber: "SYN-HBL-0001",
    status: "issued",
    fields: { shipper: "Synthetic Shipper Ltd", goods: "Baskets" },
    createdBy: "user",
    createdAt: "2026-09-22T09:00:00.000Z",
    updatedAt: "2026-09-22T09:00:00.000Z",
    issuedBy: "user",
    issuedAt: "2026-09-22T10:00:00.000Z",
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
  };
  const file = await renderTransportDocumentPdf(
    { document, job, settings },
    compress,
  );
  assert.ok(hasLogo(file));
});
