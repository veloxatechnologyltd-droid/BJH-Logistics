/**
 * Writes fictional shipping documents for demos and for trying AI reading, to
 * .local/demo-documents/ (gitignored), with expected.json listing the
 * references each one carries. Every company, ship and number is invented.
 *
 *   corepack pnpm --filter @bjh/api exec tsx scripts/make-demo-documents.ts
 *
 * The scanned copies need `pdftoppm` (poppler-utils).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import PDFDocument from "pdfkit";
import { isValidContainerNumber } from "../src/documents/document-extraction";

const OUT = resolve(process.cwd(), "../../.local/demo-documents");

function container(prefix10: string): string {
  for (let digit = 0; digit <= 9; digit += 1) {
    if (isValidContainerNumber(`${prefix10}${digit}`)) {
      return `${prefix10}${digit}`;
    }
  }
  throw new Error(`no check digit for ${prefix10}`);
}

/** An air waybill serial's last digit is the first seven digits modulo 7. */
function airWaybill(prefix: string, serial7: string): string {
  return `${prefix}-${serial7}${Number(serial7) % 7}`;
}

const masterBl = "OSLU2610451";
const containers = [
  { number: container("SYNU482913"), seal: "OSL-993104" },
  { number: container("SYNU507226"), seal: "OSL-993105" },
];
const houseBl = "BJH-HBL-2610-07";
const mawb = airWaybill("910", "3141592");
const hawb = "BJH-AE-2610-011";

type Row = [label: string, value: string];

function pdf(
  title: string,
  issuer: string,
  rows: Row[],
  table: { head: string[]; body: string[][] },
  footer: string,
): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((done) =>
    doc.on("end", () => done(Buffer.concat(chunks))),
  );
  doc
    .fontSize(9)
    .fillColor("#888")
    .text("SYNTHETIC SAMPLE · NOT A REAL DOCUMENT");
  doc.moveDown(0.5).fillColor("#000").fontSize(16).text(issuer);
  doc.fontSize(12).text(title);
  doc.moveDown();
  const left = 40;
  for (const [label, value] of rows) {
    const y = doc.y;
    doc.fontSize(8).fillColor("#555").text(label.toUpperCase(), left, y, {
      width: 150,
    });
    doc
      .fontSize(10)
      .fillColor("#000")
      .text(value, left + 160, y, {
        width: 355,
      });
    doc.moveDown(0.4);
  }
  doc.moveDown();
  const widths = table.head.map(() => 515 / table.head.length);
  const line = (cells: string[], bold: boolean) => {
    const y = doc.y;
    cells.forEach((cell, index) => {
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(9)
        .text(
          cell,
          left + widths.slice(0, index).reduce((a, b) => a + b, 0),
          y,
          {
            width: widths[index] - 6,
          },
        );
    });
    doc.moveDown(0.6);
  };
  line(table.head, true);
  for (const cells of table.body) line(cells, false);
  doc.font("Helvetica").moveDown(2).fontSize(8).text(footer, left);
  doc.end();
  return done;
}

/** A greyscale raster of the first page: an image with no text in it, like a scan or a photo. */
function rasterise(pdfPath: string, base: string, dpi: number): string {
  execFileSync("pdftoppm", [
    "-jpeg",
    "-gray",
    "-r",
    String(dpi),
    "-jpegopt",
    "quality=70",
    "-singlefile",
    pdfPath,
    base,
  ]);
  return `${base}.jpg`;
}

/** A PDF holding only the image, as a scanner produces. */
function imageOnlyPdf(jpegPath: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", margin: 0 });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((done) =>
    doc.on("end", () => done(Buffer.concat(chunks))),
  );
  doc.image(readFileSync(jpegPath), 0, 0, { width: 595.28 });
  doc.end();
  return done;
}

