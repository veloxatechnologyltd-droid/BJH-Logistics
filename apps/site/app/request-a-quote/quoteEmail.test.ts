import assert from "node:assert/strict";
import { test } from "node:test";
import {
  quoteMailto,
  quoteSubject,
  quoteText,
  type QuoteDetails,
} from "./quoteEmail.ts";

const details: QuoteDetails = {
  name: "Ama Mensah",
  company: "Example Traders",
  email: "ama@example.com",
  phone: "",
  service: "Sea freight",
  origin: "Shanghai",
  destination: "Tema",
  cargo: "Machine parts & spares",
  weight: "1 x 40ft",
  readyDate: "",
  notes: "  ",
};

test("lists only filled fields, in form order", () => {
  assert.equal(
    quoteText(details),
    [
      "Name: Ama Mensah",
      "Company: Example Traders",
      "Email: ama@example.com",
      "Service: Sea freight",
      "Origin: Shanghai",
      "Destination: Tema",
      "Cargo: Machine parts & spares",
      "Dimensions / weight / container: 1 x 40ft",
    ].join("\n"),
  );
});

test("subject names the service and route", () => {
  assert.equal(
    quoteSubject(details),
    "Quote request - Sea freight - Shanghai to Tema",
  );
  assert.equal(
    quoteSubject({ ...details, service: "", origin: "", destination: "" }),
    "Quote request",
  );
});

test("mailto link targets the quotes mailbox and encodes the text", () => {
  const link = quoteMailto("quotes@bjhlogistics.com", details);
  assert.ok(link.startsWith("mailto:quotes@bjhlogistics.com?subject="));
  const body = decodeURIComponent(new URL(link).searchParams.get("body") ?? "");
  assert.ok(body.includes("Cargo: Machine parts & spares"));
  assert.ok(!link.includes("&body=Hello BJH"), "body must be URL-encoded");
});
