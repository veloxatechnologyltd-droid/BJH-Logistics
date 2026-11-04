import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
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

// Who is who here: TEST_UNASSIGNED is customer service (sees every job, no
// money); TEST_MATCHING is an export rep (cannot open sea-import jobs); the
// super admin is in every team, Finance included.
const DESK = TEST_UNASSIGNED_TOKEN;
const EXPORT_REP = TEST_MATCHING_TOKEN;
const ADMIN = TEST_SUPER_ADMIN_TOKEN;

let application: INestApplication;
let baseUrl: string;
let jobId: string;
let fileNumber: string;
let invoiceId: string;

type Summary = {
  id: string;
  kind: string;
  teamKey: string | null;
  title: string;
  personId: string | null;
  unread: number;
};
type Tag = { kind: string; id: string; label: string; href: string | null };
type Message = {
  id: string;
  authorName: string | null;
  body: string;
  tags: Tag[];
};
type Opened = { id: string; title: string; messages: Message[] };

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown = {}) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });
const chat = "/api/v1/team-chat";
const list = async (token: string) =>
  (await (await call(`${chat}/conversations`, token)).json()) as Summary[];
const open = async (id: string, token: string) =>
  (await (await call(`${chat}/conversations/${id}`, token)).json()) as Opened;
const channel = async (teamKey: string, token = ADMIN) =>
  (await list(token)).find((item) => item.teamKey === teamKey)!.id;

