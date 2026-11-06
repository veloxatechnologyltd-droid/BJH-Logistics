import PDFDocument from "pdfkit";
import { drawLogo } from "../assets/logo";
import { transportDocumentTitles } from "@bjh/contracts";
import type { TransportDocumentPdfInput } from "./transport-document-pdf";

// Same palette as the other PDFs.
const PRIMARY = "#0b3fae";
const INK = "#17324d";
const MUTED = "#526b7d";
const BORDER = "#d7e3ed";
const CANVAS = "#eef4fb";
const MARK_RED = "#b3261e";

const PAGE_MARGIN = 40;
const LOGO_HEIGHT = 40;
const TEXT = 11;
const SMALL = 9;
const FOOTER_SPACE = 12;

const RELEASE_CONDITIONS =
  "Release is subject to confirmation of carrier telex release, Customs and terminal clearance, settlement of applicable charges, and verification of the collecting representative's identity and authority. This order takes effect upon signature and company stamp by BJH Logistics Services Ltd.";
const ACKNOWLEDGEMENT =
  "I acknowledge receipt of the cargo and quantities recorded above, in the condition noted. Any visible damage, shortage or other exception is recorded in the remarks section.";
const POD_NOTE =
  "Complete at delivery. Shipment particulars are taken from the bill of lading; actual quantities, condition and receipt must be confirmed by the receiver.";

type Line = { text: string; bold?: boolean };
type Row = { label: string; lines: Line[] };

/** 2840 prints as 2,840; text that is not a number prints as typed. */
function number(value: string): string {
  const parsed = Number(value.replace(/,/g, ""));
  return value.trim() !== "" && Number.isFinite(parsed)
    ? parsed.toLocaleString("en-US", { maximumFractionDigits: 3 })
    : value;
}

/** "56" -> "56 packages"; a value that already says more is left as typed. */
function withUnit(value: string | undefined, unit: string): string | null {
  if (!value) return null;
  return /^[\d.,\s]+$/.test(value) ? `${number(value)} ${unit}` : value;
}

const blank = (length: number) => "_".repeat(length);

/**
 * The delivery order and the proof of delivery note: BJH's own one-page
 * samples (logo and issuer details, centred title, shipment table, hand-filled
 * boxes and signature blocks), drawn from the document's fields.
 */
