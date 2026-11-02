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
let companyId: string;

let conversationId: string;
let firstSystem: string;

type Turn = {
  conversationId: string;
  title: string;
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
  companyId = randomUUID();
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
        {
          type: "tool_use",
          id: "toolu_task",
          name: "create_task",
          input: {
            jobId,
            title: "Call the client",
            assignedRole: "import_rep",
          },
        },
        {
          type: "tool_use",
          id: "toolu_receipt",
          name: "email_receipt",
          input: {
            jobId,
            invoiceId: randomUUID(),
            paymentId: randomUUID(),
          },
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
    message: `Assign the import rep to ${fileNumber}`,
  });
  assert.equal(response.status, 200, await response.clone().text());
  const turn = (await response.json()) as Turn;
  assert.match(turn.reply, /press Confirm/);
  assert.equal(turn.proposals.length, 3);
  assert.equal(
    turn.proposals[0].summary,
    `Assign air-import@example.test as lead on ${fileNumber}`,
  );
  assert.match(turn.proposals[1].summary, /^Create the task "Call the client"/);

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
  firstSystem = (testAssistantClaude.requests[0] as { system: string }).system;
  // A new conversation was saved, titled with the first question.
  conversationId = turn.conversationId;
  assert.equal(turn.title, `Assign the import rep to ${fileNumber}`);
});

test("drafted messages come back as buttons to the page that finishes them", async () => {
  testAssistantClaude.requests.length = 0;
  const invented = randomUUID();
  testAssistantClaude.replies.push(
    reply(
      [
        {
          type: "tool_use",
          id: "toolu_chat",
          name: "open_page",
          input: {
            page: "client_chat",
            id: companyId,
            draft: "Dear Helper Synthetic Ltd, we have your request.",
          },
        },
        {
          type: "tool_use",
          id: "toolu_job",
          name: "open_page",
          input: { page: "job", id: jobId },
        },
        {
          type: "tool_use",
          id: "toolu_invented",
          name: "open_page",
          input: { page: "customer", id: invented },
        },
      ],
      "tool_use",
    ),
    reply([{ type: "text", text: "Press the button to finish it." }]),
  );
  const response = await post("/api/v1/assistant/turn", TEST_UNASSIGNED_TOKEN, {
    message: "Draft a message to Helper Synthetic Ltd",
  });
  assert.equal(response.status, 200, await response.clone().text());
  const turn = (await response.json()) as Turn & {
    links: Array<{ id: string; label: string; href: string; draft?: string }>;
  };
  assert.deepEqual(turn.links, [
    {
      id: "toolu_chat",
      label: "Finish the message to Helper Synthetic Ltd in Client chat",
      href: `/chat?company=${companyId}`,
      draft: "Dear Helper Synthetic Ltd, we have your request.",
    },
    {
      id: "toolu_job",
      label: `Open job ${fileNumber}`,
      href: `/jobs/${jobId}`,
    },
  ]);
  // Nothing was sent, and an invented ID gives no button, only an error.
  assert.deepEqual(turn.proposals, []);
  const results = (
    testAssistantClaude.requests[1] as {
      messages: Array<{
        content: Array<{ tool_use_id?: string; is_error?: boolean }>;
      }>;
    }
  ).messages.at(-1)!.content;
  assert.equal(
    results.find((result) => result.tool_use_id === "toolu_invented")?.is_error,
    true,
  );
  await call(
    `/api/v1/assistant/conversations/${turn.conversationId}`,
    TEST_UNASSIGNED_TOKEN,
    { method: "DELETE" },
  );
});

/** Has the helper propose one action in a new conversation; returns what Confirm needs. */
async function propose(
  token: string,
  tool: string,
  input: Record<string, unknown>,
) {
  const proposalId = `toolu_${randomUUID()}`;
  testAssistantClaude.replies.length = 0;
  testAssistantClaude.replies.push(
    reply(
      [{ type: "tool_use", id: proposalId, name: tool, input }],
      "tool_use",
    ),
    reply([{ type: "text", text: "Proposed." }]),
  );
  const response = await post("/api/v1/assistant/turn", token, {
    message: "Please do it",
  });
  assert.equal(response.status, 200, await response.clone().text());
  const turn = (await response.json()) as Turn;
  return { conversationId: turn.conversationId, proposalId };
}
const confirm = (token: string, body: Record<string, unknown>) =>
  post("/api/v1/assistant/confirm", token, body);

