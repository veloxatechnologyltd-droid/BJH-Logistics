import PDFDocument from "pdfkit";
import { drawLogo } from "../assets/logo";
import type { BusinessSettings } from "@bjh/contracts";
import { formatInvoiceAmount } from "./invoice-pdf";
import type { JobReportView } from "./job-report.service";

// Same palette as the invoice, quote, statement and waybill PDFs.
const PRIMARY = "#0b3fae";
const INK = "#17324d";
const MUTED = "#526b7d";
const BORDER = "#d7e3ed";
const CANVAS = "#f4f8fc";

const PAGE_MARGIN = 40;
const LOGO_HEIGHT = 40;

const serviceLabels: Record<string, string> = {
  sea_import: "Sea import",
  sea_export: "Sea export",
  air_import: "Air import",
  air_export: "Air export",
  warehousing: "Warehousing",
  road_transport: "Road transport",
};
const statusLabels: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  on_hold: "On hold",
  ready_to_close: "Ready to close",
  closed: "Closed",
  cancelled: "Cancelled",
};
const partyLabels: Record<string, string> = {
  shipper: "Shipper",
  consignee: "Consignee",
  notify_party: "Notify party",
  agent: "Agent",
};
const referenceLabels: Record<string, string> = {
  master_bl: "Master B/L",
  house_bl: "House B/L",
  master_awb: "Master AWB",
  house_awb: "House AWB",
  booking: "Booking",
  container: "Container",
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Accra",
  }).format(new Date(value));
}

export interface JobReportPdfInput {
  report: JobReportView;
  settings: BusinessSettings | null;
}

