import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import type { RequestDetails } from "@bjh/contracts";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let database: DatabasePort;
let companyA: string;
let companyB: string;

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });

type Suggestion = {
  serviceLine: string;
  basedOn: {
    quoteId: string;
    quoteNumber: string | null;
    versionNumber: number;
    customerCompanyName: string;
    match: string;
  } | null;
  version: {
    currency: string;
    title: string;
    subtitle: string | null;
    shipmentScope: string | null;
    sizeLabels: string[];
    terms: string[];
    lines: Array<{
      description: string;
      amountMinor: number | null;
      sizeAmountsMinor: number[] | null;
    }>;
  };
};

const details = (over: Partial<RequestDetails>): RequestDetails => ({
  service: null,
  origin: null,
  destination: null,
  cargo: null,
  quantity: null,
  weightVolume: null,
  incoterm: null,
  neededBy: null,
  contactPhone: null,
  ...over,
});

/** A request as email intake leaves it: read by AI, details filled. */
async function emailRequest(over: Partial<RequestDetails>) {
  const { request } = await database.createEmailQuoteRequest({
    email: {
      messageId: `<${randomUUID()}@mail.test>`,
      fromEmail: "buyer@example.test",
      fromName: "Synthetic Buyer",
      toAddress: null,
      subject: "Rate request",
      bodyText: "Please quote.",
      receivedAt: new Date().toISOString(),
    },
    request: {
      id: randomUUID(),
      companyName: "Synthetic Buyer",
      contactName: "Synthetic Buyer",
      message: "Please quote.",
      source: "email",
      mailbox: "quotes",
    },
    attachments: [],
    skipped: [],
  });
  await database.completeEmailReading(request.id, {
    status: "done",
    model: "test-model",
    companyName: null,
    contactName: null,
    details: details(over),
    kind: null,
  });
  return request.id;
}

/** An issued quote with one priced line, optionally answering a request. */
async function issuedQuote(
  company: string,
  serviceLine: string,
  price: number,
  quoteRequestId: string | null,
  issue = true,
) {
  if (quoteRequestId) {
    const linked = await call(
      `/api/v1/quote-requests/${quoteRequestId}/customer`,
      TEST_SUPER_ADMIN_TOKEN,
      { method: "PATCH", body: JSON.stringify({ customerCompanyId: company }) },
    );
    assert.equal(linked.status, 200);
  }
  const response = await post("/api/v1/quotes", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: company,
    serviceLine,
    quoteRequestId,
    version: {
      currency: "USD",
      title: `Quotation priced ${price}`,
      subtitle: "Another customer's cargo, Tema to Kumasi",
      shipmentScope: "Old scope",
      terms: ["Duties are charged at cost."],
      sizeLabels: ["20ft", "40ft"],
      lines: [
        {
          description: "Clearance",
          basis: "per_container",
          sizeAmountsMinor: [price, price * 2],
        },
        { description: "Duty", basis: "at_cost" },
      ],
    },
  });
  assert.equal(response.status, 201, await response.clone().text());
  const { id } = (await response.json()) as { id: string };
  if (issue) {
    const issued = await post(
      `/api/v1/quotes/${id}/issue`,
      TEST_SUPER_ADMIN_TOKEN,
      {},
    );
    assert.equal(issued.status, 201);
  }
  return id;
}

const suggestion = (requestId: string, token = TEST_MATCHING_TOKEN) =>
  call(`/api/v1/quote-requests/${requestId}/quote-suggestion`, token);