export function renderDeliveryDocumentPdf(
  input: TransportDocumentPdfInput,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const { document, settings } = input;
  const fields = document.fields;
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";
  const isOrder = document.kind === "delivery_order";
  const title = transportDocumentTitles[document.kind];

  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    bufferPages: true,
    compress: options.compress ?? true,
    info: {
      Title: `${title} ${document.documentNumber ?? "(draft)"}`,
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
  const bottom = () => doc.page.height - PAGE_MARGIN - FOOTER_SPACE;
  const ensure = (height: number) => {
    if (doc.y + height > bottom()) doc.addPage();
  };
  const heading = (text: string) => {
    ensure(40);
    doc.font("Helvetica-Bold").fontSize(TEXT).fillColor(PRIMARY);
    doc.text(text, left, doc.y + 6, { width, characterSpacing: 0.5 });
    doc.y += 4;
  };
  const paragraph = (text: string, size: number, color: string) => {
    doc.font("Helvetica").fontSize(size).fillColor(color);
    doc.text(text, left, doc.y + 2, { width });
  };

  // Logo on the left, the issuer's details beside it.
  const logoHeight = drawLogo(doc, left, PAGE_MARGIN, LOGO_HEIGHT);
  const textX = left + width * 0.5;
  doc.font("Helvetica-Bold").fontSize(SMALL).fillColor(MUTED);
  doc.text(issuerName.toUpperCase(), textX, PAGE_MARGIN + 6, {
    width: width * 0.5,
  });
  doc.font("Helvetica").fontSize(SMALL).fillColor(MUTED);
  const contact = [
    settings?.issuer.address,
    settings?.issuer.phone
      ? `${isOrder ? "Tel" : "Tel / WhatsApp"}: ${settings.issuer.phone}`
      : null,
    settings?.issuer.email ? `Email: ${settings.issuer.email}` : null,
  ].filter(Boolean);
  for (const row of contact) {
    doc.text(String(row), textX, doc.y + 2, { width: width * 0.5 });
  }
  doc.y = Math.max(doc.y, PAGE_MARGIN + logoHeight) + 10;

  doc.font("Helvetica-Bold").fontSize(24).fillColor("#000000");
  doc.text(title.toUpperCase(), left, doc.y, { width, align: "center" });
  doc.y += 6;

  // "Label: value" on one line.
  const detail = (pairs: [string, string][]) => {
    const y = doc.y;
    let x = left;
    for (const [label, value] of pairs) {
      doc.font("Helvetica-Bold").fontSize(TEXT).fillColor("#000000");
      doc.text(`${label} `, x, y, { continued: true, lineBreak: false });
      doc.font("Helvetica").text(value, { continued: false, lineBreak: false });
      x += doc.widthOfString(`${label} ${value}`) + 24;
    }
    doc.y = y + 18;
  };

  // A two-column table: label on the left, lines of text on the right.
  const table = (rows: Row[]) => {
    const labelWidth = width * 0.3;
    const valueWidth = width - labelWidth - 20;
    for (const row of rows) {
      const heights = row.lines.map((item) => {
        doc.font(item.bold ? "Helvetica-Bold" : "Helvetica").fontSize(TEXT);
        return doc.heightOfString(item.text || " ", { width: valueWidth });
      });
      doc.font("Helvetica-Bold").fontSize(TEXT);
      const labelHeight = doc.heightOfString(row.label, {
        width: labelWidth - 20,
      });
      const height =
        Math.max(
          labelHeight,
          heights.reduce((sum, item) => sum + item, 0),
        ) + 8;
      ensure(height);
      const y = doc.y;
      doc
        .lineWidth(0.8)
        .rect(left, y, labelWidth, height)
        .fillAndStroke(CANVAS, BORDER);
      doc
        .lineWidth(0.8)
        .strokeColor(BORDER)
        .rect(left, y, width, height)
        .stroke();
      doc.font("Helvetica-Bold").fontSize(TEXT).fillColor("#000000");
      doc.text(row.label, left + 10, y + 4, { width: labelWidth - 20 });
      let lineY = y + 4;
      row.lines.forEach((item, index) => {
        doc
          .font(item.bold ? "Helvetica-Bold" : "Helvetica")
          .fillColor("#000000");
        doc.text(item.text, left + labelWidth + 10, lineY, {
          width: valueWidth,
        });
        lineY += heights[index];
      });
      doc.y = y + height;
    }
  };

  // "Name: ______" lines under a bold title.
  const signatureBlock = (
    x: number,
    blockWidth: number,
    heading: string,
    labels: string[],
  ) => {
    let y = doc.y;
    doc.font("Helvetica-Bold").fontSize(TEXT).fillColor("#000000");
    doc.text(heading, x, y, { width: blockWidth });
    y += 18;
    for (const label of labels) {
      doc.font("Helvetica").fontSize(SMALL).fillColor(INK);
      doc.text(`${label}: `, x, y, { continued: true, lineBreak: false });
      const used = doc.widthOfString(`${label}: `);
      doc
        .moveTo(x + used, y + 9)
        .lineTo(x + blockWidth - 20, y + 9)
        .lineWidth(0.6)
        .strokeColor(INK)
        .stroke();
      y += 14;
    }
    return y;
  };
  const signatures = (
    leftHeading: string,
    leftLabels: string[],
    rightHeading: string,
    rightLabels: string[],
  ) => {
    ensure(18 + 14 * Math.max(leftLabels.length, rightLabels.length) + 10);
    const top = doc.y + 6;
    doc.y = top;
    const half = width / 2;
    const leftEnd = signatureBlock(left, half, leftHeading, leftLabels);
    doc.y = top;
    const rightEnd = signatureBlock(
      left + half,
      half,
      rightHeading,
      rightLabels,
    );
    doc.y = Math.max(leftEnd, rightEnd);
  };

  const lines = (value: string | undefined) =>
    (value ?? "")
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
  const present = (rows: Row[]) =>
    rows.filter((row) => row.lines.some((item) => item.text.trim() !== ""));
  const joined = (parts: (string | null | undefined)[], separator: string) =>
    parts.filter((part): part is string => Boolean(part)).join(separator);
  // The consignee's first line is its name.
  const consigneeLines = lines(fields.consignee).map((text, index) => ({
    text,
    bold: index === 0,
  }));
  const packagesText = withUnit(fields.packages, "packages");
  const weightText = fields.grossWeight
    ? withUnit(fields.grossWeight, "kg")
    : null;
  const volumeText = fields.volume ? withUnit(fields.volume, "CBM") : null;

  if (isOrder) {
    detail([
      ["Order reference:", document.documentNumber ?? "Not yet numbered"],
      ["Date:", fields.issueDate ?? ""],
    ]);
    if (fields.addressedTo) {
      doc.font("Helvetica-Bold").fontSize(TEXT).fillColor("#000000");
      doc.text("To: ", left, doc.y, { continued: true });
      doc.font("Helvetica").text(fields.addressedTo, { continued: false });
      doc.y += 6;
    }
    paragraph(
      "Please deliver the cargo described below to the named consignee or its duly authorized representative, subject to the release conditions stated in this order.",
      TEXT,
      "#000000",
    );

    heading("CONSIGNEE");
    doc.y += 2;
    for (const item of consigneeLines) {
      doc
        .font(item.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(TEXT)
        .fillColor("#000000");
      doc.text(item.text, left, doc.y + 1, { width });
    }

    heading("SHIPMENT PARTICULARS");
    doc.y += 4;
    const one = (label: string, value: string | null | undefined): Row => ({
      label,
      lines: [{ text: value ?? "" }],
    });
    table(
      present([
        one("Bill of lading number", fields.blNumber),
        one("Bill of lading date", fields.blDate),
        one("Shipper", fields.shipper),
        one("Vessel / voyage", fields.vesselVoyage),
        one(
          "Port of loading / discharge",
          joined([fields.portOfLoading, fields.portOfDischarge], " / "),
        ),
        one("Place of delivery", fields.placeOfDelivery),
        one("Container / size", fields.container),
        one("Seal number", fields.seals),
        one(
          "Packages / gross weight / volume",
          joined([packagesText, weightText, volumeText], " / "),
        ),
        one(
          "Marks / freight / service",
          joined(
            [fields.marks, fields.freightTerms, fields.serviceType],
            " / ",
          ),
        ),
        one("B/L release notation", fields.releaseNotation),
      ]),
    );

    if (fields.cargoDescription) {
      heading("CARGO DESCRIPTION");
      for (const text of lines(fields.cargoDescription)) {
        ensure(16);
        doc.font("Helvetica").fontSize(TEXT).fillColor("#000000");
        doc.text(text, left, doc.y + 2, { width });
      }
    }

    heading("RELEASE CONDITIONS");
    paragraph(RELEASE_CONDITIONS, SMALL, MUTED);
    doc.y += 8;
    signatures(
      `For ${issuerName}`,
      ["Name", "Signature / stamp", "Date"],
      "Received by consignee or representative",
      ["Name / ID", "Signature", "Date"],
    );
  } else {
    detail([["Reference:", document.documentNumber ?? "Not yet numbered"]]);

    heading("CONSIGNEE AND SHIPMENT");
    doc.y += 4;
    const route = joined(
      [fields.portOfLoading, fields.portOfDischarge],
      " to ",
    );
    table(
      present([
        { label: "Consignee", lines: consigneeLines },
        {
          label: "Bill of lading",
          lines: [
            {
              text: joined(
                [
                  fields.blNumber,
                  fields.blDate ? `Dated ${fields.blDate}` : null,
                ],
                " | ",
              ),
            },
          ],
        },
        {
          label: "Vessel and route",
          lines: [{ text: joined([fields.vesselVoyage, route], " | ") }],
        },
        {
          label: "Container and seal",
          lines: [
            {
              text: joined(
                [
                  fields.container,
                  fields.seals ? `Seal: ${fields.seals}` : null,
                ],
                " | ",
              ),
            },
          ],
        },
        {
          label: "Cargo description",
          lines: lines(fields.cargoDescription).map((text) => ({ text })),
        },
        {
          label: "B/L totals",
          lines: [
            {
              text: joined(
                [
                  packagesText,
                  weightText ? `Gross weight: ${weightText}` : null,
                  volumeText ? `Volume: ${volumeText}` : null,
                ],
                " | ",
              ),
            },
          ],
        },
      ]),
    );

    heading("DELIVERY RECORD");
    doc.y += 4;
    const checks = lines(fields.receiptItems)
      .map((item) => `${item}: Yes / No`)
      .join(" | ");
    table([
      {
        label: "Delivery date and time",
        lines: [{ text: `Date: ${blank(20)}  Time: ${blank(20)}` }],
      },
      {
        label: "Actual delivery address",
        lines: [{ text: blank(52) }, { text: blank(52) }],
      },
      {
        label: "Driver and vehicle",
        lines: [
          { text: `Driver: ${blank(20)}  Tel: ${blank(17)}` },
          { text: `Vehicle registration: ${blank(33)}` },
        ],
      },
      {
        label: "Quantity received",
        lines: [
          {
            text: `${blank(8)} packages received out of ${fields.packages ? number(fields.packages) : blank(8)} packages on B/L`,
          },
          ...(checks ? [{ text: checks }] : []),
        ],
      },
      {
        label: "Condition on receipt",
        lines: [
          {
            text: "[ ] No visible damage [ ] Damage noted [ ] Shortage noted",
          },
          { text: "Seal intact: Yes / No / Not applicable" },
        ],
      },
      {
        label: "Exceptions and remarks",
        lines: [{ text: blank(52) }, { text: blank(52) }, { text: blank(52) }],
      },
    ]);

    heading("ACKNOWLEDGEMENT OF RECEIPT");
    paragraph(ACKNOWLEDGEMENT, SMALL, "#000000");
    doc.y += 10;
    signatures(
      "Consignee or authorized receiver",
      ["Name", "Position", "Phone", "Signature / stamp", "Date and time"],
      "Delivered by",
      ["Name", "Signature", "Date and time"],
    );
    doc.y += 8;
    paragraph(POD_NOTE, SMALL, MUTED);
  }

  // Footer, DRAFT and VOID marks on every page.
  const draftReason =
    document.status === "draft" ? "Draft - not yet issued" : null;
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const { height, width: pageWidth } = doc.page;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(SMALL).fillColor(MUTED);
    doc.text(
      `${issuerName}  |  ${document.documentNumber ?? "Draft"}  |  Page ${index + 1} of ${range.count}`,
      left,
      height - PAGE_MARGIN + 6,
      { width, align: "center", lineBreak: false },
    );
    const mark =
      document.status === "void" ? "VOID" : draftReason ? "DRAFT" : null;
    if (mark) {
      doc.save();
      doc.fillColor(MARK_RED).opacity(0.1);
      doc.rotate(-35, { origin: [pageWidth / 2, height / 2] });
      doc.font("Helvetica-Bold").fontSize(110);
      doc.text(mark, 0, height / 2 - 60, {
        width: pageWidth,
        align: "center",
        lineBreak: false,
      });
      doc.restore();
      doc.opacity(1).font("Helvetica-Bold").fontSize(8).fillColor(MARK_RED);
      doc.text(
        (document.status === "void"
          ? `Void - ${document.voidReason ?? ""}`
          : (draftReason ?? "")
        ).toUpperCase(),
        left,
        24,
        { width, align: "right", lineBreak: false },
      );
    }
  }

  doc.end();
  return done;
}
