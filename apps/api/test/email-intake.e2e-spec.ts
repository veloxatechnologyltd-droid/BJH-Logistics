import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_ID,
  TEST_CUSTOMER_A_TOKEN,
  TEST_CUSTOMER_B_ID,
  TEST_CUSTOMER_B_TOKEN,
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
  testDocumentStorage,
  testEmailExtractor,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { ExtractionError } from "../src/intake/email-extractor";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

const SECRET = "test-intake-secret";

let application: INestApplication;
let baseUrl: string;
let companyA: string;
let companyB: string;

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body && typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const get = (path: string, token = TEST_SUPER_ADMIN_TOKEN) => call(path, token);
const send = (method: string, path: string, token: string, body?: unknown) =>
  call(path, token, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const json = async <T>(response: Response) => (await response.json()) as T;
const message = async (response: Response) =>
  ((await response.json()) as { message: string }).message;

type Details = Record<string, string | null>;
type Request = {
  id: string;
  companyName: string;
  contactName: string;
  email: string;
  message: string;
  customerCompanyId: string | null;
  details: Details;
  suggestedCustomer?: { id: string; companyName: string } | null;
  intake: null | {
    subject: string;
    fromName: string | null;
    fromEmail: string;
    extractionStatus: "pending" | "done" | "failed";
    extractionError: string | null;
    reviewedAt: string | null;
    reviewedBy: string | null;
    attachments: Array<{ id: string; filename: string; contentType: string }>;
    skippedAttachments: Array<{ filename: string; reason: string }>;
  };
};
type Receipt = {
  requestId: string;
  duplicate: boolean;
  reading: "pending" | "done" | "failed";
};

const reading = (over: Partial<Details> = {}) => ({
  companyName: "Northstar Synthetic Ltd",
  contactName: "Ama Mensah",
  details: {
    service: "sea_import",
    origin: "Shanghai",
    destination: "Tema",
    cargo: "Woven baskets",
    quantity: "2 x 40ft",
    weightVolume: null,
    incoterm: "FOB",
    neededBy: "end of November",
    contactPhone: "024 405 8592",
    ...over,
  } as never,
  kind: null,
  question: null,
});

/** Posts an email the way an email service would: a multipart form with the secret. */
async function deliver(
  fields: Record<string, string>,
  files: Array<{ name: string; bytes: Buffer }> = [],
  headers: Record<string, string> = { authorization: `Bearer ${SECRET}` },
) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  for (const file of files) {
    form.append(
      "attachments",
      new Blob([new Uint8Array(file.bytes)]),
      file.name,
    );
  }
  return fetch(`${baseUrl}/api/v1/inbound-email`, {
    method: "POST",
    headers,
    body: form,
  });
}
const email = (over: Record<string, string> = {}) => ({
  from_email: "buyer@northstar.test",
  from_name: "Ama Mensah",
  subject: "Quote for 2 containers",
  text: "Hello, please quote 2 x 40ft from Shanghai to Tema, FOB. Needed by end of November.",
  message_id: `<${randomUUID()}@mail.test>`,
  ...over,
});
const pdfBytes = Buffer.from("%PDF-1.4\n% synthetic\n%%EOF\n", "latin1");
const requestOf = async (id: string, token = TEST_SUPER_ADMIN_TOKEN) =>
  json<Request>(await get(`/api/v1/quote-requests/${id}`, token));
const nextReading = (value: ReturnType<typeof reading> | Error | null) => {
  testEmailExtractor.result = value;
  testEmailExtractor.calls.length = 0;
};

