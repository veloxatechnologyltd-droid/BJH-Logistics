import assert from "node:assert/strict";
import { test } from "node:test";
import { canWorkFinance } from "./roleAccess.ts";

test("finance screens are for the super admin, finance and customer service", () => {
  for (const role of ["super_admin", "finance_rep", "customer_service_rep"]) {
    assert.equal(canWorkFinance([role]), true, role);
  }
  for (const role of ["sales_rep", "import_rep", "export_rep"]) {
    assert.equal(canWorkFinance([role]), false, role);
  }
  assert.equal(canWorkFinance([]), false);
});

test("the legacy air and sea roles no longer count as finance, as in the API", () => {
  for (const role of [
    "air_import_rep",
    "air_export_rep",
    "sea_import_rep",
    "sea_export_rep",
  ]) {
    assert.equal(canWorkFinance([role]), false, role);
  }
  // A legacy role does not take away what another role gives.
  assert.equal(canWorkFinance(["sea_import_rep", "finance_rep"]), true);
});