before(async () => {
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  const database = application.get(DatabasePort);
  await database.assignStaffRole(
    TEST_UNASSIGNED_USER_ID,
    "customer_service_rep",
    TEST_SUPER_ADMIN_ID,
  );
  await database.assignStaffRole(
    TEST_MATCHING_USER_ID,
    "export_rep",
    TEST_SUPER_ADMIN_ID,
  );
  const companyId = randomUUID();
  await database.createCustomer({
    id: companyId,
    companyName: "Team Chat Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  await database.grantCustomerMembership(
    companyId,
    TEST_CUSTOMER_A_ID,
    TEST_SUPER_ADMIN_ID,
  );
  const saved = await call("/api/v1/settings", ADMIN, {
    method: "PUT",
    body: JSON.stringify({
      issuer: { name: "Synthetic Forwarding Ltd", address: "1 Test Road" },
      currencies: ["GHS"],
      taxLines: [],
      paymentTermsDays: 30,
      numbering: {
        quotePrefix: "SYN/Q",
        invoicePrefix: "SYN/INV",
        receiptPrefix: "SYN/RCT",
      },
      quoteDefaults: {},
    }),
  });
  assert.equal(saved.status, 200);
  const opened = await post("/api/v1/jobs", ADMIN, {
    customerCompanyId: companyId,
    serviceLine: "sea_import",
  });
  const job = (await opened.json()) as { id: string; fileNumber: string };
  jobId = job.id;
  fileNumber = job.fileNumber;
  const draft = await post(`/api/v1/jobs/${jobId}/invoices`, ADMIN, {
    currency: "GHS",
    lines: [{ description: "Clearance", amountMinor: 123456 }],
  });
  invoiceId = ((await draft.json()) as { id: string }).id;
  const issued = await post(
    `/api/v1/jobs/${jobId}/invoices/${invoiceId}/issue`,
    ADMIN,
  );
  assert.equal(issued.status, 201, await issued.clone().text());
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("staff see their own team channels; customers are refused", async () => {
  const teams = async (token: string) =>
    (await list(token))
      .filter((item) => item.kind === "team")
      .map((item) => item.teamKey)
      .sort();
  assert.deepEqual(await teams(DESK), ["customer_service"]);
  assert.deepEqual(await teams(EXPORT_REP), ["operations"]);
  assert.deepEqual(await teams(ADMIN), [
    "customer_service",
    "finance",
    "operations",
    "sales",
  ]);

  const finance = await channel("finance");
  assert.equal(
    (await call(`${chat}/conversations/${finance}`, DESK)).status,
    404,
  );
  assert.equal(
    (
      await post(`${chat}/conversations/${finance}/messages`, DESK, {
        body: "x",
      })
    ).status,
    404,
  );
  for (const path of ["/conversations", "/people", "/unread"]) {
    assert.equal(
      (await call(`${chat}${path}`, TEST_CUSTOMER_A_TOKEN)).status,
      403,
    );
  }
  assert.equal((await call(`${chat}/conversations`, "bad-token")).status, 401);
});

test("a direct conversation belongs to its two people only, and counts unread", async () => {
  const started = await post(`${chat}/conversations/direct`, DESK, {
    userId: TEST_MATCHING_USER_ID,
  });
  assert.equal(started.status, 201);
  const { id } = (await started.json()) as { id: string };
  const again = (await (
    await post(`${chat}/conversations/direct`, EXPORT_REP, {
      userId: TEST_UNASSIGNED_USER_ID,
    })
  ).json()) as { id: string };
  assert.equal(again.id, id, "one conversation per pair");

  const sent = await post(`${chat}/conversations/${id}/messages`, DESK, {
    body: "Is the export booking confirmed?",
  });
  assert.equal(sent.status, 201);

  const before = (await list(EXPORT_REP)).find((item) => item.id === id)!;
  assert.equal(before.unread, 1);
  assert.equal(before.title, "Staff");
  const seen = await open(id, EXPORT_REP);
  assert.equal(seen.messages[0].body, "Is the export booking confirmed?");
  assert.equal(seen.messages[0].authorName, "Staff");
  assert.equal(
    (await list(EXPORT_REP)).find((item) => item.id === id)!.unread,
    0,
  );
  assert.deepEqual(await (await call(`${chat}/unread`, EXPORT_REP)).json(), {
    unread: 0,
  });

  // Even the super admin cannot read two other people's direct messages.
  assert.equal((await call(`${chat}/conversations/${id}`, ADMIN)).status, 404);
  assert.equal(
    (
      await post(`${chat}/conversations/direct`, DESK, {
        userId: TEST_CUSTOMER_A_ID,
      })
    ).status,
    400,
    "customers cannot be messaged here",
  );
  assert.equal(
    (
      await post(`${chat}/conversations/direct`, DESK, {
        userId: TEST_UNASSIGNED_USER_ID,
      })
    ).status,
    400,
  );
});

test("tags show each reader only what they may open, and never amounts", async () => {
  const { id } = (await (
    await post(`${chat}/conversations/direct`, DESK, {
      userId: TEST_MATCHING_USER_ID,
    })
  ).json()) as { id: string };
  const sent = await post(`${chat}/conversations/${id}/messages`, DESK, {
    body: `About ${fileNumber} and its invoice`,
    tags: [
      { kind: "job", id: jobId },
      { kind: "invoice", id: invoiceId },
      { kind: "user", id: TEST_MATCHING_USER_ID },
    ],
  });
  assert.equal(sent.status, 201, await sent.clone().text());

  const deskView = await call(`${chat}/conversations/${id}`, DESK);
  const deskText = await deskView.clone().text();
  assert.equal(/Minor|123456|1,234\.56/.test(deskText), false, "no amounts");
  const deskTags = ((await deskView.json()) as Opened).messages.at(-1)!.tags;
  assert.deepEqual(
    deskTags.map((tag) => [tag.kind, tag.label, tag.href]),
    [
      ["job", fileNumber, `/jobs/${jobId}`],
      // Customer service opens the job's billing in Finance (Evans, 2026-11-04).
      [
        "invoice",
        "SYN/INV/" + deskTags[1].label.split("SYN/INV/")[1],
        `/finance/jobs/${jobId}`,
      ],
      ["user", "Air Import", null],
    ],
  );

  // The export rep cannot open a sea-import job, so its tags stay closed.
  const repTags = (await open(id, EXPORT_REP)).messages.at(-1)!.tags;
  assert.deepEqual(
    repTags.map((tag) => [tag.kind, tag.label, tag.href]),
    [
      ["job", "A job you can't open", null],
      ["invoice", "An invoice you can't open", null],
      ["user", "Air Import", null],
    ],
  );
  const refused = await post(
    `${chat}/conversations/${id}/messages`,
    EXPORT_REP,
    {
      body: "Tagging what I cannot see",
      tags: [{ kind: "job", id: jobId }],
    },
  );
  assert.equal(refused.status, 400);

  const found = (await (
    await call(`${chat}/tags?q=${encodeURIComponent(fileNumber)}`, DESK)
  ).json()) as Tag[];
  assert.ok(found.some((tag) => tag.kind === "job" && tag.id === jobId));
  const notFound = (await (
    await call(`${chat}/tags?q=${encodeURIComponent(fileNumber)}`, EXPORT_REP)
  ).json()) as Tag[];
  assert.deepEqual(notFound, []);

  assert.equal(
    (await post(`${chat}/conversations/${id}/messages`, DESK, { body: "  " }))
      .status,
    400,
  );
  assert.equal(
    (
      await post(`${chat}/conversations/${id}/messages`, DESK, {
        body: "Too many",
        tags: Array.from({ length: 21 }, () => ({
          kind: "job",
          id: jobId,
        })),
      })
    ).status,
    400,
  );
});

test("people show who is online, and who the reader is", async () => {
  type Person = {
    userId: string;
    you: boolean;
    online: boolean;
    lastSeen: string | null;
  };
  const people = async (token: string) =>
    (await (await call(`${chat}/people`, token)).json()) as Person[];
  // The unread poll is the heartbeat that marks someone online.
  await call(`${chat}/unread`, EXPORT_REP);
  const seen = await people(DESK);
  const rep = seen.find((p) => p.userId === TEST_MATCHING_USER_ID)!;
  assert.equal(rep.online, true);
  assert.ok(rep.lastSeen);
  assert.equal(rep.you, false);
  const me = seen.find((p) => p.userId === TEST_UNASSIGNED_USER_ID)!;
  assert.equal(me.you, true);
  assert.equal(me.online, true, "asking for the list counts as being here");
  // A direct chat names the other person, so the list can show their status.
  await post(`${chat}/conversations/direct`, DESK, {
    userId: TEST_MATCHING_USER_ID,
  });
  const direct = (await list(DESK)).find(
    (item) => item.personId === TEST_MATCHING_USER_ID,
  );
  assert.ok(direct);
});

test("groups: anyone starts one, members add others, and people can leave", async () => {
  const created = await post(`${chat}/conversations/group`, DESK, {
    title: "Synthetic shipment group",
    memberIds: [TEST_MATCHING_USER_ID],
  });
  assert.equal(created.status, 201);
  const { id } = (await created.json()) as { id: string };
  assert.equal((await open(id, EXPORT_REP)).title, "Synthetic shipment group");
  assert.equal((await call(`${chat}/conversations/${id}`, ADMIN)).status, 404);

  assert.equal(
    (
      await post(`${chat}/conversations/${id}/members`, EXPORT_REP, {
        userId: TEST_SUPER_ADMIN_ID,
      })
    ).status,
    201,
  );
  assert.equal((await call(`${chat}/conversations/${id}`, ADMIN)).status, 200);
  assert.equal(
    (
      await post(`${chat}/conversations/${id}/members`, DESK, {
        userId: TEST_CUSTOMER_A_ID,
      })
    ).status,
    400,
  );

  assert.equal(
    (await post(`${chat}/conversations/${id}/leave`, ADMIN)).status,
    201,
  );
  assert.equal((await call(`${chat}/conversations/${id}`, ADMIN)).status, 404);
  assert.equal(
    (
      await post(
        `${chat}/conversations/${await channel("finance")}/leave`,
        ADMIN,
      )
    ).status,
    409,
    "a team channel follows roles and cannot be left",
  );
});

test("when customer service records an invoice acceptance, Finance is told in its channel", async () => {
  const accepted = await post(
    `/api/v1/jobs/${jobId}/invoices/${invoiceId}/accept`,
    DESK,
    { signatoryName: "Kojo Synthetic" },
  );
  assert.equal(accepted.status, 201, await accepted.clone().text());

  const finance = await open(await channel("finance"), ADMIN);
  const alert = finance.messages.at(-1)!;
  assert.equal(alert.authorName, null, "posted by the system");
  assert.match(alert.body, new RegExp(fileNumber.replace(/\//g, "\\/")));
  assert.match(alert.body, /Kojo Synthetic\), recorded by customer service\./);
  assert.deepEqual(
    alert.tags.map((tag) => [tag.kind, tag.href]),
    [
      ["invoice", `/finance/jobs/${jobId}`],
      ["job", `/jobs/${jobId}`],
    ],
  );
  assert.equal(
    (await list(DESK)).some((item) => item.teamKey === "finance"),
    false,
  );
});