before(async () => {
  process.env.INBOUND_EMAIL_SECRET = SECRET;
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
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
  [companyA, companyB] = [randomUUID(), randomUUID()];
  const now = new Date().toISOString();
  for (const [id, name, contact] of [
    [companyA, "Northstar Synthetic Ltd", "Buyer@Northstar.test"],
    [companyB, "Southwind Synthetic Ltd", "yaw@southwind.test"],
  ]) {
    await database.createCustomer({
      id,
      companyName: name,
      createdAt: now,
      contacts: [
        {
          id: randomUUID(),
          name: "Contact",
          email: contact,
          phone: null,
          notify: true,
          createdAt: now,
        },
      ],
    });
  }
  await database.grantCustomerMembership(
    companyA,
    TEST_CUSTOMER_A_ID,
    TEST_SUPER_ADMIN_ID,
  );
  await database.grantCustomerMembership(
    companyB,
    TEST_CUSTOMER_B_ID,
    TEST_SUPER_ADMIN_ID,
  );
});

after(async () => {
  delete process.env.INBOUND_EMAIL_SECRET;
  await application?.close();
  await endTestDatabase();
});

test("only the email service that knows the secret can post an email, and with no secret intake is off", async () => {
  const basic = `Basic ${Buffer.from(`intake:${SECRET}`).toString("base64")}`;
  const accepted: Array<Record<string, string>> = [
    { authorization: `Bearer ${SECRET}` },
    { authorization: basic },
    { "x-inbound-secret": SECRET },
  ];
  for (const headers of accepted) {
    nextReading(reading());
    assert.equal((await deliver(email(), [], headers)).status, 201);
  }
  const refused: Array<Record<string, string>> = [
    {},
    { authorization: "Bearer wrong" },
    {
      authorization: `Basic ${Buffer.from("intake:wrong").toString("base64")}`,
    },
    { "x-inbound-secret": "wrong" },
    // A signed-in staff token is not the intake secret.
    { authorization: `Bearer ${TEST_SUPER_ADMIN_TOKEN}` },
  ];
  for (const headers of refused) {
    assert.equal((await deliver(email(), [], headers)).status, 401);
  }
  delete process.env.INBOUND_EMAIL_SECRET;
  assert.equal((await deliver(email())).status, 503);
  process.env.INBOUND_EMAIL_SECRET = SECRET;
});

test("an email becomes a request, and what the AI read fills in its details", async () => {
  nextReading(reading());
  const sent = email({ subject: "Two containers Shanghai to Tema" });
  const response = await deliver(sent);
  assert.equal(response.status, 201);
  const receipt = await json<Receipt>(response);
  assert.equal(receipt.duplicate, false);
  assert.equal(receipt.reading, "done");

  // The AI was given the sender, subject and text, and nothing else.
  assert.equal(testEmailExtractor.calls.length, 1);
  assert.deepEqual(testEmailExtractor.calls[0], {
    fromName: "Ama Mensah",
    fromEmail: "buyer@northstar.test",
    subject: "Two containers Shanghai to Tema",
    bodyText: sent.text,
    attachments: [],
  });

  const request = await requestOf(receipt.requestId);
  assert.equal(request.companyName, "Northstar Synthetic Ltd");
  assert.equal(request.contactName, "Ama Mensah");
  assert.equal(request.email, "buyer@northstar.test");
  assert.equal(request.message, sent.text);
  assert.equal(request.customerCompanyId, null);
  assert.deepEqual(request.details, {
    service: "sea_import",
    origin: "Shanghai",
    destination: "Tema",
    cargo: "Woven baskets",
    quantity: "2 x 40ft",
    weightVolume: null,
    incoterm: "FOB",
    neededBy: "end of November",
    contactPhone: "024 405 8592",
  });
  assert.equal(request.intake?.subject, "Two containers Shanghai to Tema");
  assert.equal(request.intake?.extractionStatus, "done");
  // Nobody has checked it yet.
  assert.equal(request.intake?.reviewedAt, null);
  // It is in the inbox like any other request.
  const inbox = await json<Request[]>(
    await get("/api/v1/quote-requests", TEST_MATCHING_TOKEN),
  );
  assert.ok(inbox.some((item) => item.id === receipt.requestId));
});

