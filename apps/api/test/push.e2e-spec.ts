import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, beforeEach, test } from "node:test";
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
import { PUSH_PROVIDER } from "../src/push/push-provider";
import type { RecordingPushProvider } from "../src/push/push-provider";
import { TeamChatService } from "../src/team-chat/team-chat.service";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

// Who is who here: TEST_UNASSIGNED is customer service, TEST_MATCHING an
// export rep, and the super admin is in every team. There is no sales or
// finance rep among the test accounts.
const ADMIN = TEST_SUPER_ADMIN_TOKEN;
const DESK = TEST_UNASSIGNED_TOKEN;
const EXPORT_REP = TEST_MATCHING_TOKEN;
const SECRET = "test-push-intake-secret";

let application: INestApplication;
let baseUrl: string;
let companyId: string;
let provider: RecordingPushProvider;

const address = (name: string) => `https://fcm.googleapis.com/fcm/send/${name}`;
const keys = { p256dh: "BPublicKey_abc-123", auth: "authSecret-1" };

function call(path: string, token: string | null, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && typeof init.body === "string") {
    headers.set("content-type", "application/json");
  }
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string | null, body: unknown) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });
const json = async <T>(response: Response) => (await response.json()) as T;
const subscribe = (token: string | null, name: string) =>
  post("/api/v1/push/subscriptions", token, {
    endpoint: address(name),
    keys,
  });
