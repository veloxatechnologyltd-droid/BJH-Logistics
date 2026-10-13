import assert from "node:assert/strict";
import { test } from "node:test";
import { containerWithCheckDigit, pdfWithText } from "./pdf-helpers";
import {
  extractFields,
  isValidContainerNumber,
  readPdfText,
} from "../src/documents/document-extraction";

test("container check digits follow ISO 6346", () => {
  assert.equal(isValidContainerNumber("CSQU3054383"), true);
  assert.equal(isValidContainerNumber("CSQU3054384"), false);
  assert.equal(
    isValidContainerNumber("CSQX3054383"),
    false,
    "fourth letter must be U, J or Z",
  );
  assert.equal(isValidContainerNumber("CSQU305438"), false);
  assert.equal(isValidContainerNumber("csqu3054383"), false);
});

test("a bill of lading's references, containers and seals are proposed", () => {
  const container = containerWithCheckDigit("SYNU123456");
  const fields = extractFields(
    `BILL OF LADING  MBL BK NO.: SYNBK00042  HBL NO.: SYN-SYNBK00042A
     Booking Number: BK-778899
     ${container.slice(0, 4)} ${container.slice(4, 10)} ${container.slice(10)}
     SEAL NO: SL-5501
     Freight collect`,
  );
  assert.deepEqual(
    fields.map((field) => [field.key, field.value, field.sealNumber]).sort(),
    [
      ["booking", "BK-778899", null],
      ["container", container, "SL-5501"],
      ["house_bl", "SYN-SYNBK00042A", null],
      ["master_bl", "SYNBK00042", null],
    ],
  );
  const master = fields.find((field) => field.key === "master_bl");
  assert.match(master!.evidence, /MBL BK NO\.: SYNBK00042/);
});

test("a carrier's 'B/L No.' or 'Bill of Lading No.' is read as the master B/L", () => {
  const fields = extractFields(
    `BILL OF LADING ORIGINAL
     B/L No: MEDUSY0000642
     House B/L No.: SYNHB-0042
     Bill of Lading Number: MEDUSY0000642`,
  );
  assert.deepEqual(
    fields.map((field) => [field.key, field.value]),
    [["master_bl", "MEDUSY0000642"]],
  );
  assert.deepEqual(
    extractFields("Bill of Lading # SYNBL-77001").map((field) => field.value),
    ["SYNBL-77001"],
  );
});

test("an air waybill's master and house numbers are proposed", () => {
  const fields = extractFields(
    "MAWB NUMBER.: 999-12345678 HAWB NUMBER: SYN-2026A1 SHIPPER: SYNTHETIC EXPORTS LTD",
  );
  assert.deepEqual(fields.map((field) => [field.key, field.value]).sort(), [
    ["house_awb", "SYN-2026A1"],
    ["master_awb", "999-12345678"],
  ]);
});

test("look-alikes are not proposed and repeats are merged", () => {
  const container = containerWithCheckDigit("SYNU654321");
  const fields = extractFields(
    `${container} ${container} ABCU1234567 SYNU0000000 HBL and MBL are the two kinds of bill; BOOKING is discussed`,
  );
  assert.deepEqual(
    fields.map((field) => [field.key, field.value]),
    [["container", container]],
  );
  assert.deepEqual(extractFields(""), []);
});

test("the text of a PDF is read, and a PDF with no text yields nothing", async () => {
  const container = containerWithCheckDigit("SYNU111111");
  const text = await readPdfText(
    await pdfWithText([
      "HBL NO.: SYN-HBL-0001",
      `Container ${container}`,
      "SEAL NO: S900",
    ]),
  );
  const fields = extractFields(text);
  assert.deepEqual(
    fields.map((field) => [field.key, field.value, field.sealNumber]).sort(),
    [
      ["container", container, "S900"],
      ["house_bl", "SYN-HBL-0001", null],
    ],
  );
  assert.equal(
    (await readPdfText(await pdfWithText([]))).replace(/\s+/g, ""),
    "",
  );
  await assert.rejects(readPdfText(Buffer.from("not a pdf at all")));
});