/** A customer's jobs in detail, with invoices and balances: A4 portrait. */
export function renderJobReportPdf(
  input: JobReportPdfInput,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const { report, settings } = input;
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";
  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    bufferPages: true,
    compress: options.compress ?? true,
    info: {
      Title: `Job report - ${report.company.name}`,
      Author: issuerName,
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = PAGE_MARGIN;
  const width = doc.page.width - PAGE_MARGIN * 2;
  const bottom = () => doc.page.height - PAGE_MARGIN - 20;
  const ensure = (height: number) => {
    if (doc.y + height > bottom()) doc.addPage();
  };
  const label = (text: string) => {
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(MUTED);
    doc.text(text.toUpperCase(), left, doc.y, { characterSpacing: 0.5 });
    doc.moveDown(0.2);
  };
  const body = (text: string) => {
    doc.font("Helvetica").fontSize(11).fillColor(INK);
    doc.text(text, left, doc.y, { width });
  };

  // Header.
  const logoHeight = drawLogo(doc, left, PAGE_MARGIN, LOGO_HEIGHT);
  doc.font("Helvetica-Bold").fontSize(20).fillColor(PRIMARY);
  doc.text(issuerName, left, PAGE_MARGIN + (logoHeight ? logoHeight + 6 : 0), {
    width,
  });
  doc.font("Helvetica-Bold").fontSize(16).fillColor(INK);
  doc.text("Job report", left, doc.y + 4);
  doc.font("Helvetica").fontSize(12).fillColor(INK);
  doc.text(
    `${report.company.name}${report.company.customerNumber ? ` (${report.company.customerNumber})` : ""}`,
  );
  doc.fontSize(10.5).fillColor(MUTED);
  const period =
    report.from && report.to
      ? `Jobs opened ${formatDate(report.from)} to ${formatDate(report.to)}`
      : report.from
        ? `Jobs opened from ${formatDate(report.from)}`
        : report.to
          ? `Jobs opened up to ${formatDate(report.to)}`
          : "All jobs";
  doc.text(
    `${period} · ${report.jobs.length} ${report.jobs.length === 1 ? "job" : "jobs"} · Prepared ${formatDate(report.generatedOn)}`,
  );
  doc.moveDown(0.8);

  // Summary per currency.
  if (report.totals.length > 0 || report.credit.length > 0) {
    label("Summary");
    const columns = [0.2, 0.2, 0.2, 0.2, 0.2].map((part) => part * width);
    const titles = ["Currency", "Invoiced", "Paid", "Outstanding", "Credit"];
    const rowAt = (cells: string[], bold: boolean, fill: boolean) => {
      const y = doc.y;
      if (fill) doc.rect(left, y, width, 26).fillAndStroke(CANVAS, BORDER);
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(10.5)
        .fillColor(bold ? PRIMARY : INK);
      let x = left;
      cells.forEach((text, index) => {
        doc.text(text, x + 6, y + 7, {
          width: columns[index] - 12,
          align: index === 0 ? "left" : "right",
          lineBreak: false,
        });
        x += columns[index];
      });
      doc.y = y + 26;
    };
    rowAt(titles, true, true);
    const currencies = [
      ...new Set([
        ...report.totals.map((total) => total.currency),
        ...report.credit.map((item) => item.currency),
      ]),
    ].sort();
    for (const currency of currencies) {
      const total = report.totals.find((item) => item.currency === currency);
      const credit = report.credit.find((item) => item.currency === currency);
      const money = (minor: number) => formatInvoiceAmount(minor, currency);
      rowAt(
        [
          currency,
          money(total?.invoicedMinor ?? 0),
          money(total?.paidMinor ?? 0),
          money(total?.outstandingMinor ?? 0),
          credit ? money(credit.availableMinor) : "-",
        ],
        false,
        false,
      );
    }
    doc.moveDown(1);
  }

  if (report.jobs.length === 0) {
    body("No jobs match this report.");
  }

  for (const item of report.jobs) {
    const { job } = item;
    ensure(110);
    // Job heading band.
    const y = doc.y;
    doc.rect(left, y, width, 30).fill(PRIMARY);
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#ffffff");
    doc.text(
      `${job.fileNumber} · ${serviceLabels[job.serviceLine] ?? job.serviceLine} · ${statusLabels[job.status] ?? job.status}`,
      left + 10,
      y + 8.5,
      { width: width - 20, lineBreak: false },
    );
    doc.y = y + 40;

    const facts = [
      `Opened ${formatDate(job.openedAt)}`,
      job.closedAt ? `Closed ${formatDate(job.closedAt)}` : null,
      job.vessel ? `Vessel ${job.vessel}` : null,
      job.portOfLoading ? `From ${job.portOfLoading}` : null,
      job.portOfDischarge ? `To ${job.portOfDischarge}` : null,
      item.etaAt ? `Expected arrival ${formatDate(item.etaAt)}` : null,
    ].filter(Boolean);
    body(facts.join(" · "));
    doc.moveDown(0.5);

    if (item.parties.length > 0) {
      ensure(30);
      label("Parties");
      body(
        item.parties
          .map(
            (party) =>
              `${partyLabels[party.role] ?? party.role}: ${party.name}`,
          )
          .join("   "),
      );
      doc.moveDown(0.5);
    }
    if (item.references.length > 0) {
      ensure(30);
      label("References");
      body(
        item.references
          .map(
            (reference) =>
              `${referenceLabels[reference.kind] ?? reference.kind} ${reference.value}`,
          )
          .join("   "),
      );
      doc.moveDown(0.5);
    }
    if (item.milestones.length > 0) {
      ensure(40);
      label("Progress");
      doc.font("Helvetica").fontSize(11);
      for (const step of item.milestones) {
        ensure(18);
        doc.fillColor(step.occurredAt ? INK : MUTED);
        doc.text(
          `${step.occurredAt ? "Done" : "Pending"}  ${step.label}${step.occurredAt ? ` (${formatDate(step.occurredAt)})` : ""}`,
          left + 6,
          doc.y,
          { width: width - 6 },
        );
      }
      doc.moveDown(0.5);
    }
    if (item.deliveries.length > 0) {
      ensure(30);
      label("Deliveries");
      for (const delivery of item.deliveries) {
        ensure(18);
        body(
          `Waybill ${delivery.waybillNumber} · dispatched ${formatDate(delivery.dispatchedAt)} to ${delivery.deliveryAddress} · ${
            delivery.status === "delivered" && delivery.deliveredAt
              ? `delivered ${formatDate(delivery.deliveredAt)}${delivery.receiverName ? `, received by ${delivery.receiverName}` : ""}`
              : "on the way"
          }`,
        );
      }
      doc.moveDown(0.5);
    }

    ensure(80);
    label("Invoices");
    if (item.invoices.length === 0) {
      body("No invoice issued yet.");
    } else {
      const columns = [0.22, 0.15, 0.15, 0.16, 0.16, 0.16].map(
        (part) => part * width,
      );
      const row = (cells: string[], bold: boolean) => {
        ensure(24);
        const rowY = doc.y;
        if (bold) doc.rect(left, rowY, width, 22).fillAndStroke(CANVAS, BORDER);
        doc
          .font(bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(10)
          .fillColor(bold ? PRIMARY : INK);
        let x = left;
        cells.forEach((text, index) => {
          doc.text(text, x + 5, rowY + 6, {
            width: columns[index] - 10,
            align: index < 3 ? "left" : "right",
            lineBreak: false,
          });
          x += columns[index];
        });
        doc.y = rowY + 22;
      };
      row(["Invoice", "Issued", "Due", "Total", "Paid", "Outstanding"], true);
      for (const invoice of item.invoices) {
        const money = (minor: number) =>
          formatInvoiceAmount(minor, invoice.currency);
        row(
          [
            invoice.invoiceNumber,
            formatDate(invoice.issuedOn),
            invoice.dueDate ? formatDate(invoice.dueDate) : "-",
            money(invoice.totalMinor),
            money(invoice.paidMinor),
            money(invoice.outstandingMinor),
          ],
          false,
        );
      }
    }
    doc.moveDown(1.2);
  }

  // Page numbers.
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    // Writing inside the bottom margin would otherwise start a new page.
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    doc.text(
      `${issuerName}  |  Job report  |  ${report.company.name}  |  Page ${index + 1} of ${range.count}`,
      left,
      doc.page.height - 28,
      { width, align: "center", lineBreak: false },
    );
  }
  doc.end();
  return done;
}
