import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { after, before, test } from "node:test";
import {
  TEST_CUSTOMER_A_TOKEN,
  TEST_MATCHING_TOKEN,
  TEST_MATCHING_USER_ID,
  TEST_SUPER_ADMIN_ID,
  TEST_SUPER_ADMIN_TOKEN,
  TEST_UNASSIGNED_TOKEN,
  TEST_UNASSIGNED_USER_ID,
  createTestApplication,
  testAssistantClaude,
} from "./test-application";
import { DatabasePort } from "../src/database/database.port";
import { beginTestDatabase, endTestDatabase } from "./postgres-test-database";

let application: INestApplication;
let baseUrl: string;
let jobId: string;
let fileNumber: string;

type Turn = {
  messages: Array<{ role: string; content: unknown }>;
  reply: string;
  proposals: Array<{
    id: string;
    tool: string;
    input: Record<string, unknown>;
    summary: string;
  }>;
};

function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, { ...init, headers });
}
const post = (path: string, token: string, body: unknown) =>
  call(path, token, { method: "POST", body: JSON.stringify(body) });

const reply = (
  content: Array<Record<string, unknown>>,
  stop_reason = "end_turn",
) => ({
  id: `msg_${randomUUID()}`,
  type: "message",
  role: "assistant",
  model: "claude-test",
  content,
  stop_reason,
  usage: { input_tokens: 10, output_tokens: 10 },
});

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
    "import_rep",
    TEST_SUPER_ADMIN_ID,
  );
  const companyId = randomUUID();
  await database.createCustomer({
    id: companyId,
    companyName: "Helper Synthetic Ltd",
    createdAt: new Date().toISOString(),
    contacts: [],
  });
  const opened = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine: "sea_import",
  });
  const job = (await opened.json()) as { id: string; fileNumber: string };
  jobId = job.id;
  fileNumber = job.fileNumber;
});

after(async () => {
  await application?.close();
  await endTestDatabase();
});

test("the helper looks things up at once but only proposes changes", async () => {
  testAssistantClaude.requests.length = 0;
  testAssistantClaude.replies.push(
    reply(
      [
        {
          type: "tool_use",
          id: "toolu_find",
          name: "find_jobs",
          input: { search: fileNumber },
        },
      ],
      "tool_use",
    ),
    reply(
      [
        {
          type: "tool_use",
          id: "toolu_assign",
          name: "assign_job_member",
          input: { jobId, userId: TEST_MATCHING_USER_ID, kind: "lead" },
        },
      ],
      "tool_use",
    ),
    reply([
      {
        type: "text",
        text: "I have proposed the assignment; press Confirm to do it.",
      },
    ]),
  );
  const response = await post("/api/v1/assistant/turn", TEST_UNASSIGNED_TOKEN, {
    messages: [
      { role: "user", content: `Assign the import rep to ${fileNumber}` },
    ],
  });
  assert.equal(response.status, 200, await response.clone().text());
  const turn = (await response.json()) as Turn;
  assert.match(turn.reply, /press Confirm/);
  assert.equal(turn.proposals.length, 1);
  assert.equal(
    turn.proposals[0].summary,
    `Assign air-import@example.test as lead on ${fileNumber}`,
  );

  // The search ran with this person's access and its result went back to the model.
  const second = testAssistantClaude.requests[1] as {
    messages: Array<{ role: string; content: Array<{ content?: string }> }>;
  };
  const found = JSON.parse(second.messages[2].content[0].content!) as Array<{
    fileNumber: string;
  }>;
  assert.equal(found[0].fileNumber, fileNumber);
  // The proposal did not change anything.
  const team = (await (
    await call(`/api/v1/jobs/${jobId}/team`, TEST_UNASSIGNED_TOKEN)
  ).json()) as { team: unknown[] };
  assert.deepEqual(team.team, []);
  // The conversation comes back whole, ending with the helper's answer.
  assert.equal(turn.messages.at(-1)?.role, "assistant");
});

test("confirming runs the action under the person's own rules", async () => {
  const action = {
    tool: "assign_job_member",
    input: { jobId, userId: TEST_MATCHING_USER_ID, kind: "lead" },
  };
  // No invoice has been accepted, so customer service is refused, as on screen.
  const refused = await post(
    "/api/v1/assistant/confirm",
    TEST_UNASSIGNED_TOKEN,
    action,
  );
  assert.equal(refused.status, 409);

  const reminder = await post(
    "/api/v1/assistant/confirm",
    TEST_MATCHING_TOKEN,
    {
      tool: "create_task",
      input: {
        jobId,
        title: "Chase the shipping line",
        assignedRole: "import_rep",
      },
    },
  );
  assert.equal(reminder.status, 201, await reminder.clone().text());
  const tasks = (await (
    await call(`/api/v1/jobs/${jobId}/tasks`, TEST_MATCHING_TOKEN)
  ).json()) as Array<{ title: string }>;
  assert.deepEqual(
    tasks.map((task) => task.title),
    ["Chase the shipping line"],
  );

  const notDesk = await post("/api/v1/assistant/confirm", TEST_MATCHING_TOKEN, {
    tool: "send_client_message",
    input: { companyId: randomUUID(), body: "Hello" },
  });
  assert.equal(notDesk.status, 403);
  const unknown = await post("/api/v1/assistant/confirm", TEST_MATCHING_TOKEN, {
    tool: "delete_everything",
    input: {},
  });
  assert.equal(unknown.status, 400);
});

test("customers cannot use the helper, and bad conversations are refused", async () => {
  assert.equal(
    (
      await post("/api/v1/assistant/turn", TEST_CUSTOMER_A_TOKEN, {
        messages: [{ role: "user", content: "Hi" }],
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await post("/api/v1/assistant/turn", TEST_UNASSIGNED_TOKEN, {
        messages: [],
      })
    ).status,
    400,
  );
});
