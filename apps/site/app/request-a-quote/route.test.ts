import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../api/quote-request/route.ts";

const details = {
  name: "Ama Mensah",
  company: "Example Traders",
  email: "ama@example.test",
  phone: "",
  service: "Sea freight",
  origin: "Shanghai",
  destination: "Tema",
  cargo: "Machine parts",
  weight: "1 x 40ft",
  readyDate: "",
  notes: "",
};
const request = (body: unknown) =>
  new Request("http://localhost/api/quote-request", {
    method: "POST",
    body: JSON.stringify(body),
  });

test("website quote request reaches intake with its server-only secret", async () => {
  process.env.SITE_API_BASE_URL = "https://api.example.test/api";
  process.env.INBOUND_EMAIL_SECRET = "synthetic-secret";
  const originalFetch = globalThis.fetch;
  let forwarded = false;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.example.test/api/v1/inbound-email");
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer synthetic-secret",
    );
    const fields = init?.body as FormData;
    assert.equal(fields.get("from_email"), details.email);
    assert.equal(fields.get("to"), "quotes@bjhlogistics.com");
    assert.equal(fields.get("source"), "website");
    assert.match(String(fields.get("text")), /Cargo: Machine parts/);
    forwarded = true;
    return Response.json({ requestId: "synthetic-id" });
  };
  try {
    const response = await POST(request(details));
    assert.equal(response.status, 200);
    assert.equal(forwarded, true);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SITE_API_BASE_URL;
    delete process.env.INBOUND_EMAIL_SECRET;
  }
});

test("invalid requests and intake failure never show a success receipt", async () => {
  process.env.SITE_API_BASE_URL = "https://api.example.test/api";
  process.env.INBOUND_EMAIL_SECRET = "synthetic-secret";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 503 });
  try {
    assert.equal(
      (await POST(request({ ...details, email: "wrong" }))).status,
      400,
    );
    assert.equal((await POST(request(details))).status, 502);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SITE_API_BASE_URL;
    delete process.env.INBOUND_EMAIL_SECRET;
  }
  assert.equal((await POST(request(details))).status, 503);
});
