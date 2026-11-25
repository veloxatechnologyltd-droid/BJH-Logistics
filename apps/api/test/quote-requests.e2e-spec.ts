import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { INestApplication } from "@nestjs/common";
import { createTestApplication, staffFetch } from "./test-application";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let baseUrl: string;
let application: INestApplication;

async function startApplication(): Promise<void> {
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
}

before(async () => {
  await beginTestDatabase();
  await startApplication();
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("a quote request is saved and returned by list and detail endpoints", async () => {
  const response = await staffFetch(`${baseUrl}/api/v1/quote-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      companyName: "  Example Demo Ltd  ",
      contactName: "  Alex Demo  ",
      email: "alex@example.test",
      message: "  Please contact me about a fictional shipment.  ",
    }),
  });

  assert.equal(response.status, 201, await response.clone().text());
  const created = (await response.json()) as {
    id: string;
    companyName: string;
    contactName: string;
    email: string;
    message: string;
    createdAt: string;
  };
  assert.match(created.id, /^[0-9a-f-]{36}$/i);
  assert.equal(created.companyName, "Example Demo Ltd");
  assert.equal(created.contactName, "Alex Demo");
  assert.equal(created.email, "alex@example.test");
  assert.equal(
    created.message,
    "Please contact me about a fictional shipment.",
  );
  assert.ok(Number.isFinite(Date.parse(created.createdAt)));

  const listResponse = await staffFetch(`${baseUrl}/api/v1/quote-requests`);
  assert.equal(listResponse.status, 200);
  assert.deepEqual(await listResponse.json(), [created]);

  const detailResponse = await staffFetch(
    `${baseUrl}/api/v1/quote-requests/${created.id}`,
  );
  assert.equal(detailResponse.status, 200);
  assert.deepEqual(await detailResponse.json(), created);
});

test("invalid quote requests are rejected", async () => {
  const invalidRequests = [
    {},
    {
      companyName: "Example Ltd",
      contactName: "Alex Demo",
      email: "not-an-email",
      message: "A request",
    },
    {
      companyName: "Example Ltd",
      contactName: "Alex Demo",
      email: "alex@example.test",
      message: " ",
    },
    {
      companyName: "Example Ltd",
      contactName: "Alex Demo",
      email: "alex@example.test",
      message: "x".repeat(5001),
    },
  ];

  for (const [index, request] of invalidRequests.entries()) {
    const response = await staffFetch(`${baseUrl}/api/v1/quote-requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    assert.equal(
      response.status,
      400,
      `case ${index}: ${await response.clone().text()}`,
    );
  }
});

test("quote requests persist when the local API restarts", async () => {
  const response = await staffFetch(`${baseUrl}/api/v1/quote-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      companyName: "Restart Demo Ltd",
      contactName: "Taylor Demo",
      email: "taylor@example.test",
      message: "Persistence check",
    }),
  });
  const created = (await response.json()) as { id: string };

  await application.close();
  await startApplication();

  const readResponse = await staffFetch(
    `${baseUrl}/api/v1/quote-requests/${created.id}`,
  );
  assert.equal(readResponse.status, 200);
  assert.equal((await readResponse.json()).id, created.id);
});

test("unknown quote request IDs return not found", async () => {
  const response = await staffFetch(
    `${baseUrl}/api/v1/quote-requests/unknown-request`,
  );

  assert.equal(response.status, 404);
});

test("staff can explicitly link requests to customers and view request history", async () => {
  const customerResponse = await staffFetch(`${baseUrl}/api/v1/customers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      companyName: "Linked Demo Ltd",
      contactName: "Morgan Demo",
      email: "morgan@example.test",
    }),
  });
  const customer = (await customerResponse.json()) as { id: string };

  const requestResponse = await staffFetch(`${baseUrl}/api/v1/quote-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      companyName: "Linked Demo Ltd",
      contactName: "Morgan Demo",
      email: "morgan@example.test",
      message: "Synthetic linked request",
    }),
  });
  const request = (await requestResponse.json()) as { id: string };

  const linkResponse = await staffFetch(
    `${baseUrl}/api/v1/quote-requests/${request.id}/customer`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerCompanyId: customer.id }),
    },
  );
  assert.equal(linkResponse.status, 200);
  const linked = (await linkResponse.json()) as {
    customerCompanyId: string | null;
    customerCompanyName: string | null;
  };
  assert.equal(linked.customerCompanyId, customer.id);
  assert.equal(linked.customerCompanyName, "Linked Demo Ltd");

  await application.close();
  await startApplication();

  const persistedResponse = await staffFetch(
    `${baseUrl}/api/v1/quote-requests/${request.id}`,
  );
  const persisted = (await persistedResponse.json()) as {
    customerCompanyId: string | null;
  };
  assert.equal(persisted.customerCompanyId, customer.id);

  const historyResponse = await staffFetch(
    `${baseUrl}/api/v1/quote-requests?customerCompanyId=${customer.id}`,
  );
  assert.equal(historyResponse.status, 200);
  assert.deepEqual(
    (await historyResponse.json()).map((entry: { id: string }) => entry.id),
    [request.id],
  );
});

test("request association rejects unknown customer companies", async () => {
  const requestResponse = await staffFetch(`${baseUrl}/api/v1/quote-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      companyName: "Unlinked Demo Ltd",
      contactName: "Jordan Demo",
      email: "jordan@example.test",
      message: "Synthetic request",
    }),
  });
  const request = (await requestResponse.json()) as { id: string };

  const linkResponse = await staffFetch(
    `${baseUrl}/api/v1/quote-requests/${request.id}/customer`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerCompanyId: "missing-company" }),
    },
  );

  assert.equal(linkResponse.status, 404);
});