test("confirming runs the action under the person's own rules", async () => {
  // No invoice has been accepted, so customer service is refused, as on screen.
  const refused = await confirm(TEST_UNASSIGNED_TOKEN, {
    conversationId,
    proposalId: "toolu_assign",
  });
  assert.equal(refused.status, 409);

  const task = await propose(TEST_MATCHING_TOKEN, "create_task", {
    jobId,
    title: "Chase the shipping line",
    assignedRole: "import_rep",
  });
  const reminder = await confirm(TEST_MATCHING_TOKEN, task);
  assert.equal(reminder.status, 201, await reminder.clone().text());
  const tasks = (await (
    await call(`/api/v1/jobs/${jobId}/tasks`, TEST_MATCHING_TOKEN)
  ).json()) as Array<{ title: string }>;
  assert.deepEqual(
    tasks.map((item) => item.title),
    ["Chase the shipping line"],
  );

  const message = await propose(TEST_MATCHING_TOKEN, "send_client_message", {
    companyId,
    body: "Hello",
  });
  assert.equal((await confirm(TEST_MATCHING_TOKEN, message)).status, 403);
  // Receipts are finance work; customer service cannot send one through the helper.
  const receipt = await confirm(TEST_UNASSIGNED_TOKEN, {
    conversationId,
    proposalId: "toolu_receipt",
  });
  assert.equal(receipt.status, 403);
});

test("only what the helper proposed runs, exactly as proposed, and once", async () => {
  const proposed = await propose(TEST_MATCHING_TOKEN, "create_task", {
    jobId,
    title: "Proposed task",
    assignedRole: "import_rep",
  });
  // Nothing was proposed under these IDs, or in this person's conversation.
  assert.equal(
    (
      await confirm(TEST_MATCHING_TOKEN, {
        conversationId: proposed.conversationId,
        proposalId: "toolu_never_proposed",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await confirm(TEST_MATCHING_TOKEN, {
        conversationId: proposed.conversationId,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await confirm(TEST_MATCHING_TOKEN, {
        tool: "create_task",
        input: { jobId, title: "Made up", assignedRole: "import_rep" },
      })
    ).status,
    404,
  );
  // A tool and input sent with the confirm are ignored: the proposal runs.
  const first = await confirm(TEST_MATCHING_TOKEN, {
    ...proposed,
    tool: "create_task",
    input: { jobId, title: "Swapped in", assignedRole: "import_rep" },
  });
  assert.equal(first.status, 201, await first.clone().text());
  // Pressing Confirm again does not run it again.
  const again = await confirm(TEST_MATCHING_TOKEN, proposed);
  assert.equal(again.status, 409);
  const titles = (
    (await (
      await call(`/api/v1/jobs/${jobId}/tasks`, TEST_MATCHING_TOKEN)
    ).json()) as Array<{ title: string }>
  ).map((item) => item.title);
  assert.equal(titles.filter((title) => title === "Proposed task").length, 1);
  assert.equal(titles.includes("Swapped in"), false);
  assert.equal(titles.includes("Made up"), false);
});

test("a double-click confirms once", async () => {
  const proposed = await propose(TEST_MATCHING_TOKEN, "create_task", {
    jobId,
    title: "Double-click task",
    assignedRole: "import_rep",
  });
  const statuses = (
    await Promise.all([
      confirm(TEST_MATCHING_TOKEN, proposed),
      confirm(TEST_MATCHING_TOKEN, proposed),
      confirm(TEST_MATCHING_TOKEN, proposed),
    ])
  )
    .map((response) => response.status)
    .sort();
  assert.deepEqual(statuses, [201, 409, 409]);
  const titles = (
    (await (
      await call(`/api/v1/jobs/${jobId}/tasks`, TEST_MATCHING_TOKEN)
    ).json()) as Array<{ title: string }>
  ).map((item) => item.title);
  assert.equal(
    titles.filter((title) => title === "Double-click task").length,
    1,
  );
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
        message: "  ",
      })
    ).status,
    400,
  );
});

