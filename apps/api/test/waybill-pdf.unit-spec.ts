import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DeliveryRecord,
  JobPartyRecord,
  JobRecord,
  ShipmentReferenceRecord,
} from "../src/database/database.port";
import { renderWaybillPdf } from "../src/transport/waybill-pdf";

const delivery = (over: Partial<DeliveryRecord> = {}): DeliveryRecord => ({
  id: "delivery",
  jobId: "job",
  waybillNumber: "SYN/WB/2026/0007",
  driverId: "driver",
  vehicleId: "vehicle",
  driverName: "Kofi Synthetic",
  driverPhone: "000 111 2222",
  vehicleRegistration: "GX 0001-26",
  cargoDescription: "82 sacks of woven baskets",
  packages: 82,
  grossWeightKg: 5000.5,
  pickupLocation: "Synthetic terminal",
  deliveryAddress: "1 Test Road, Sample City",
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
  ...over,
});

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

const party = (role: JobPartyRecord["role"], name: string): JobPartyRecord => ({
  id: name,
  jobId: "job",
  role,
  name,
  details: `${name} street`,
  createdBy: "user",
  createdAt: "2026-09-20T09:00:00.000Z",
});

const reference = (
  kind: ShipmentReferenceRecord["kind"],
  value: string,
  sealNumber: string | null = null,
): ShipmentReferenceRecord => ({
  id: value,
  jobId: "job",
  kind,
  value,
  sealNumber,
  parentReferenceId: null,
  createdBy: "user",
  createdAt: "2026-09-20T09:00:00.000Z",
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

const render = (record: DeliveryRecord) =>
  renderWaybillPdf(
    {
      delivery: record,
      job,
      parties: [
        party("shipper", "Synthetic Shipper"),
        party("consignee", "Synthetic Consignee"),
      ],
      references: [
        reference("booking", "BK-001"),
        reference("container", "SYNU1234567", "SEAL9"),
      ],
      settings: null,
    },
    { compress: false },
  );

test("the waybill carries the frozen dispatch details and blank receiver lines", async () => {
  const file = await render(delivery());
  assert.equal(file.subarray(0, 5).toString("latin1"), "%PDF-");
  const text = pdfText(file);
  for (const expected of [
    "SYN/WB/2026/0007",
    "SYN/SI/2026/0001",
    "Harbor Demo Ltd",
    "Synthetic Shipper",
    "Synthetic Consignee",
    "Booking: BK-001",
    "Container: SYNU1234567 (seal SEAL9)",
    "Kofi Synthetic",
    "GX 0001-26",
    "82 sacks of woven baskets",
    "1 Test Road, Sample City",
    "GOODS RECEIVED IN APPARENTLY SAFE AND SOUND CONDITION BY:",
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
  assert.ok(!text.includes("Receiver Synthetic"));
});

test("a delivered waybill prints the recorded receiver", async () => {
  const text = pdfText(
    await render(
      delivery({
        status: "delivered",
        receiverName: "Receiver Synthetic",
        receiverPhone: "000 333 4444",
        deliveredAt: "2026-09-23T14:05:00.000Z",
        damageNotes: "One carton dented",
      }),
    ),
  );
  for (const expected of [
    "Receiver Synthetic",
    "000 333 4444",
    "23 September 2026",
    "One carton dented",
  ]) {
    assert.ok(text.includes(expected), `missing: ${expected}`);
  }
});

test("missing settings fall back to a visible placeholder, not a guess", async () => {
  const text = pdfText(await render(delivery()));
  assert.ok(text.includes("Issuer details not configured"));
});
