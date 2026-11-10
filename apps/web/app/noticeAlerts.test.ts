import assert from "node:assert/strict";
import { test } from "node:test";
import { linkFor, pickPopup } from "./noticeAlerts.ts";
import type { StaffNotice } from "./quotations/quoteRequestApi.ts";

const notice = (
  id: string,
  kind: StaffNotice["kind"],
  more: Partial<StaffNotice> = {},
): StaffNotice => ({
  id,
  kind,
  quoteRequestId: null,
  vehicleId: null,
  jobId: null,
  title: id,
  note: null,
  dueAt: "2026-11-10T10:00:00Z",
  ...more,
});

test("an unchecked ETA notice pops up first and keeps coming back", () => {
  const due = [
    notice("r1", "reminder"),
    notice("e1", "eta_due", { jobId: "j1" }),
  ];
  const shown = new Set(["e1"]);
  assert.equal(pickPopup(due, shown)?.id, "e1");
  assert.equal(pickPopup(due, new Set())?.id, "e1");
});

test("a reminder pops up once per visit, and other notices never pop up", () => {
  const due = [notice("r1", "reminder"), notice("v1", "vehicle_due")];
  assert.equal(pickPopup(due, new Set())?.id, "r1");
  assert.equal(pickPopup(due, new Set(["r1"])), null);
  assert.equal(pickPopup([], new Set()), null);
});

test("an ETA notice links to its job", () => {
  assert.equal(linkFor(notice("e1", "eta_due", { jobId: "j1" })), "/jobs/j1");
  assert.equal(linkFor(notice("v1", "vehicle_due")), "/transport");
  assert.equal(
    linkFor(notice("q1", "reminder", { quoteRequestId: "q" })),
    "/quotations/requests/q",
  );
});