let sameRouteQuote: string;
let sameDestinationQuote: string;

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "sea_import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "air_export_rep",
    TEST_SUPER_ADMIN_ID,
  );
  companyA = randomUUID();
  companyB = randomUUID();
  for (const [id, name] of [
    [companyA, "Northstar Synthetic Ltd"],
    [companyB, "Southwind Synthetic Ltd"],
  ]) {
    await database.createCustomer({
      id,
      companyName: name,
      createdAt: new Date().toISOString(),
      contacts: [],
    });
  }
  await database.grantCustomerMembership(
    companyA,
    TEST_CUSTOMER_A_ID,
    TEST_SUPER_ADMIN_ID,
  );

  // Oldest first: same route, then a newer same-destination one, then a
  // newer one with no request, then a newest draft that was never issued.
  const shanghai = await emailRequest({
    service: "sea_import",
    origin: "Shanghai, China",
    destination: "Tema",
  });
  sameRouteQuote = await issuedQuote(companyB, "sea_import", 11000, shanghai);
  const ningbo = await emailRequest({
    service: "sea_import",
    origin: "Ningbo",
    destination: "TEMA, Ghana",
  });
  sameDestinationQuote = await issuedQuote(
    companyB,
    "sea_import",
    22000,
    ningbo,
  );
  await issuedQuote(companyA, "sea_import", 33000, null);
  const draftRoute = await emailRequest({
    service: "sea_import",
    origin: "Shanghai",
    destination: "Tema",
  });
  await issuedQuote(companyA, "sea_import", 44000, draftRoute, false);
  await issuedQuote(companyA, "air_import", 55000, null);
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("the most similar issued quote is copied: same route first, its prices and sizes, scope from the request", async () => {
  const requestId = await emailRequest({
    service: "sea_import",
    origin: "shanghai",
    destination: "Tema Port",
    cargo: "Woven cotton fabric",
    quantity: "2 x 40ft HC",
    incoterm: "FOB",
    weightVolume: "22,480 kg",
  });
  const response = await suggestion(requestId);
  assert.equal(response.status, 200);
  const body = (await response.json()) as Suggestion;
  assert.equal(body.basedOn?.quoteId, sameRouteQuote);
  assert.equal(body.basedOn?.match, "same route");
  assert.equal(body.basedOn?.customerCompanyName, "Southwind Synthetic Ltd");
  assert.equal(body.basedOn?.versionNumber, 1);
  assert.ok(body.basedOn?.quoteNumber);
  assert.equal(body.version.currency, "USD");
  assert.equal(body.version.subtitle, null);
  assert.deepEqual(body.version.sizeLabels, ["20ft", "40ft"]);
  assert.deepEqual(body.version.terms, ["Duties are charged at cost."]);
  assert.deepEqual(
    body.version.lines.map((line) => [
      line.description,
      line.sizeAmountsMinor,
      line.amountMinor,
    ]),
    [
      ["Clearance", [11000, 22000], null],
      ["Duty", null, null],
    ],
  );
  assert.equal(
    body.version.shipmentScope,
    "2 x 40ft HC · Woven cotton fabric · shanghai to Tema Port · FOB · 22,480 kg",
  );
});

test("without the same route, the same destination wins; without that, the newest issued quote of the service", async () => {
  const busan = await emailRequest({
    service: "sea_import",
    origin: "Busan",
    destination: "Tema",
  });
  const byDestination = (await (await suggestion(busan)).json()) as Suggestion;
  assert.equal(byDestination.basedOn?.quoteId, sameDestinationQuote);
  assert.equal(byDestination.basedOn?.match, "same destination");

  const takoradi = await emailRequest({
    service: "sea_import",
    destination: "Takoradi",
  });
  const byService = (await (await suggestion(takoradi)).json()) as Suggestion;
  assert.equal(byService.basedOn?.match, "same service");
  // The newest issued one (the never-issued draft is not used).
  assert.equal(byService.version.lines[0].sizeAmountsMinor?.[0], 33000);
  // The scope is what the request says, however little.
  assert.equal(byService.version.shipmentScope, "Takoradi");
});

test("a service with no issued quote gets a blank draft described from the request", async () => {
  const road = await emailRequest({
    service: "road_transport",
    origin: "Tema",
    destination: "Kumasi",
    cargo: "Bagged rice",
  });
  const body = (await (await suggestion(road)).json()) as Suggestion;
  assert.equal(body.basedOn, null);
  assert.equal(body.serviceLine, "road_transport");
  assert.equal(body.version.title, "Road transport quotation");
  assert.equal(body.version.shipmentScope, "Bagged rice · Tema to Kumasi");
  assert.deepEqual(body.version.lines, []);
});

test("only staff for the request's service may ask; the service must be known", async () => {
  const sea = await emailRequest({
    service: "sea_import",
    destination: "Tema",
  });
  // A rep of another service, and customers, are refused.
  assert.equal((await suggestion(sea, TEST_UNASSIGNED_TOKEN)).status, 403);
  assert.equal((await suggestion(sea, TEST_CUSTOMER_A_TOKEN)).status, 403);
  // The super admin may, and sees the same suggestion.
  const admin = await suggestion(sea, TEST_SUPER_ADMIN_TOKEN);
  assert.equal(admin.status, 200);
  assert.equal(
    ((await admin.json()) as Suggestion).basedOn?.match,
    "same destination",
  );

  const unknown = await emailRequest({ destination: "Tema" });
  const noService = await suggestion(unknown);
  assert.equal(noService.status, 400);
  assert.match(
    ((await noService.json()) as { message: string }).message,
    /Set the request's service/,
  );
  assert.equal((await suggestion(randomUUID())).status, 404);
  assert.equal((await suggestion("not-a-uuid")).status, 404);
});
