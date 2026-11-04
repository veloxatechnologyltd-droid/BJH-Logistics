import assert from "node:assert/strict";
import { test } from "node:test";
import { staffDisplayName } from "../src/auth/staff-admin.port";

test("a stored name wins over the email", () => {
  assert.equal(
    staffDisplayName({ name: " Ama Mensah ", email: "ama@bjh.test" }),
    "Ama Mensah",
  );
});

test("without a name the email's first part is tidied, never shown whole", () => {
  assert.equal(
    staffDisplayName({ name: null, email: "john.evans@bjh.test" }),
    "John Evans",
  );
  assert.equal(
    staffDisplayName({ email: "air-import_rep2@bjh.test" }),
    "Air Import Rep",
  );
  assert.equal(staffDisplayName({ email: "HENRY@bjh.test" }), "Henry");
});

test("nothing usable falls back to a plain label", () => {
  assert.equal(staffDisplayName(null), "Staff member");
  assert.equal(staffDisplayName({ email: null }), "Staff member");
  assert.equal(staffDisplayName({ email: "1234@bjh.test" }), "Staff member");
});