test("conversations are kept, continued and private to their owner", async () => {
  // A confirmed action is recorded in the conversation and told to the model next turn.
  const confirmed = await post(
    "/api/v1/assistant/confirm",
    TEST_UNASSIGNED_TOKEN,
    { conversationId, proposalId: "toolu_task" },
  );
  assert.equal(confirmed.status, 201, await confirmed.clone().text());

  testAssistantClaude.requests.length = 0;
  testAssistantClaude.replies.push(
    reply([{ type: "text", text: "Anything else?" }]),
  );
  const next = await post("/api/v1/assistant/turn", TEST_UNASSIGNED_TOKEN, {
    conversationId,
    message: "Thanks",
  });
  assert.equal(next.status, 200, await next.clone().text());
  assert.equal(((await next.json()) as Turn).conversationId, conversationId);
  // The model got the whole earlier conversation from the server.
  const sent = testAssistantClaude.requests[0] as {
    system: string;
    thinking: { block_binding?: { prefix_mismatch_behavior: string } };
    messages: Array<{ role: string; content: unknown }>;
  };
  // The earlier message is replayed exactly as it was first sent.
  assert.match(
    String(sent.messages[0].content),
    new RegExp(`^\\(Now: .+\\)\\n\\nAssign the import rep to ${fileNumber}$`),
  );
  assert.match(
    String(sent.messages.at(-1)?.content),
    /^\(Now: .*\. Confirmed since my last message: Create the task "Call the client".*\)\n\nThanks$/s,
  );
  // Earlier thinking blocks are only valid while the system prompt stays the
  // same, so it carries no time and is identical on every turn.
  assert.equal(sent.system, firstSystem);
  assert.doesNotMatch(sent.system, /\d{4}-\d{2}-\d{2}T/);
  assert.equal(
    sent.thinking.block_binding?.prefix_mismatch_behavior,
    "drop_block",
  );

  const list = (await (
    await call("/api/v1/assistant/conversations", TEST_UNASSIGNED_TOKEN)
  ).json()) as Array<{ id: string; title: string }>;
  assert.deepEqual(
    list.map((item) => item.id),
    [conversationId],
  );
  const opened = (await (
    await call(
      `/api/v1/assistant/conversations/${conversationId}`,
      TEST_UNASSIGNED_TOKEN,
    )
  ).json()) as { lines: Array<{ kind: string; text: string }> };
  assert.deepEqual(
    opened.lines.map((line) => line.kind),
    ["you", "helper", "done", "you", "helper"],
  );

  // Another staff member can neither see, continue, record into nor delete it.
  const others = (await (
    await call("/api/v1/assistant/conversations", TEST_MATCHING_TOKEN)
  ).json()) as unknown[];
  assert.equal(
    (others as Array<{ id: string }>).some(
      (item) => item.id === conversationId,
    ),
    false,
  );
  const path = `/api/v1/assistant/conversations/${conversationId}`;
  assert.equal((await call(path, TEST_MATCHING_TOKEN)).status, 404);
  assert.equal(
    (
      await post("/api/v1/assistant/turn", TEST_MATCHING_TOKEN, {
        conversationId,
        message: "Hi",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await post("/api/v1/assistant/confirm", TEST_MATCHING_TOKEN, {
        conversationId,
        proposalId: "toolu_task",
      })
    ).status,
    404,
  );
  assert.equal(
    (await call(path, TEST_MATCHING_TOKEN, { method: "DELETE" })).status,
    404,
  );
  assert.equal((await call(path, TEST_CUSTOMER_A_TOKEN)).status, 403);

  // The owner deletes it.
  assert.equal(
    (await call(path, TEST_UNASSIGNED_TOKEN, { method: "DELETE" })).status,
    204,
  );
  assert.equal((await call(path, TEST_UNASSIGNED_TOKEN)).status, 404);
});

test("when Claude fails, OpenAI answers the turn with the same tools", async () => {
  const sent: Array<{
    model: string;
    input: Array<Record<string, unknown>>;
    tools: Array<{ type: string; name: string }>;
  }> = [];
  const answers = [
    {
      status: "completed",
      output: [
        {
          type: "function_call",
          call_id: "call_find",
          name: "find_jobs",
          arguments: JSON.stringify({ search: fileNumber }),
        },
      ],
    },
    {
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "One job matches." }],
        },
      ],
    },
  ];
  const fallback = {
    apiKey: "o",
    model: "gpt-test-model",
    baseUrl: "https://api.openai.com/v1",
    timeoutMs: 5000,
    fetch: (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)) as (typeof sent)[number]);
      return new Response(JSON.stringify(answers.shift()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch,
  };
  const helper = testAssistantClaude as typeof testAssistantClaude & {
    fallback?: typeof fallback;
  };
  helper.fallback = fallback;
  // No scripted Claude reply: the Claude call fails.
  testAssistantClaude.replies.length = 0;
  try {
    const response = await post("/api/v1/assistant/turn", TEST_MATCHING_TOKEN, {
      message: `Find ${fileNumber}`,
    });
    assert.equal(response.status, 200, await response.clone().text());
    const turn = (await response.json()) as Turn;
    assert.equal(turn.reply, "One job matches.");

    assert.equal(sent.length, 2);
    assert.equal(sent[0].model, "gpt-test-model");
    assert.ok(sent[0].tools.some((tool) => tool.name === "find_jobs"));
    // The search ran with this person's access and its result went back.
    const result = sent[1].input.find(
      (item) => item.type === "function_call_output",
    ) as { call_id: string; output: string };
    assert.equal(result.call_id, "call_find");
    assert.equal(
      (JSON.parse(result.output) as Array<{ fileNumber: string }>)[0]
        .fileNumber,
      fileNumber,
    );
    const opened = (await (
      await call(
        `/api/v1/assistant/conversations/${turn.conversationId}`,
        TEST_MATCHING_TOKEN,
      )
    ).json()) as { lines: Array<{ text: string }> };
    assert.equal(opened.lines.at(-1)?.text, "One job matches.");

    // With OpenAI failing too, the person gets the usual safe message.
    const failing = await post("/api/v1/assistant/turn", TEST_MATCHING_TOKEN, {
      message: "Hello",
    });
    assert.equal(failing.status, 503);
  } finally {
    delete helper.fallback;
  }
});

