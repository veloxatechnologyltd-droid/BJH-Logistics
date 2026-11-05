import assert from "node:assert/strict";
import test from "node:test";
import {
  formatBlContainers,
  parseBlContainers,
  sumBlContainerWeights,
} from "@bjh/contracts";

test("B/L containers keep number, seal and weight through a round trip", () => {
  const rows = [
    { number: "MSKU1234567", seal: "A100", weightKg: "12500" },
    { number: "TGHU7654321", seal: "", weightKg: "9800.5" },
    { number: "CAIU1111111", seal: "", weightKg: "" },
  ];
  const text = formatBlContainers(rows);
  assert.equal(
    text,
    "MSKU1234567 | Seal A100 | 12500 kg\nTGHU7654321 | 9800.5 kg\nCAIU1111111",
  );
  assert.deepEqual(parseBlContainers(text), rows);
});

test("rows without a container number are left out; older lines still load", () => {
  assert.equal(
    formatBlContainers([{ number: " ", seal: "x", weightKg: "1" }]),
    "",
  );
  assert.deepEqual(parseBlContainers("MSKU1234567, seal 998\nTGHU7654321"), [
    { number: "MSKU1234567", seal: "998", weightKg: "" },
    { number: "TGHU7654321", seal: "", weightKg: "" },
  ]);
});

test("container weights add up; unreadable or empty weights are skipped", () => {
  const row = (weightKg: string) => ({ number: "C", seal: "", weightKg });
  assert.equal(
    sumBlContainerWeights([row("12,500"), row("9800.5"), row(""), row("x")]),
    "22300.5",
  );
  assert.equal(sumBlContainerWeights([row(""), row("abc")]), null);
});
