import assert from "node:assert/strict";
import { test } from "node:test";
import {
  customerInputSchema,
  chargeImportInputSchema,
  milestoneTemplates,
  serviceLineKeys,
  serviceLinesForRoles,
  parseContract,
  quoteRequestInputSchema,
  quoteVersionInputSchema,
  staffCreateInputSchema,
  staffRoleInputSchema,
} from "@bjh/contracts";

const message = (
  schema: Parameters<typeof parseContract>[0],
  input: unknown,
) => {
  const result = parseContract(schema, input);
  return result.success ? "ok" : result.message;
};

test("customer contract trims text and rejects invalid bodies with API wording", () => {
  const valid = parseContract(customerInputSchema, {
    companyName: "  Northstar Synthetic Ltd ",
    contactName: "Contact",
    email: "contact@example.test",
  });
  assert.deepEqual(valid, {
    success: true,
    data: {
      companyName: "Northstar Synthetic Ltd",
      tradingName: null,
      registrationNumber: null,
      taxNumber: null,
      companyPhone: null,
      companyEmail: null,
      website: null,
      businessAddress: null,
      billingAddress: null,
      country: null,
      contactName: "Contact",
      contactRole: null,
      email: "contact@example.test",
      phone: null,
    },
  });
  const withPhone = parseContract(customerInputSchema, {
    companyName: "Northstar Synthetic Ltd",
    contactName: "Contact",
    email: "contact@example.test",
    phone: " 024 405 8592 ",
  });
  assert.equal(withPhone.success && withPhone.data.phone, "024 405 8592");
  const withCompanyPhone = parseContract(customerInputSchema, {
    companyName: "Northstar Synthetic Ltd",
    contactName: "Contact",
    email: "contact@example.test",
    companyPhone: " +233 24 405 8592 ",
    tradingName: " Northstar ",
  });
  assert.equal(
    withCompanyPhone.success && withCompanyPhone.data.companyPhone,
    "+233 24 405 8592",
  );
  assert.equal(
    withCompanyPhone.success && withCompanyPhone.data.tradingName,
    "Northstar",
  );
  assert.equal(
    message(customerInputSchema, {
      companyName: "x",
      contactName: "y",
      email: "contact@example.test",
      phone: "call me",
    }),
    "phone must be a phone number such as 024 405 8592 or +233 24 405 8592",
  );
  assert.equal(
    message(customerInputSchema, null),
    "A customer object is required",
  );
  assert.equal(
    message(customerInputSchema, []),
    "A customer object is required",
  );
  assert.equal(
    message(customerInputSchema, { contactName: "c", email: "a@b.co" }),
    "companyName is required",
  );
  assert.equal(
    message(customerInputSchema, {
      companyName: "x".repeat(161),
      contactName: "c",
      email: "a@b.co",
    }),
    "companyName must contain 1 to 160 characters",
  );
  assert.equal(
    message(customerInputSchema, {
      companyName: "n",
      contactName: "c",
      email: "not-an-email",
    }),
    "email must be a valid email address",
  );
});

test("quote request contract enforces the message length", () => {
  const base = {
    companyName: "n",
    contactName: "c",
    email: "a@b.co",
  };
  assert.equal(
    message(quoteRequestInputSchema, { ...base, message: "hi" }),
    "ok",
  );
  assert.equal(
    message(quoteRequestInputSchema, { ...base, message: " " }),
    "message must contain 1 to 5000 characters",
  );
  assert.equal(
    message(quoteRequestInputSchema, "text"),
    "A quote request object is required",
  );
});

