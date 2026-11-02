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
// A person: the form was open for a while and the hidden field is empty.
const request = (body: object) =>
  new Request("http://localhost/api/quote-request", {
    method: "POST",
    body: JSON.stringify({ trap: "", elapsedMs: 45_000, ...body }),
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

test("bot-like requests get a normal answer but never reach intake", async () => {
  process.env.SITE_API_BASE_URL = "https://api.example.test/api";
  process.env.INBOUND_EMAIL_SECRET = "synthetic-secret";
  const originalFetch = globalThis.fetch;
  let forwarded = 0;
  globalThis.fetch = async () => {
    forwarded += 1;
    return Response.json({ requestId: "synthetic-id" });
  };
  const raw = (body: object) =>
    new Request("http://localhost/api/quote-request", {
      method: "POST",
      body: JSON.stringify(body),
    });
  try {
    for (const body of [
      { ...details, trap: "http://spam.example", elapsedMs: 45_000 },
      { ...details, trap: "", elapsedMs: 800 },
      { ...details, trap: "" },
      { ...details, trap: "", elapsedMs: "45000" },
    ]) {
      const response = await POST(raw(body));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { received: true });
    }
    assert.equal(forwarded, 0);
    assert.equal((await POST(request(details))).status, 200);
    assert.equal(forwarded, 1);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.SITE_API_BASE_URL;
    delete process.env.INBOUND_EMAIL_SECRET;
  }
});