test("a proposal names only jobs and people the person may see", async () => {
  const otherLine = await post("/api/v1/jobs", TEST_SUPER_ADMIN_TOKEN, {
    customerCompanyId: companyId,
    serviceLine: "sea_export",
  });
  const hidden = (await otherLine.json()) as {
    id: string;
    fileNumber: string;
  };
  testAssistantClaude.replies.length = 0;
  testAssistantClaude.replies.push(
    reply(
      [
        {
          type: "tool_use",
          id: "toolu_hidden_task",
          name: "create_task",
          input: {
            jobId: hidden.id,
            title: "Look into it",
            assignedRole: "import_rep",
          },
        },
        {
          type: "tool_use",
          id: "toolu_hidden_assign",
          name: "assign_job_member",
          input: {
            jobId: hidden.id,
            userId: TEST_UNASSIGNED_USER_ID,
            kind: "lead",
          },
        },
      ],
      "tool_use",
    ),
    reply([{ type: "text", text: "Proposed." }]),
  );
  // An import rep has no access to a sea export job.
  const response = await post("/api/v1/assistant/turn", TEST_MATCHING_TOKEN, {
    message: "Do something on that job",
  });
  assert.equal(response.status, 200, await response.clone().text());
  const turn = (await response.json()) as Turn;
  const summaries = turn.proposals.map((proposal) => proposal.summary);
  assert.equal(summaries.length, 2);
  for (const summary of summaries) {
    assert.doesNotMatch(summary, new RegExp(hidden.fileNumber));
    assert.doesNotMatch(summary, /staff@example\.test/);
  }
  assert.match(summaries[0], /an unknown job/);
  assert.match(summaries[1], /an unknown person/);
});