async function main() {
  mkdirSync(OUT, { recursive: true });

  const carrier = await pdf(
    "BILL OF LADING FOR OCEAN TRANSPORT",
    "OCEANIC SYNTHETIC LINES",
    [
      ["B/L No.", masterBl],
      ["Booking No.", "BKG-778120"],
      [
        "Shipper",
        "Ningbo Synthetic Textiles Co., Ltd, 18 Harbour Road, Ningbo",
      ],
      ["Consignee", "BJH Logistics (as agent), Community 1, Tema"],
      ["Notify party", "Northstar Synthetic Trading Ltd, Spintex Road, Accra"],
      ["Vessel / Voyage", "MV SYNTHETIC STAR / 042W"],
      ["Port of loading", "Ningbo, China"],
      ["Port of discharge", "Tema, Ghana"],
      ["Date of issue", "6 October 2026"],
    ],
    {
      head: ["Container No.", "Seal No.", "Type", "Packages", "Gross weight"],
      body: containers.map(({ number, seal }) => [
        number,
        seal,
        "40' HC",
        "620 cartons",
        "11,240 kg",
      ]),
    },
    "Description of goods: woven cotton fabric rolls. Freight prepaid. Three originals issued.",
  );
  writeFileSync(join(OUT, "sea-bl-carrier.pdf"), carrier);

  const house = await pdf(
    "HOUSE BILL OF LADING",
    "BJH LOGISTICS (SYNTHETIC SAMPLE)",
    [
      ["HBL No.", houseBl],
      ["MBL No.", masterBl],
      ["Shipper", "Ningbo Synthetic Textiles Co., Ltd"],
      ["Consignee", "Northstar Synthetic Trading Ltd, Accra"],
      ["Vessel / Voyage", "MV SYNTHETIC STAR / 042W"],
      ["Port of discharge", "Tema, Ghana"],
    ],
    {
      head: ["Container No.", "Seal No.", "Packages"],
      body: [[containers[0].number, containers[0].seal, "620 cartons"]],
    },
    "Issued as house bill under the master bill above.",
  );
  writeFileSync(join(OUT, "sea-hbl-house.pdf"), house);

  const air = await pdf(
    "HOUSE AIR WAYBILL",
    "BJH LOGISTICS (SYNTHETIC SAMPLE)",
    [
      ["HAWB No.", hawb],
      ["MAWB No.", mawb],
      ["Shipper", "Kumasi Synthetic Agro Exports Ltd, Kumasi"],
      ["Consignee", "Rotterdam Synthetic Foods BV, Rotterdam"],
      ["Airport of departure", "Accra (ACC)"],
      ["Airport of destination", "Amsterdam (AMS)"],
      ["Flight / Date", "XY 812 / 14 October 2026"],
    ],
    {
      head: ["Pieces", "Gross weight", "Chargeable", "Nature of goods"],
      body: [["24", "486 kg", "512 kg", "Dried cocoa products"]],
    },
    "Not negotiable.",
  );
  writeFileSync(join(OUT, "air-hawb.pdf"), air);

  const notice = await pdf(
    "ARRIVAL NOTICE",
    "OCEANIC SYNTHETIC LINES · TEMA AGENCY",
    [
      ["B/L No.", masterBl],
      ["Vessel / Voyage", "MV SYNTHETIC STAR / 042W"],
      ["Port of discharge", "Tema, Ghana"],
      ["Estimated time of arrival", "2 November 2026, 14:30"],
      ["Consignee", "BJH Logistics (as agent), Community 1, Tema"],
      ["Sailed from Ningbo", "8 October 2026"],
    ],
    {
      head: ["Container No.", "Seal No.", "Type"],
      body: containers.map(({ number, seal }) => [number, seal, "40' HC"]),
    },
    "Please present the original bill of lading and settle local charges before release.",
  );
  writeFileSync(join(OUT, "sea-arrival-notice.pdf"), notice);

  // Sent with the demo emails (scripts/demo-emails.ts), not scored by the readers.
  const packing = await pdf(
    "PACKING LIST",
    "NINGBO SYNTHETIC TEXTILES CO., LTD",
    [
      ["Invoice No.", "NST-2610-118"],
      ["Buyer", "Akwaaba Synthetic Garments Ltd, Kaneshie, Accra"],
      ["Port of loading", "Ningbo, China"],
      ["Port of discharge", "Tema, Ghana"],
      ["Terms", "FOB Ningbo"],
    ],
    {
      head: ["Goods", "Packages", "Gross weight", "Volume"],
      body: [
        ["Woven cotton fabric rolls", "1,240 cartons", "22,480 kg", "136 CBM"],
        ["Total: 2 x 40' HC", "1,240 cartons", "22,480 kg", "136 CBM"],
      ],
    },
    "Shipper's load and count.",
  );
  writeFileSync(join(OUT, "packing-list.pdf"), packing);

  // The carrier B/L as a scanner and as a phone would give it: no text layer.
  const carrierPath = join(OUT, "sea-bl-carrier.pdf");
  const scanImage = rasterise(carrierPath, join(OUT, "scan-page"), 150);
  writeFileSync(join(OUT, "sea-bl-scanned.pdf"), await imageOnlyPdf(scanImage));
  rasterise(carrierPath, join(OUT, "sea-bl-photo"), 110);

  // Party names are matched by "contains", so the AI may keep or split the address.
  const containerRefs = containers.map(({ number, seal }) => ({
    key: "container",
    value: number,
    seal,
  }));
  const carrierRefs = [
    { key: "master_bl", value: masterBl },
    { key: "booking", value: "BKG-778120" },
    ...containerRefs,
    { key: "shipper", value: "Ningbo Synthetic Textiles" },
    { key: "consignee", value: "BJH Logistics" },
    { key: "notify_party", value: "Northstar Synthetic Trading" },
  ];
  writeFileSync(
    join(OUT, "expected.json"),
    `${JSON.stringify(
      {
        "sea-bl-carrier.pdf": carrierRefs,
        "sea-bl-scanned.pdf": carrierRefs,
        "sea-bl-photo.jpg": carrierRefs,
        "sea-hbl-house.pdf": [
          { key: "house_bl", value: houseBl },
          { key: "master_bl", value: masterBl },
          {
            key: "container",
            value: containers[0].number,
            seal: containers[0].seal,
          },
          { key: "shipper", value: "Ningbo Synthetic Textiles" },
          { key: "consignee", value: "Northstar Synthetic Trading" },
        ],
        "air-hawb.pdf": [
          { key: "house_awb", value: hawb },
          { key: "master_awb", value: mawb },
          { key: "shipper", value: "Kumasi Synthetic Agro Exports" },
          { key: "consignee", value: "Rotterdam Synthetic Foods" },
        ],
        "sea-arrival-notice.pdf": [
          { key: "master_bl", value: masterBl },
          ...containerRefs,
          { key: "consignee", value: "BJH Logistics" },
          // Ghana time is GMT; the sailing date must not be taken as the ETA.
          { key: "eta", value: "2026-11-02T14:30:00.000Z" },
        ],
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Wrote synthetic documents to ${OUT}`);
}

void main();
