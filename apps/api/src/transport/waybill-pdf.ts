import PDFDocument from "pdfkit";
import { drawLogo } from "../assets/logo";
import type { BusinessSettings } from "@bjh/contracts";
import type {
  DeliveryRecord,
  JobPartyRecord,
  JobRecord,
  ShipmentReferenceRecord,
} from "../database/database.port";

// Same palette as the quote PDF and the document layout preview.
const PRIMARY = "#0b3fae";
const SECONDARY = "#5c9fd6";
const INK = "#17324d";
const MUTED = "#526b7d";
const BORDER = "#d7e3ed";
const CANVAS = "#f4f8fc";

const PAGE_MARGIN = 40;
const LOGO_HEIGHT = 36;

// Print type scale (pt): body text 11, small labels 9, footer 9.
const BODY = 11;
const LABEL = 9;
// Space kept above the bottom margin for the page footer.
const FOOTER_SPACE = 24;

const referenceLabels: Record<ShipmentReferenceRecord["kind"], string> = {
  master_bl: "Master B/L",
  house_bl: "House B/L",
  master_awb: "MAWB",
  house_awb: "HAWB",
  booking: "Booking",
  container: "Container",
};

export interface WaybillPdfInput {
  delivery: DeliveryRecord;
  job: JobRecord;
  parties: JobPartyRecord[];
  references: ShipmentReferenceRecord[];
  /** null until the business settings are configured (D03). */
  settings: BusinessSettings | null;
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })
    .format(new Date(iso))
    .concat(" UTC");
}

function partyText(parties: JobPartyRecord[], role: string): string {
  const party = parties.find((item) => item.role === role);
  if (!party) return "-";
  return party.details ? `${party.name}\n${party.details}` : party.name;
}

/**
 * Delivery waybill for a road trip, laid out from the client's air waybill
 * and proof-of-delivery samples: numbered header, party boxes, cargo row, and
 * the "goods received in apparently safe and sound condition by" block. The
 * receiver block is filled in once proof of delivery is recorded, otherwise
 * left blank to be signed on the day. No road waybill sample exists yet.
 * The receiver and signature blocks sit at the foot of the page and the cargo
 * box takes the space between, so the printed sheet is filled.
 */