test("quote sizes are quote-specific labels with one matching amount per size", () => {
  const base = {
    currency: "GHS",
    title: "Synthetic quote",
    procedureSteps: [],
    requiredDocuments: [],
    terms: [],
    sizeLabels: ["20ft", "40ft", "50ft"],
    lines: [
      {
        description: "Container handling",
        basis: "per_container",
        sizeAmountsMinor: [100, 200, 300],
      },
    ],
  };
  assert.equal(message(quoteVersionInputSchema, base), "ok");
  assert.equal(
    message(quoteVersionInputSchema, {
      ...base,
      sizeLabels: ["50ft", "50FT"],
    }),
    "sizeLabels must not repeat",
  );
  assert.equal(
    message(quoteVersionInputSchema, {
      ...base,
      lines: [{ ...base.lines[0], sizeAmountsMinor: [100, 200] }],
    }),
    "Give one amount for each size column, or use one amount",
  );
  assert.equal(
    message(quoteVersionInputSchema, {
      ...base,
      lines: [{ ...base.lines[0], details: "x".repeat(501) }],
    }),
    "details must be at most 500 characters",
  );
});

test("quote charge import accepts a custom size and container count", () => {
  assert.deepEqual(
    parseContract(chargeImportInputSchema, {
      containerSize: "50ft",
      quantity: 3,
    }),
    { success: true, data: { containerSize: "50ft", quantity: 3 } },
  );
  assert.equal(
    message(chargeImportInputSchema, { containerSize: "50ft", quantity: 0 }),
    "quantity must be at least 1",
  );
});

test("staff contracts reject unsupported roles and tolerate missing strings", () => {
  assert.equal(
    message(staffRoleInputSchema, { roleKey: "boss" }),
    "roleKey is not a supported staff role",
  );
  assert.equal(
    message(staffRoleInputSchema, { roleKey: "sea_import_rep" }),
    "roleKey is not a supported staff role",
  );
  assert.equal(message(staffRoleInputSchema, { roleKey: "super_admin" }), "ok");
  assert.equal(message(staffRoleInputSchema, null), "A roleKey is required");
  const created = parseContract(staffCreateInputSchema, {
    email: 5,
    roleKey: "import_rep",
  });
  assert.deepEqual(created, {
    success: true,
    data: { email: "", password: "", roleKey: "import_rep" },
  });
  assert.equal(
    message(staffCreateInputSchema, undefined),
    "Email, password and roleKey are required",
  );
});

test("every freight service line has a milestone template with unique keys", () => {
  // Warehousing and road transport are tracked by stock movements and
  // deliveries instead, so their milestone list is deliberately empty.
  const freight = serviceLineKeys.filter(
    (line) => line !== "warehousing" && line !== "road_transport",
  );
  assert.deepEqual(milestoneTemplates.warehousing, []);
  assert.deepEqual(milestoneTemplates.road_transport, []);
  for (const line of freight) {
    const keys = milestoneTemplates[line].map((milestone) => milestone.key);
    assert.ok(keys.length > 0, `${line} has milestones`);
    assert.equal(new Set(keys).size, keys.length, `${line} keys are unique`);
  }
  const airImport = milestoneTemplates.air_import.map((item) => item.key);
  assert.equal(airImport.includes("eir_received"), false);
});

test("import and export reps cover sea and air; client-facing and finance roles see every line", () => {
  assert.deepEqual(serviceLinesForRoles(["import_rep"]), [
    "sea_import",
    "air_import",
    "warehousing",
    "road_transport",
  ]);
  assert.deepEqual(serviceLinesForRoles(["export_rep"]), [
    "sea_export",
    "air_export",
    "warehousing",
    "road_transport",
  ]);
  for (const role of [
    "customer_service_rep",
    "sales_rep",
    "finance_rep",
  ] as const) {
    assert.deepEqual(serviceLinesForRoles([role]), [...serviceLineKeys]);
  }
  // A not-yet-converted legacy role keeps exactly its old line.
  assert.deepEqual(serviceLinesForRoles(["air_import_rep"]), [
    "air_import",
    "warehousing",
    "road_transport",
  ]);
  assert.deepEqual(serviceLinesForRoles(["super_admin"]), []);
});