/** Notifications are sent after the reply, so give them a moment. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 250));
const sentTo = (name: string) =>
  provider.sent.filter((item) => item.target.endpoint === address(name));
const heardBy = () =>
  ["admin", "desk", "export"].filter((name) => sentTo(name).length > 0);

before(async () => {
  process.env.INBOUND_EMAIL_SECRET = SECRET;
  await beginTestDatabase();
  const started = await createTestApplication();
  application = started.application;
  baseUrl = started.baseUrl;
  provider = application.get(PUSH_PROVIDER);
  provider.publicKey = "test-public-key";
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
  companyId = randomUUID();
  await database.createCustomer({
    id: companyId,
    companyName: "Push Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  await database.grantCustomerMembership(
    companyId,
    TEST_CUSTOMER_A_ID,
    TEST_SUPER_ADMIN_ID,
  );
  // Each person has one browser; the super admin has a second one, a phone.
  for (const [token, name] of [
    [ADMIN, "admin"],
    [ADMIN, "admin-phone"],
    [DESK, "desk"],
    [EXPORT_REP, "export"],
  ] as const) {
    assert.equal((await subscribe(token, name)).status, 201);
  }
});

after(async () => {
  delete process.env.INBOUND_EMAIL_SECRET;
  await application?.close();
  await endTestDatabase();
});

beforeEach(() => {
  provider.sent.length = 0;
  provider.goneEndpoints.clear();
  provider.failEndpoints.clear();
});

test("only signed-in staff may turn notifications on, and only for a real push service", async () => {
  assert.equal((await call("/api/v1/push/key", null)).status, 401);
  assert.equal(
    (await call("/api/v1/push/key", TEST_CUSTOMER_A_TOKEN)).status,
    403,
  );
  assert.equal(
    (await subscribe(TEST_CUSTOMER_A_TOKEN, "customer")).status,
    403,
  );
  assert.deepEqual(await json(await call("/api/v1/push/key", DESK)), {
    publicKey: "test-public-key",
  });

  // The API posts to the stored address, so anything but a browser push
  // service is refused: an internal address, a look-alike host, plain http,
  // a sign-in in the address.
  for (const endpoint of [
    "https://internal.example/hook",
    "https://fcm.googleapis.com.evil.example/x",
    "https://evilfcm.googleapis.com/x",
    "http://fcm.googleapis.com/fcm/send/x",
    "https://user:pass@fcm.googleapis.com/fcm/send/x",
    "https://fcm.googleapis.com:8443/fcm/send/x",
    "not an address",
  ]) {
    const refused = await post("/api/v1/push/subscriptions", DESK, {
      endpoint,
      keys,
    });
    assert.equal(refused.status, 400, endpoint);
  }
  assert.equal(
    (
      await post("/api/v1/push/subscriptions", DESK, {
        endpoint: address("bad-keys"),
        keys: { p256dh: "not valid!", auth: "x" },
      })
    ).status,
    400,
  );
  for (const real of [
    "https://updates.push.services.mozilla.com/wpush/v2/x",
    "https://web.push.apple.com/x",
    "https://db5p.notify.windows.com/?token=x",
  ]) {
    const accepted = await post("/api/v1/push/subscriptions", DESK, {
      endpoint: real,
      keys,
    });
    assert.equal(accepted.status, 201, real);
    await call("/api/v1/push/subscriptions", DESK, {
      method: "DELETE",
      body: JSON.stringify({ endpoint: real }),
    });
  }
});

test("a browser belongs to one person at a time, and only its owner can remove it", async () => {
  const database = application.get(DatabasePort);
  const mine = async (userId: string) =>
    (await database.listPushSubscriptions({ userIds: [userId] })).map(
      (item) => item.endpoint,
    );
  // The desk signs in on a shared computer that the export rep used before.
  assert.equal((await subscribe(DESK, "shared")).status, 201);
  assert.ok((await mine(TEST_UNASSIGNED_USER_ID)).includes(address("shared")));
  assert.equal((await subscribe(EXPORT_REP, "shared")).status, 201);
  assert.ok(!(await mine(TEST_UNASSIGNED_USER_ID)).includes(address("shared")));
  assert.ok((await mine(TEST_MATCHING_USER_ID)).includes(address("shared")));

  // Someone else cannot remove it; the owner can.
  await call("/api/v1/push/subscriptions", DESK, {
    method: "DELETE",
    body: JSON.stringify({ endpoint: address("shared") }),
  });
  assert.ok((await mine(TEST_MATCHING_USER_ID)).includes(address("shared")));
  const removed = await call("/api/v1/push/subscriptions", EXPORT_REP, {
    method: "DELETE",
    body: JSON.stringify({ endpoint: address("shared") }),
  });
  assert.equal(removed.status, 200);
  assert.ok(!(await mine(TEST_MATCHING_USER_ID)).includes(address("shared")));
});

test("nothing is offered or sent while the server has no push keys", async () => {
  provider.publicKey = null;
  try {
    assert.deepEqual(await json(await call("/api/v1/push/key", DESK)), {
      publicKey: null,
    });
    assert.equal((await subscribe(DESK, "offline")).status, 503);
    const group = await json<{ id: string }>(
      await post("/api/v1/team-chat/conversations/group", DESK, {
        title: "No keys",
        memberIds: [TEST_SUPER_ADMIN_ID],
      }),
    );
    await post(`/api/v1/team-chat/conversations/${group.id}/messages`, DESK, {
      body: "Anyone there?",
      tags: [],
    });
    await settle();
    assert.equal(provider.sent.length, 0);
  } finally {
    provider.publicKey = "test-public-key";
  }
});

test("a group message reaches every other member's devices once, and nobody else", async () => {
  const group = await json<{ id: string }>(
    await post("/api/v1/team-chat/conversations/group", DESK, {
      title: "Ops huddle",
      memberIds: [TEST_SUPER_ADMIN_ID],
    }),
  );
  const sent = await post(
    `/api/v1/team-chat/conversations/${group.id}/messages`,
    DESK,
    { body: "  Container   is\nat the port  ", tags: [] },
  );
  assert.equal(sent.status, 201);
  await settle();
  // The super admin's browser and phone both ring; the sender and the export
  // rep (not in the group) hear nothing.
  assert.deepEqual(heardBy(), ["admin"]);
  assert.equal(sentTo("admin").length, 1);
  assert.equal(sentTo("admin-phone").length, 1);
  const { message } = sentTo("admin")[0];
  assert.equal(message.title, "Ops huddle");
  assert.match(message.body, /^\w+: Container is at the port$/);
  assert.equal(message.tag, `team-chat:${group.id}`);
  assert.equal(message.url, `/team-chat?c=${group.id}`);

  // A second message uses the same tag, so the browser replaces and counts.
  await post(`/api/v1/team-chat/conversations/${group.id}/messages`, DESK, {
    body: "And the second one",
    tags: [],
  });
  await settle();
  assert.equal(sentTo("admin").length, 2);
  assert.equal(sentTo("admin")[1].message.tag, message.tag);
});

test("a direct message reaches only the other person, titled by the sender", async () => {
  const direct = await json<{ id: string }>(
    await post("/api/v1/team-chat/conversations/direct", EXPORT_REP, {
      userId: TEST_UNASSIGNED_USER_ID,
    }),
  );
  await post(
    `/api/v1/team-chat/conversations/${direct.id}/messages`,
    EXPORT_REP,
    {
      body: "Booking confirmed?",
      tags: [],
    },
  );
  await settle();
  assert.deepEqual(heardBy(), ["desk"]);
  const { message } = sentTo("desk")[0];
  // The export rep's name, as the test directory shows it, not the chat's.
  assert.notEqual(message.title, "Team chat");
  assert.equal(message.body, "Booking confirmed?");
});

test("a team channel reaches the members of that team, and the super admin", async () => {
  const channels = await json<Array<{ id: string; teamKey: string | null }>>(
    await call("/api/v1/team-chat/conversations", ADMIN),
  );
  const channel = (key: string) =>
    channels.find((item) => item.teamKey === key)!.id;

  // Customer service channel: the desk is told, the export rep is not.
  await post(
    `/api/v1/team-chat/conversations/${channel("customer_service")}/messages`,
    ADMIN,
    { body: "Please check the new request", tags: [] },
  );
  await settle();
  assert.deepEqual(heardBy(), ["desk"]);

  // Operations: the export rep, not the desk.
  provider.sent.length = 0;
  await post(
    `/api/v1/team-chat/conversations/${channel("operations")}/messages`,
    ADMIN,
    { body: "Vessel is late", tags: [] },
  );
  await settle();
  assert.deepEqual(heardBy(), ["export"]);

  // Finance: neither of them is in it.
  provider.sent.length = 0;
  await post(
    `/api/v1/team-chat/conversations/${channel("finance")}/messages`,
    ADMIN,
    { body: "Invoice question", tags: [] },
  );
  await settle();
  assert.deepEqual(heardBy(), []);

  // The super admin is in every channel, and does not hear their own message
  // but does hear one from a colleague.
  provider.sent.length = 0;
  await post(
    `/api/v1/team-chat/conversations/${channel("customer_service")}/messages`,
    DESK,
    { body: "Done", tags: [] },
  );
  await settle();
  assert.deepEqual(heardBy(), ["admin"]);
});

test("a system post to a channel notifies its members too", async () => {
  await application
    .get(TeamChatService)
    .postToTeam("customer_service", "Invoice accepted by a client", []);
  await settle();
  assert.deepEqual(heardBy(), ["admin", "desk"]);
  assert.equal(sentTo("desk")[0].message.body, "Invoice accepted by a client");
});

test("a client's portal message tells customer service and the super admin", async () => {
  const sent = await post("/api/v1/chat/mine", TEST_CUSTOMER_A_TOKEN, {
    body: "Where is   my cargo?",
  });
  assert.equal(sent.status, 201, await sent.clone().text());
  await settle();
  assert.deepEqual(heardBy(), ["admin", "desk"]);
  const { message } = sentTo("desk")[0];
  assert.equal(message.title, "Push Synthetic Ltd");
  assert.equal(message.body, "Where is my cargo?");
  assert.equal(message.tag, `client-chat:${companyId}`);
  assert.equal(message.url, `/chat?company=${companyId}`);
});

test("a client's quote request tells the client desk but not the reps, and names only the sender", async () => {
  const created = await post(
    "/api/v1/quote-requests/mine",
    TEST_CUSTOMER_A_TOKEN,
    {
      contactName: "Ama Synthetic",
      message: "Please quote 2 x 40ft from Tema. Secret details here.",
    },
  );
  assert.equal(created.status, 201, await created.clone().text());
  await settle();
  assert.deepEqual(heardBy(), ["admin", "desk"]);
  const { message } = sentTo("desk")[0];
  assert.equal(message.title, "New quote request");
  assert.equal(message.body, "From Push Synthetic Ltd");
  assert.equal(message.url, "/quotations");
  assert.ok(!JSON.stringify(message).includes("Secret"));
});

test("an emailed request or inquiry tells the client desk, and a repeat delivery does not", async () => {
  const deliver = (fields: Record<string, string>) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    return fetch(`${baseUrl}/api/v1/inbound-email`, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
      body: form,
    });
  };
  const email = {
    from_email: "buyer@northstar.test",
    from_name: "Ama Mensah",
    subject: "Quote for 2 containers",
    text: "Please quote 2 x 40ft from Shanghai to Tema.",
    message_id: `<${randomUUID()}@mail.test>`,
  };
  assert.equal((await deliver(email)).status, 201);
  await settle();
  assert.deepEqual(heardBy(), ["admin", "desk"]);
  assert.equal(sentTo("desk")[0].message.title, "New quote request");
  assert.equal(sentTo("desk")[0].message.body, "From Ama Mensah");

  // The same email delivered again is one request, so one notification.
  provider.sent.length = 0;
  await deliver(email);
  await settle();
  assert.equal(provider.sent.length, 0);
});

test("a support ticket tells the super admin, and the answer tells a staff sender", async () => {
  const created = await post("/api/v1/support", DESK, {
    kind: "question",
    description: "How do I   attach a document?",
  });
  assert.equal(created.status, 201);
  const ticket = await json<{ id: string }>(created);
  await settle();
  // The sender does not hear their own ticket; both the admin's devices do.
  assert.deepEqual(heardBy(), ["admin"]);
  assert.equal(sentTo("admin")[0].message.title, "New question");
  assert.equal(sentTo("admin")[0].message.body, "How do I attach a document?");

  provider.sent.length = 0;
  await post(`/api/v1/support/${ticket.id}/replies`, ADMIN, {
    body: "Open the job and choose Documents.",
  });
  await settle();
  assert.deepEqual(heardBy(), ["desk"]);
  assert.equal(sentTo("desk")[0].message.title, "BJH support replied");

  provider.sent.length = 0;
  await post(`/api/v1/support/mine/${ticket.id}/replies`, DESK, {
    body: "Thanks, found it.",
  });
  await settle();
  assert.deepEqual(heardBy(), ["admin"]);
});

test("an address the push service reports gone is forgotten, and a failing one does not stop the others", async () => {
  const database = application.get(DatabasePort);
  provider.goneEndpoints.add(address("admin-phone"));
  provider.failEndpoints.add(address("admin"));
  const group = await json<{ id: string }>(
    await post("/api/v1/team-chat/conversations/group", DESK, {
      title: "Flaky",
      memberIds: [TEST_SUPER_ADMIN_ID, TEST_MATCHING_USER_ID],
    }),
  );
  await post(`/api/v1/team-chat/conversations/${group.id}/messages`, DESK, {
    body: "Anyone?",
    tags: [],
  });
  await settle();
  // The export rep still heard it although two of the admin's sends failed.
  assert.deepEqual(heardBy(), ["export"]);
  const left = (
    await database.listPushSubscriptions({ userIds: [TEST_SUPER_ADMIN_ID] })
  ).map((item) => item.endpoint);
  assert.ok(!left.includes(address("admin-phone")), "gone one is deleted");
  assert.ok(left.includes(address("admin")), "a failing one is kept to retry");
});

test("someone with no staff role is never notified, even with a subscription", async () => {
  const database = application.get(DatabasePort);
  // A customer account that somehow holds a subscription (rows are only ever
  // written for staff, but the query must not rely on that).
  await database.savePushSubscription({
    userId: TEST_CUSTOMER_A_ID,
    endpoint: address("customer"),
    ...keys,
    userAgent: null,
  });
  assert.deepEqual(
    await database.listPushSubscriptions({ userIds: [TEST_CUSTOMER_A_ID] }),
    [],
  );
  assert.ok(
    !(await database.listPushSubscriptions({ roles: ["super_admin"] })).some(
      (item) => item.userId === TEST_CUSTOMER_A_ID,
    ),
  );

  // A staff member whose role is taken away stops hearing at once.
  const revoked = await database.revokeStaffRole(
    TEST_MATCHING_USER_ID,
    "export_rep",
    TEST_SUPER_ADMIN_ID,
  );
  assert.equal(revoked, "revoked");
  assert.deepEqual(
    await database.listPushSubscriptions({ userIds: [TEST_MATCHING_USER_ID] }),
    [],
  );
});
