import assert from "node:assert/strict";
import test from "node:test";
import {
  parseBlContainers,
  parseDocumentTableRows,
  sumTableColumn,
  transportDocumentFields,
} from "@bjh/contracts";
import { packagesInWords } from "../src/transport/packages-in-words";

const containersField = transportDocumentFields.house_bl.find(
  (field) => field.key === "containers",
)!;

test("older B/L container lines still load", () => {
  assert.deepEqual(parseBlContainers("MSKU1234567, seal 998\nTGHU7654321"), [
    { number: "MSKU1234567", seal: "998", weightKg: "" },
    { number: "TGHU7654321", seal: "", weightKg: "" },
  ]);
  assert.deepEqual(parseBlContainers("MSKU1234567 | Seal A100 | 12500 kg"), [
    { number: "MSKU1234567", seal: "A100", weightKg: "12500" },
  ]);
});

test("a B/L saved with container text opens as rows, the weight in gross weight", () => {
  const rows = parseDocumentTableRows(
    "house_bl",
    containersField,
    "MSKU1234567 | Seal A100 | 12500 kg\nTGHU7654321",
  );
  assert.deepEqual(rows, [
    {
      number: "MSKU1234567",
      seal: "A100",
      goods: "",
      packages: "",
      grossWeight: "12500",
      volume: "",
    },
    {
      number: "TGHU7654321",
      seal: "",
      goods: "",
      packages: "",
      grossWeight: "",
      volume: "",
    },
  ]);
});

test("each container carries its own goods, packages, weight and volume", () => {
  const rows = parseDocumentTableRows(
    "house_bl",
    containersField,
    JSON.stringify([
      {
        number: "C1",
        seal: "1",
        goods: "Clothing",
        packages: "2",
        grossWeight: "1,000",
        volume: "1",
      },
      {
        number: "C2",
        seal: "2",
        goods: "Seasoning",
        packages: "3",
        grossWeight: "1,500.5",
        volume: "2.5",
      },
    ]),
  );
  assert.equal(rows[1].goods, "Seasoning");
  assert.equal(sumTableColumn(rows, "packages"), "5");
  assert.equal(sumTableColumn(rows, "grossWeight"), "2500.5");
  assert.equal(sumTableColumn(rows, "volume"), "3.5");
});

test("package counts are written in words", () => {
  assert.equal(packagesInWords(10), "TEN (10) PACKAGES");
  assert.equal(packagesInWords(1), "ONE (1) PACKAGE");
  assert.equal(packagesInWords(21), "TWENTY-ONE (21) PACKAGES");
  assert.equal(
    packagesInWords(256),
    "TWO HUNDRED AND FIFTY-SIX (256) PACKAGES",
  );
  assert.equal(packagesInWords(1005), "ONE THOUSAND AND FIVE (1,005) PACKAGES");
  assert.equal(packagesInWords(0), null);
  assert.equal(packagesInWords(2.5), null);
});