test("the same email delivered twice is one request and is not read twice", async () => {
  nextReading(reading());
  const sent = email();
  const first = await json<Receipt>(await deliver(sent));
  const second = await json<Receipt>(await deliver(sent));
  assert.equal(second.duplicate, true);
  assert.equal(second.requestId, first.requestId);
  assert.equal(second.reading, "done");
  assert.equal(testEmailExtractor.calls.length, 1);
  const inbox = await json<Request[]>(await get("/api/v1/quote-requests"));
  assert.equal(inbox.filter((item) => item.id === first.requestId).length, 1);
});

test("an email the AI cannot read is still kept, and can be read again later", async () => {
  nextReading(new ExtractionError("The AI service is busy or over its limit"));
  const sent = email({ from_name: "Kojo Ofori", subject: "Need a truck" });
  const receipt = await json<Receipt>(await deliver(sent));
  assert.equal(receipt.reading, "failed");
  let request = await requestOf(receipt.requestId);
  // The names fall back to the sender; every detail is left for a person.
  assert.equal(request.companyName, "Kojo Ofori");
  assert.equal(request.contactName, "Kojo Ofori");
  assert.equal(request.message, sent.text);
  assert.ok(Object.values(request.details).every((value) => value === null));
  assert.equal(request.intake?.extractionStatus, "failed");
  assert.equal(
    request.intake?.extractionError,
    "The AI service is busy or over its limit",
  );

  // An unexpected fault inside the reader is recorded plainly, not leaked.
  nextReading(new Error("socket hang up at 10.0.0.1"));
  const odd = await json<Receipt>(await deliver(email()));
  assert.equal(odd.reading, "failed");
  assert.equal(
    (await requestOf(odd.requestId)).intake?.extractionError,
    "The email could not be read",
  );

  // Reading again, once the service is back, fills the details in.
  nextReading(reading({ service: "road_transport" }));
  const again = await send(
    "POST",
    `/api/v1/quote-requests/${receipt.requestId}/read-email`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(again.status, 201);
  request = await json<Request>(again);
  assert.equal(request.intake?.extractionStatus, "done");
  assert.equal(request.intake?.extractionError, null);
  assert.equal(request.details.service, "road_transport");
  assert.equal(request.companyName, "Northstar Synthetic Ltd");
});

test("a strange email still arrives: HTML only, no message id, a long body, no sender is refused", async () => {
  nextReading(reading());
  const htmlOnly = await json<Receipt>(
    await deliver({
      from_email: "Pat Boateng <pat@southwind.test>",
      html: "<html><style>p{}</style><body><p>Need <b>2 pallets</b> to Kumasi&nbsp;&amp; back</p></body></html>",
    }),
  );
  assert.equal(testEmailExtractor.calls[0].fromEmail, "pat@southwind.test");
  assert.equal(testEmailExtractor.calls[0].fromName, "Pat Boateng");
  assert.match(
    testEmailExtractor.calls[0].bodyText,
    /^Need 2 pallets to Kumasi & back$/,
  );
  assert.equal(htmlOnly.duplicate, false);

  // Without a message id the same content is still recognised as the same email.
  const fields = {
    from_email: "x@example.test",
    text: "Same text",
    received_at: "2026-10-20T08:00:00Z",
  };
  const one = await json<Receipt>(await deliver(fields));
  const two = await json<Receipt>(await deliver(fields));
  assert.equal(two.duplicate, true);
  assert.equal(two.requestId, one.requestId);

  // A very long email: the request keeps the start; the whole email is kept.
  const long = await json<Receipt>(
    await deliver(email({ text: "word ".repeat(3000) })),
  );
  const request = await requestOf(long.requestId);
  assert.ok(request.message.length < 5200);
  assert.match(request.message, /full email is kept/);

  const noSender = await deliver({ subject: "Hello", text: "Hi" });
  assert.equal(noSender.status, 400);
  assert.equal(await message(noSender), "from_email is required");
});

test("attachments are kept when they are documents a customer would send; others are listed as not kept", async () => {
  nextReading(reading());
  const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
  const receipt = await json<Receipt>(
    await deliver(email(), [
      { name: "Packing List.PDF", bytes: pdfBytes },
      { name: "sheet.xlsx", bytes: Buffer.from("synthetic workbook") },
      { name: "virus.exe", bytes: Buffer.from("MZ") },
      { name: "huge.pdf", bytes: big },
      { name: "empty.pdf", bytes: Buffer.alloc(0) },
      { name: "../../etc/photo.jpg", bytes: Buffer.from("jpeg bytes") },
    ]),
  );
  const request = await requestOf(receipt.requestId);
  assert.deepEqual(
    request.intake?.attachments.map((item) => [
      item.filename,
      item.contentType,
    ]),
    [
      ["Packing List.PDF", "application/pdf"],
      [
        "sheet.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      ["photo.jpg", "image/jpeg"],
    ],
  );
  assert.deepEqual(
    request.intake?.skippedAttachments.map((item) => [
      item.filename,
      item.reason,
    ]),
    [
      ["virus.exe", "This type of file is not kept"],
      ["huge.pdf", "The file is larger than 10 MB"],
      ["empty.pdf", "The file was empty"],
    ],
  );

  // AI read the PDF and the photo with the email; the workbook is kept but not read.
  const readNames = () =>
    testEmailExtractor.calls
      .at(-1)
      ?.attachments?.map((file) => [
        file.filename,
        file.contentType,
        file.bytes.toString("latin1"),
      ]);
  const expectedRead = [
    ["Packing List.PDF", "application/pdf", pdfBytes.toString("latin1")],
    ["photo.jpg", "image/jpeg", "jpeg bytes"],
  ];
  assert.deepEqual(readNames(), expectedRead);
  // Reading again sends the same files, fetched back from storage.
  nextReading(reading());
  const reread = await send(
    "POST",
    `/api/v1/quote-requests/${request.id}/read-email`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(reread.status, 201);
  assert.equal(testEmailExtractor.calls.length, 1);
  assert.deepEqual(readNames(), expectedRead);

  // Staff get a short-lived link; the stored bytes are the ones sent.
  const first = request.intake!.attachments[0];
  const link = await json<{ url: string; filename: string }>(
    await get(
      `/api/v1/quote-requests/${request.id}/attachments/${first.id}`,
      TEST_MATCHING_TOKEN,
    ),
  );
  assert.equal(link.filename, "Packing List.PDF");
  assert.match(link.url, /^https:\/\/storage\.test\/signed\/inbound-email\//);
  const key = link.url.split("/signed/")[1].split("?")[0];
  assert.deepEqual(testDocumentStorage.objects.get(key)?.bytes, pdfBytes);

  // Customers cannot download them; an unknown attachment is not found.
  assert.equal(
    (
      await get(
        `/api/v1/quote-requests/${request.id}/attachments/${first.id}`,
        TEST_CUSTOMER_A_TOKEN,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await get(
        `/api/v1/quote-requests/${request.id}/attachments/${randomUUID()}`,
      )
    ).status,
    404,
  );

  // Only the first ten are kept, and the rest say so.
  const many = await json<Receipt>(
    await deliver(
      email(),
      Array.from({ length: 12 }, (_, index) => ({
        name: `page-${index + 1}.pdf`,
        bytes: pdfBytes,
      })),
    ),
  );
  const crowded = await requestOf(many.requestId);
  assert.equal(crowded.intake?.attachments.length, 10);
  // AI reads only the first five with the email.
  assert.deepEqual(
    testEmailExtractor.calls.at(-1)?.attachments?.map((file) => file.filename),
    ["page-1.pdf", "page-2.pdf", "page-3.pdf", "page-4.pdf", "page-5.pdf"],
  );
  assert.deepEqual(
    crowded.intake?.skippedAttachments.map((item) => item.reason),
    [
      "Only the first 10 attachments are kept",
      "Only the first 10 attachments are kept",
    ],
  );
});

test("a person checks the details: corrections are kept and the request counts as reviewed", async () => {
  nextReading(reading());
  const receipt = await json<Receipt>(await deliver(email()));
  const path = `/api/v1/quote-requests/${receipt.requestId}/details`;
  const saved = await send("PUT", path, TEST_SUPER_ADMIN_TOKEN, {
    service: "sea_import",
    origin: "  Shenzhen ",
    destination: "Tema",
    cargo: "Woven baskets",
    quantity: "1 x 40ft",
    weightVolume: "",
    incoterm: "CIF",
    neededBy: null,
    contactPhone: "024 405 8592",
  });
  assert.equal(saved.status, 200);
  const request = await json<Request>(saved);
  assert.equal(request.details.origin, "Shenzhen");
  assert.equal(request.details.quantity, "1 x 40ft");
  assert.equal(request.details.weightVolume, null);
  assert.equal(request.details.neededBy, null);
  assert.ok(request.intake?.reviewedAt);
  assert.equal(request.intake?.reviewedBy, TEST_SUPER_ADMIN_ID);

  // Once checked, the email is not read again over the person's work.
  const again = await send(
    "POST",
    `/api/v1/quote-requests/${receipt.requestId}/read-email`,
    TEST_SUPER_ADMIN_TOKEN,
  );
  assert.equal(again.status, 409);
  assert.equal(
    await message(again),
    "The details of this request were already checked, so the email is not read again",
  );
  // ... and a late reading never overwrites them either.
  await application.get(DatabasePort).completeEmailReading(receipt.requestId, {
    status: "done",
    model: "late",
    companyName: "Late Co",
    contactName: "Late",
    details: reading({ origin: "Elsewhere" }).details,
    kind: null,
  });
  const after = await requestOf(receipt.requestId);
  assert.equal(after.details.origin, "Shenzhen");
  assert.equal(after.companyName, "Northstar Synthetic Ltd");
});

test("saving details is refused for bad values, for a request that was not an email, and for customers", async () => {
  nextReading(reading());
  const receipt = await json<Receipt>(await deliver(email()));
  const path = `/api/v1/quote-requests/${receipt.requestId}/details`;
  const bad = await send("PUT", path, TEST_SUPER_ADMIN_TOKEN, {
    service: "teleport",
  });
  assert.equal(bad.status, 400);
  assert.equal(
    await message(bad),
    "service must be one of sea_import, sea_export, air_import, air_export, warehousing, road_transport",
  );
  const long = await send("PUT", path, TEST_SUPER_ADMIN_TOKEN, {
    cargo: "x".repeat(501),
  });
  assert.equal(long.status, 400);
  assert.equal(await message(long), "cargo must be at most 500 characters");

  // Customers are refused outright; so is anyone without a staff role.
  for (const token of [TEST_CUSTOMER_A_TOKEN, TEST_CUSTOMER_B_TOKEN]) {
    assert.equal((await send("PUT", path, token, {})).status, 403);
    assert.equal(
      (
        await send(
          "POST",
          `/api/v1/quote-requests/${receipt.requestId}/read-email`,
          token,
        )
      ).status,
      403,
    );
  }
  assert.equal(
    (
      await send(
        "PUT",
        `/api/v1/quote-requests/${randomUUID()}/details`,
        TEST_SUPER_ADMIN_TOKEN,
        {},
      )
    ).status,
    404,
  );

  // A request made on the form has no email to read or check.
  const form = await json<Request>(
    await send("POST", "/api/v1/quote-requests", TEST_SUPER_ADMIN_TOKEN, {
      companyName: "Form Co",
      contactName: "Pat",
      email: "pat@form.test",
      message: "Please quote",
    }),
  );
  assert.equal(form.intake, null);
  assert.ok(Object.values(form.details).every((value) => value === null));
  assert.equal(
    (
      await send(
        "PUT",
        `/api/v1/quote-requests/${form.id}/details`,
        TEST_SUPER_ADMIN_TOKEN,
        {},
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await send(
        "POST",
        `/api/v1/quote-requests/${form.id}/read-email`,
        TEST_SUPER_ADMIN_TOKEN,
      )
    ).status,
    409,
  );
});

test("staff are shown the customer whose contact wrote the email, and a customer never sees the email or what the AI read", async () => {
  nextReading(reading());
  const receipt = await json<Receipt>(
    await deliver(email({ from_email: "BUYER@northstar.test" }), [
      { name: "list.pdf", bytes: pdfBytes },
    ]),
  );
  const before = await requestOf(receipt.requestId);
  // Exact address match, ignoring case: a suggestion to link, never an automatic link.
  assert.deepEqual(before.suggestedCustomer, {
    id: companyA,
    companyName: "Northstar Synthetic Ltd",
  });
  assert.equal(before.customerCompanyId, null);
  // Not linked, so no customer can see it.
  assert.equal(
    (
      await get(
        `/api/v1/quote-requests/${receipt.requestId}`,
        TEST_CUSTOMER_A_TOKEN,
      )
    ).status,
    404,
  );

  const linked = await send(
    "PATCH",
    `/api/v1/quote-requests/${receipt.requestId}/customer`,
    TEST_SUPER_ADMIN_TOKEN,
    { customerCompanyId: companyA },
  );
  assert.equal(linked.status, 200);
  assert.ok(!(await requestOf(receipt.requestId)).suggestedCustomer);

  // The linked customer sees their request as written, without the email's inner workings.
  const mine = await requestOf(receipt.requestId, TEST_CUSTOMER_A_TOKEN);
  assert.equal(mine.message, email().text);
  assert.equal(mine.intake, null);
  assert.ok(Object.values(mine.details).every((value) => value === null));
  assert.ok(!mine.suggestedCustomer);
  const list = await json<Request[]>(
    await get("/api/v1/quote-requests", TEST_CUSTOMER_A_TOKEN),
  );
  const row = list.find((item) => item.id === receipt.requestId)!;
  assert.equal(row.intake, null);
  assert.ok(Object.values(row.details).every((value) => value === null));
  // Another customer cannot see it at all.
  assert.equal(
    (
      await get(
        `/api/v1/quote-requests/${receipt.requestId}`,
        TEST_CUSTOMER_B_TOKEN,
      )
    ).status,
    404,
  );
});

test("the rep in charge of the request's service can check it; other reps cannot; no service means only the super admin", async () => {
  const detailsPath = (id: string) => `/api/v1/quote-requests/${id}/details`;
  const reread = (id: string, token: string) =>
    send("POST", `/api/v1/quote-requests/${id}/read-email`, token);
  const canCheck = async (id: string, token: string) =>
    (await requestOf(id, token)) as Request & { canCheck?: boolean };

  // A sea import request: the sea import rep is in charge, the air export rep is not.
  nextReading(new ExtractionError("The AI service is busy or over its limit"));
  const failed = await json<Receipt>(await deliver(email()));
  // While nothing is known about the service, only the super admin can act.
  assert.equal(
    (await canCheck(failed.requestId, TEST_SUPER_ADMIN_TOKEN)).canCheck,
    true,
  );
  assert.equal(
    (await canCheck(failed.requestId, TEST_MATCHING_TOKEN)).canCheck,
    false,
  );
  assert.equal(
    (await send("PUT", detailsPath(failed.requestId), TEST_MATCHING_TOKEN, {}))
      .status,
    403,
  );
  assert.equal(
    (await reread(failed.requestId, TEST_MATCHING_TOKEN)).status,
    403,
  );
  assert.equal(
    await message(await reread(failed.requestId, TEST_MATCHING_TOKEN)),
    "Only the super admin or the representative in charge of this request's service can check it",
  );
  // The super admin says what it is; now its rep can work on it.
  const set = await send(
    "PUT",
    detailsPath(failed.requestId),
    TEST_SUPER_ADMIN_TOKEN,
    {
      service: "sea_import",
    },
  );
  assert.equal(set.status, 200);

  nextReading(reading({ service: "sea_import" }));
  const sea = await json<Receipt>(await deliver(email()));
  assert.equal(
    (await canCheck(sea.requestId, TEST_MATCHING_TOKEN)).canCheck,
    true,
  );
  assert.equal(
    (await canCheck(sea.requestId, TEST_UNASSIGNED_TOKEN)).canCheck,
    false,
  );
  assert.equal(
    (await send("PUT", detailsPath(sea.requestId), TEST_UNASSIGNED_TOKEN, {}))
      .status,
    403,
  );

  // The rep in charge checks it: details saved, who and when recorded.
  const checked = await send(
    "PUT",
    detailsPath(sea.requestId),
    TEST_MATCHING_TOKEN,
    {
      service: "sea_import",
      origin: "Shanghai",
      destination: "Tema",
      cargo: "Woven baskets",
    },
  );
  assert.equal(checked.status, 200);
  const saved = await json<Request & { canCheck: boolean }>(checked);
  assert.equal(saved.canCheck, true);
  assert.equal(saved.intake?.reviewedBy, TEST_MATCHING_USER_ID);
  assert.ok(saved.intake?.reviewedAt);

  // A request not yet checked can be read again by the rep in charge...
  nextReading(reading({ service: "sea_import", origin: "Shenzhen" }));
  const rep = await json<Receipt>(await deliver(email()));
  nextReading(reading({ service: "sea_import", origin: "Ningbo" }));
  const readByRep = await reread(rep.requestId, TEST_MATCHING_TOKEN);
  assert.equal(readByRep.status, 201);
  const reread1 = await json<Request & { canCheck: boolean }>(readByRep);
  assert.equal(reread1.details.origin, "Ningbo");
  assert.equal(reread1.canCheck, true);
  // ...but not by another line's rep.
  assert.equal(
    (await reread(rep.requestId, TEST_UNASSIGNED_TOKEN)).status,
    403,
  );

  // A failed reading has no service, so the super admin reads it again.
  nextReading(new ExtractionError("The AI service is busy or over its limit"));
  const again = await json<Receipt>(await deliver(email()));
  assert.equal(again.reading, "failed");
  nextReading(reading({ service: "sea_import" }));
  const readAgain = await reread(again.requestId, TEST_SUPER_ADMIN_TOKEN);
  assert.equal(readAgain.status, 201);
  assert.equal(
    ((await readAgain.json()) as { canCheck: boolean }).canCheck,
    true,
  );

  // Correcting the service hands the request to the other line's rep.
  const handedOver = await send(
    "PUT",
    detailsPath(again.requestId),
    TEST_MATCHING_TOKEN,
    { service: "air_export", origin: "Shanghai" },
  );
  assert.equal(handedOver.status, 200);
  assert.equal(
    ((await handedOver.json()) as { canCheck: boolean }).canCheck,
    false,
  );
  assert.equal(
    (await send("PUT", detailsPath(again.requestId), TEST_MATCHING_TOKEN, {}))
      .status,
    403,
  );
  assert.equal(
    (
      await send("PUT", detailsPath(again.requestId), TEST_UNASSIGNED_TOKEN, {
        service: "air_export",
        origin: "Shanghai",
        destination: "Accra",
      })
    ).status,
    200,
  );

  // Road work and warehousing are shared: any rep may check them.
  nextReading(reading({ service: "road_transport" }));
  const road = await json<Receipt>(await deliver(email()));
  for (const token of [TEST_MATCHING_TOKEN, TEST_UNASSIGNED_TOKEN]) {
    assert.equal((await canCheck(road.requestId, token)).canCheck, true);
  }

  // Customers and a request made on the form carry no flag.
  const linked = await send(
    "PATCH",
    `/api/v1/quote-requests/${sea.requestId}/customer`,
    TEST_SUPER_ADMIN_TOKEN,
    { customerCompanyId: companyA },
  );
  assert.equal(linked.status, 200);
  assert.equal(
    "canCheck" in (await requestOf(sea.requestId, TEST_CUSTOMER_A_TOKEN)),
    false,
  );
  const form = await json<Request>(
    await send("POST", "/api/v1/quote-requests", TEST_SUPER_ADMIN_TOKEN, {
      companyName: "Form Co",
      contactName: "Pat",
      email: "pat@form2.test",
      message: "Please quote",
    }),
  );
  assert.equal("canCheck" in (await requestOf(form.id)), false);
});