export function renderWaybillPdf(
  input: WaybillPdfInput,
  options: { compress?: boolean } = {},
): Promise<Buffer> {
  const { delivery, job, parties, references, settings } = input;
  const issuerName = settings?.issuer.name ?? "Issuer details not configured";

  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    compress: options.compress ?? true,
    info: { Title: `Waybill ${delivery.waybillNumber}`, Author: issuerName },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = PAGE_MARGIN;
  const width = doc.page.width - PAGE_MARGIN * 2;
  const bottom = doc.page.height - PAGE_MARGIN - FOOTER_SPACE;

  // Brand block: issuer identity over a blue rule, waybill number on the right.
  const logoHeight = drawLogo(doc, left, PAGE_MARGIN, LOGO_HEIGHT);
  doc.font("Helvetica-Bold").fontSize(20).fillColor(PRIMARY);
  doc.text(issuerName, left, PAGE_MARGIN + (logoHeight ? logoHeight + 6 : 0), {
    width: width * 0.58,
  });
  doc.font("Helvetica").fontSize(10).fillColor(MUTED);
  const contact = [
    settings?.issuer.address,
    [settings?.issuer.phone, settings?.issuer.email, settings?.issuer.website]
      .filter(Boolean)
      .join("  |  "),
  ].filter(Boolean);
  for (const row of contact) {
    doc.text(String(row), left, doc.y + 2, { width: width * 0.58 });
  }
  const brandBottom = doc.y;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(PRIMARY);
  doc.text("DELIVERY WAYBILL", left + width * 0.58, PAGE_MARGIN, {
    width: width * 0.42,
    align: "right",
    characterSpacing: 1.5,
  });
  doc.font("Helvetica-Bold").fontSize(18).fillColor(INK);
  doc.text(delivery.waybillNumber, left + width * 0.58, PAGE_MARGIN + 17, {
    width: width * 0.42,
    align: "right",
  });
  doc.y = Math.max(brandBottom, PAGE_MARGIN + 42) + 10;
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .lineWidth(2.5)
    .strokeColor(PRIMARY)
    .stroke();
  doc.y += 16;

  // A labelled box; height is fixed by the caller so rows line up.
  const box = (
    label: string,
    value: string,
    x: number,
    y: number,
    w: number,
    h: number,
    bold = false,
  ) => {
    doc.lineWidth(0.8).strokeColor(BORDER).rect(x, y, w, h).stroke();
    doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
    doc.text(label.toUpperCase(), x + 10, y + 8, {
      width: w - 20,
      characterSpacing: 0.5,
    });
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(BODY);
    doc.fillColor(INK).text(value, x + 10, y + 22, {
      width: w - 20,
      height: h - 26,
      ellipsis: true,
      lineGap: 1,
    });
  };
  const row = (
    cells: Array<[string, string]>,
    height: number,
    bold = false,
  ) => {
    const y = doc.y;
    const w = width / cells.length;
    cells.forEach(([label, value], index) => {
      box(label, value, left + index * w, y, w, height, bold);
    });
    doc.y = y + height;
  };

  row(
    [
      ["Job file", job.fileNumber],
      ["Dispatched", formatDateTime(delivery.dispatchedAt)],
      ["Customer", job.customerCompanyName],
    ],
    58,
    true,
  );
  row(
    [
      ["Shipper", partyText(parties, "shipper")],
      ["Consignee", partyText(parties, "consignee")],
    ],
    82,
  );
  const referenceText = references
    .map((item) =>
      item.sealNumber
        ? `${referenceLabels[item.kind]}: ${item.value} (seal ${item.sealNumber})`
        : `${referenceLabels[item.kind]}: ${item.value}`,
    )
    .join("   |   ");
  row([["Shipment references", referenceText || "-"]], 46);
  row(
    [
      ["Driver", `${delivery.driverName}\n${delivery.driverPhone}`],
      ["Vehicle registration", delivery.vehicleRegistration],
    ],
    60,
    true,
  );
  row(
    [
      ["Collect from", delivery.pickupLocation ?? "-"],
      ["Deliver to", delivery.deliveryAddress],
    ],
    60,
  );

  // Receiver and signature blocks are pinned to the foot of the page.
  const fieldGap = 27;
  const receiverHeight = 24 + fieldGap * 5;
  const signatureHeight = 72;
  const footTop = bottom - signatureHeight - 26 - receiverHeight;

  // Cargo table, as in the air waybill: packages, weight, description. Its
  // box stretches down to the receiver block.
  doc.y += 16;
  const columns = [
    { title: "No. of packages", width: width * 0.18 },
    { title: "Gross weight (kg)", width: width * 0.2 },
    { title: "Description of goods", width: width * 0.62 },
  ];
  const headerY = doc.y;
  doc
    .lineWidth(0.8)
    .rect(left, headerY, width, 28)
    .fillAndStroke(CANVAS, BORDER);
  let x = left;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(PRIMARY);
  for (const column of columns) {
    doc.text(column.title, x + 8, headerY + 9, { width: column.width - 16 });
    x += column.width;
  }
  const cargo = [
    delivery.packages === null ? "-" : String(delivery.packages),
    delivery.grossWeightKg === null ? "-" : String(delivery.grossWeightKg),
    delivery.cargoDescription,
  ];
  doc.font("Helvetica").fontSize(BODY);
  const cargoTop = headerY + 28;
  const cargoHeight = Math.max(
    60,
    doc.heightOfString(cargo[2], { width: columns[2].width - 16 }) + 20,
    footTop - 22 - cargoTop,
  );
  x = left;
  cargo.forEach((text, index) => {
    doc.fillColor(INK).text(text, x + 8, cargoTop + 10, {
      width: columns[index].width - 16,
    });
    x += columns[index].width;
  });
  doc.lineWidth(0.8).strokeColor(BORDER);
  doc.rect(left, cargoTop, width, cargoHeight).stroke();
  x = left;
  for (const column of columns.slice(0, -1)) {
    x += column.width;
    doc
      .moveTo(x, headerY)
      .lineTo(x, cargoTop + cargoHeight)
      .stroke();
  }
  doc.y = Math.max(cargoTop + cargoHeight + 22, footTop);

  // Receiver block, worded as in the client's proof-of-delivery sample.
  doc.font("Helvetica-Bold").fontSize(BODY).fillColor(PRIMARY);
  doc.text(
    "GOODS RECEIVED IN APPARENTLY SAFE AND SOUND CONDITION BY:",
    left,
    doc.y,
    { width },
  );
  doc.y += 6;
  const delivered = delivery.status === "delivered";
  const fields: Array<[string, string | null]> = [
    ["Name", delivered ? delivery.receiverName : null],
    ["Telephone no.", delivered ? delivery.receiverPhone : null],
    [
      "Date and time",
      delivered && delivery.deliveredAt
        ? formatDateTime(delivery.deliveredAt)
        : null,
    ],
    ["Damage or shortage noted", delivered ? delivery.damageNotes : null],
    ["Signature", null],
  ];
  const valueX = left + 165;
  for (const [label, value] of fields) {
    const y = doc.y + fieldGap;
    doc.font("Helvetica").fontSize(BODY).fillColor(MUTED);
    doc.text(`${label}:`, left, y - 15, { width: 160, lineBreak: false });
    if (value) {
      doc.font("Helvetica-Bold").fillColor(INK);
      doc.text(value, valueX + 4, y - 15, {
        width: left + width - valueX - 4,
        lineBreak: false,
        ellipsis: true,
      });
    }
    doc
      .moveTo(valueX, y)
      .lineTo(left + width, y)
      .lineWidth(0.8)
      .strokeColor(SECONDARY)
      .stroke();
    doc.y = y;
  }

  // Issuer and driver signatures.
  const signatureTop = Math.max(doc.y + 26, bottom - signatureHeight);
  const half = width / 2 - 14;
  [
    [`For ${issuerName}`, left],
    ["Driver", left + width / 2 + 14],
  ].forEach(([title, sx]) => {
    doc.font("Helvetica-Bold").fontSize(BODY).fillColor(PRIMARY);
    doc.text(String(title), Number(sx), signatureTop, { width: half });
    const y = signatureTop + 52;
    doc
      .moveTo(Number(sx), y)
      .lineTo(Number(sx) + half, y)
      .lineWidth(0.8)
      .strokeColor(SECONDARY)
      .stroke();
    doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
    doc.text("Name and signature", Number(sx), y + 4, { width: half });
  });

  doc.page.margins.bottom = 0;
  doc.font("Helvetica").fontSize(LABEL).fillColor(MUTED);
  doc.text(
    `${issuerName}  |  Waybill ${delivery.waybillNumber}`,
    left,
    doc.page.height - PAGE_MARGIN + 6,
    { width, align: "center", lineBreak: false },
  );

  doc.end();
  return done;
}