test("the old free-text quote draft endpoints no longer exist", async () => {
  const requestResponse = await staffFetch(`${baseUrl}/api/v1/quote-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      companyName: "Retired Draft Demo Ltd",
      contactName: "Casey Demo",
      email: "casey@example.test",
      message: "Synthetic request",
    }),
  });
  const request = (await requestResponse.json()) as { id: string };

  const url = `${baseUrl}/api/v1/quote-requests/${request.id}/draft`;
  assert.equal((await staffFetch(url)).status, 404);
  assert.equal(
    (
      await staffFetch(url, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "Synthetic quote draft" }),
      })
    ).status,
    404,
  );
});

test("a request shows the quote prepared for it, from draft to issued", async () => {
  const json = { "content-type": "application/json" };
  const customer = (await (
    await staffFetch(`${baseUrl}/api/v1/customers`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        companyName: "Linked Quote Demo Ltd",
        contactName: "Jamie Demo",
        email: "jamie@example.test",
      }),
    })
  ).json()) as { id: string };
  const request = (await (
    await staffFetch(`${baseUrl}/api/v1/quote-requests`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        companyName: "Linked Quote Demo Ltd",
        contactName: "Jamie Demo",
        email: "jamie@example.test",
        message: "Synthetic request for a quote",
      }),
    })
  ).json()) as { id: string };
  assert.equal(
    (
      await staffFetch(
        `${baseUrl}/api/v1/quote-requests/${request.id}/customer`,
        {
          method: "PATCH",
          headers: json,
          body: JSON.stringify({ customerCompanyId: customer.id }),
        },
      )
    ).status,
    200,
  );

  type Listed = {
    id: string;
    quoteId: string | null;
    quoteNumber: string | null;
    quoteStatus: "draft" | "issued" | null;
  };
  const listed = async () =>
    (
      (await (
        await staffFetch(
          `${baseUrl}/api/v1/quote-requests?customerCompanyId=${customer.id}`,
        )
      ).json()) as Listed[]
    )[0];

  const before = await listed();
  assert.equal(before.id, request.id);
  assert.deepEqual(
    [before.quoteId, before.quoteNumber, before.quoteStatus],
    [null, null, null],
  );

  const created = await staffFetch(`${baseUrl}/api/v1/quotes`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      customerCompanyId: customer.id,
      serviceLine: "sea_import",
      quoteRequestId: request.id,
      version: {
        currency: "GHS",
        title: "Synthetic quotation",
        procedureSteps: [],
        requiredDocuments: [],
        terms: [],
        lines: [
          {
            description: "BJH service fee",
            basis: "fixed",
            amountMinor: 100000,
          },
        ],
      },
    }),
  });
  assert.equal(created.status, 201, await created.clone().text());
  const quote = (await created.json()) as { id: string };

  const drafted = await listed();
  assert.equal(drafted.quoteId, quote.id);
  // Staff see the number from the moment the quote is made.
  assert.match(drafted.quoteNumber ?? "", /^BJH\/Q\/SI\//);
  assert.equal(drafted.quoteStatus, "draft");

  assert.equal(
    (
      await staffFetch(`${baseUrl}/api/v1/quotes/${quote.id}/issue`, {
        method: "POST",
        headers: json,
        body: "{}",
      })
    ).status,
    201,
  );
  const issued = await listed();
  assert.equal(issued.quoteStatus, "issued");
  assert.equal(issued.quoteNumber, drafted.quoteNumber);

  // A request from another company cannot be used to open a quote.
  const other = (await (
    await staffFetch(`${baseUrl}/api/v1/customers`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        companyName: "Other Quote Demo Ltd",
        contactName: "Pat Demo",
        email: "pat@example.test",
      }),
    })
  ).json()) as { id: string };
  const mismatch = await staffFetch(`${baseUrl}/api/v1/quotes`, {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      customerCompanyId: other.id,
      serviceLine: "sea_import",
      quoteRequestId: request.id,
      version: {
        currency: "GHS",
        title: "Synthetic quotation",
        procedureSteps: [],
        requiredDocuments: [],
        terms: [],
        lines: [{ description: "Fee", basis: "fixed", amountMinor: 100000 }],
      },
    }),
  });
  assert.equal(mismatch.status, 400);
});
