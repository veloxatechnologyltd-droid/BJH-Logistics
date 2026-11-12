import assert from "node:assert/strict";
import { test } from "node:test";
import { simpleParser } from "mailparser";
import {
  parseSalesMailboxSource,
  salesEmailFromParsed,
  salesMailboxFromEnvironment,
  SalesMailboxService,
  salesMessageBodyWithUnsubscribe,
  salesSendFailure,
  salesUnsubscribeReply,
  storeSalesEmailAttachments,
} from "../src/sales/sales-mailbox.service";
import {
  RecordingEmailProvider,
  SmtpEmailProvider,
} from "../src/notifications/providers";
import { DatabasePort } from "../src/database/database.port";
import { salesUnsubscribeSetup } from "../src/sales/sales-unsubscribe";
import { safeLoggedPath } from "../src/app.config";
import type { DocumentStorage } from "../src/documents/document-storage.port";

const storage: DocumentStorage = {
  put: async () => undefined,
  get: async () => Buffer.alloc(0),
  createSignedUrl: async () => "https://storage.example.test/synthetic",
};

test("production unsubscribe setup requires a public HTTPS API URL and a stable key", () => {
  const key = Buffer.alloc(32, 7).toString("hex");
  assert.equal(
    salesUnsubscribeSetup({
      OUTREACH_UNSUBSCRIBE_KEY: key,
      PUBLIC_API_URL: "http://127.0.0.1:3001/api",
      NODE_ENV: "production",
    }),
    null,
  );
  assert.equal(
    salesUnsubscribeSetup({
      OUTREACH_UNSUBSCRIBE_KEY: key,
      PUBLIC_API_URL: "https://api.example.test/api?token=x",
      NODE_ENV: "production",
    }),
    null,
  );
  assert.equal(
    salesUnsubscribeSetup({
      OUTREACH_UNSUBSCRIBE_KEY: "short",
      PUBLIC_API_URL: "https://api.example.test/api",
      NODE_ENV: "production",
    }),
    null,
  );
  assert.equal(
    salesUnsubscribeSetup({
      OUTREACH_UNSUBSCRIBE_KEY: key,
      PUBLIC_API_URL: "https://api.example.test/api",
      NODE_ENV: "production",
    })?.baseUrl,
    "https://api.example.test/api",
  );
});

test("unsubscribe tokens are redacted from HTTP request logs", () => {
  assert.equal(
    safeLoggedPath("/api/v1/sales/unsubscribe/private-token"),
    "/api/v1/sales/unsubscribe/[redacted]",
  );
  assert.equal(
    safeLoggedPath("/api/v1/sales/messages"),
    "/api/v1/sales/messages",
  );
});

test("mailbox sync refuses a fetched message without source so its cursor cannot skip it", async () => {
  await assert.rejects(parseSalesMailboxSource(undefined), /no source/);
  const parsed = await parseSalesMailboxSource(
    Buffer.from("From: sender@example.test\r\n\r\nMessage"),
  );
  assert.equal(parsed.text, "Message");
});

test("a STOP reply suppresses only a sender authenticated by the receiving mailbox", async () => {
  const message = async (
    header: string,
    body = "STOP",
    from = "buyer@example.test",
  ) =>
    simpleParser(
      `From: ${from}\r\nTo: sales@bjhlogistics.com\r\n${header}\r\n\r\n${body}`,
    );
  const mailbox = "sales@bjhlogistics.com";
  assert.equal(
    salesUnsubscribeReply(
      await message(
        "Authentication-Results: mx.example; dmarc=pass header.from=example.test",
      ),
      mailbox,
    ),
    "buyer@example.test",
  );
  assert.equal(
    salesUnsubscribeReply(
      await message(
        "Authentication-Results: mx.example; dmarc=fail header.from=example.test",
      ),
      mailbox,
    ),
    null,
  );
  assert.equal(salesUnsubscribeReply(await message(""), mailbox), null);
  assert.equal(
    salesUnsubscribeReply(
      await message(
        "Authentication-Results: receiving.example; dmarc=fail\r\nAuthentication-Results: sender.example; dmarc=pass",
      ),
      mailbox,
    ),
    null,
  );
  assert.equal(
    salesUnsubscribeReply(
      await message(
        "Authentication-Results: mx.example; dmarc=pass",
        "STOP",
        mailbox,
      ),
      mailbox,
    ),
    null,
  );
  assert.equal(
    salesUnsubscribeReply(
      await message(
        "Authentication-Results: mx.example; dmarc=pass",
        "Please stop by tomorrow",
      ),
      mailbox,
    ),
    null,
  );
});

test("SMTP errors distinguish permanent recipient rejection from uncertain handoff", () => {
  assert.deepEqual(
    salesSendFailure(
      Object.assign(new Error("Recipient rejected"), {
        command: "RCPT TO:<buyer@example.test>",
        permanent: true,
        responseCode: 550,
      }),
      "smtp",
    ),
    { status: "failed", bounce: true },
  );
  assert.deepEqual(
    salesSendFailure(
      Object.assign(new Error("Blocked by policy"), {
        command: "RCPT TO:<buyer@example.test>",
        permanent: true,
        responseCode: 550,
        response: "550 5.7.1 Sender IP has a poor reputation",
      }),
      "smtp",
    ),
    { status: "failed", bounce: false },
  );
  assert.deepEqual(
    salesSendFailure(
      Object.assign(new Error("Sender rejected"), {
        command: "MAIL FROM",
        permanent: true,
        responseCode: 550,
      }),
      "smtp",
    ),
    { status: "failed", bounce: false },
  );
  assert.deepEqual(
    salesSendFailure(new Error("Connection lost after DATA"), "smtp"),
    { status: "unknown", bounce: false },
  );
  assert.deepEqual(salesSendFailure(new Error("Stub failure"), "stub"), {
    status: "failed",
    bounce: false,
  });
});

test("a retried message replaces its previous generated unsubscribe footer", () => {
  const baseUrl = "https://api.example.test/api";
  const previousUrl = `${baseUrl}/v1/sales/unsubscribe/${"a".repeat(38)}`;
  const nextUrl = `${baseUrl}/v1/sales/unsubscribe/${"b".repeat(38)}`;
  const body = salesMessageBodyWithUnsubscribe(
    `Hello\n\nTo stop sales emails: ${previousUrl}`,
    baseUrl,
    nextUrl,
  );
  assert.equal(body, `Hello\n\nTo stop sales emails: ${nextUrl}`);
  assert.equal(
    salesMessageBodyWithUnsubscribe("Hello", baseUrl, nextUrl),
    `Hello\n\nTo stop sales emails: ${nextUrl}`,
  );
});

test("sales mailbox setup needs the dedicated IMAP account credentials", () => {
  assert.equal(salesMailboxFromEnvironment({}), null);
  assert.equal(
    salesMailboxFromEnvironment({
      INBOUND_OUTREACH_IMAP_HOST: "bjhlogistics.com",
      INBOUND_OUTREACH_IMAP_USER: "sales@bjhlogistics.com",
    }),
    null,
  );
  assert.deepEqual(
    salesMailboxFromEnvironment({
      INBOUND_OUTREACH_IMAP_HOST: " bjhlogistics.com ",
      INBOUND_OUTREACH_IMAP_PORT: "993",
      INBOUND_OUTREACH_IMAP_USER: "sales@bjhlogistics.com",
      INBOUND_OUTREACH_IMAP_PASSWORD: "synthetic-password",
    }),
    {
      host: "bjhlogistics.com",
      port: 993,
      user: "sales@bjhlogistics.com",
      password: "synthetic-password",
    },
  );
  for (const port of ["0", "65536", "not-a-port"]) {
    assert.equal(
      salesMailboxFromEnvironment({
        INBOUND_OUTREACH_IMAP_HOST: "bjhlogistics.com",
        INBOUND_OUTREACH_IMAP_PORT: port,
        INBOUND_OUTREACH_IMAP_USER: "sales@bjhlogistics.com",
        INBOUND_OUTREACH_IMAP_PASSWORD: "synthetic-password",
      }),
      null,
    );
  }
});

test("sales dispatch requires unsubscribe setup and sends the stored link", async () => {
  const previousKey = process.env.OUTREACH_UNSUBSCRIBE_KEY;
  const previousUrl = process.env.PUBLIC_API_URL;
  let claimed = 0;
  let storedBody = "";
  const database = {
    claimSalesEmailMessages: async () => {
      claimed += 1;
      return [
        {
          id: "00000000-0000-4000-8000-000000000001",
          recipientEmail: "person@example.test",
          subject: "Synthetic message",
          body: "Hello",
          inReplyTo: null,
          references: [],
        },
      ];
    },
    setSalesEmailSendingBody: async (_id: string, body: string) => {
      storedBody = body;
    },
    listSuppressedSalesEmails: async () => [],
    finishSalesEmailMessage: async () => undefined,
  } as unknown as DatabasePort;
  const provider = new RecordingEmailProvider();
  const mailbox = new SalesMailboxService(database, provider, storage);
  try {
    delete process.env.OUTREACH_UNSUBSCRIBE_KEY;
    delete process.env.PUBLIC_API_URL;
    assert.equal(await mailbox.dispatchQueued(), 0);
    assert.equal(claimed, 0);
    process.env.OUTREACH_UNSUBSCRIBE_KEY = Buffer.alloc(32, 7).toString("hex");
    process.env.PUBLIC_API_URL = "http://127.0.0.1:3001/api";
    assert.equal(await mailbox.dispatchQueued(), 1);
    assert.equal(claimed, 1);
    const sent = provider.sent[0];
    assert.ok(
      sent?.listUnsubscribeUrl?.startsWith(
        "http://127.0.0.1:3001/api/v1/sales/unsubscribe/",
      ),
    );
    assert.match(sent.text, /To stop sales emails: http:/);
    assert.equal(storedBody, sent.text);
  } finally {
    if (previousKey === undefined) delete process.env.OUTREACH_UNSUBSCRIBE_KEY;
    else process.env.OUTREACH_UNSUBSCRIBE_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previousUrl;
  }
});

test("production dispatch does not claim queued mail when SMTP is stubbed", async () => {
  const previousMode = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  let claimed = 0;
  const database = {
    claimSalesEmailMessages: async () => {
      claimed += 1;
      return [];
    },
  } as unknown as DatabasePort;
  try {
    assert.equal(
      await new SalesMailboxService(
        database,
        new RecordingEmailProvider(),
        storage,
      ).dispatchQueued(),
      0,
    );
    assert.equal(claimed, 0);
  } finally {
    if (previousMode === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousMode;
  }
});

test("SMTP includes one-click unsubscribe headers", async () => {
  const provider = new SmtpEmailProvider({
    host: "mail.example.test",
    port: 465,
    user: null,
    password: null,
    from: "sales@example.test",
  });
  let request: Record<string, unknown> | null = null;
  (
    provider as unknown as {
      transport: {
        sendMail: (
          message: Record<string, unknown>,
        ) => Promise<{ messageId: string }>;
      };
    }
  ).transport = {
    sendMail: async (message) => {
      request = message;
      return { messageId: "<synthetic@example.test>" };
    },
  };
  await provider.send({
    to: "person@example.test",
    subject: "Synthetic",
    text: "Hello",
    listUnsubscribeUrl:
      "https://api.example.test/api/v1/sales/unsubscribe/token",
  });
  const sent = request as Record<string, unknown> | null;
  assert.ok(sent);
  assert.deepEqual(sent.list, {
    unsubscribe: "https://api.example.test/api/v1/sales/unsubscribe/token",
  });
  assert.deepEqual(sent.headers, {
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  });
});

test("a pre-send preparation failure is recorded as failed, not an uncertain send", async () => {
  const previousKey = process.env.OUTREACH_UNSUBSCRIBE_KEY;
  const previousUrl = process.env.PUBLIC_API_URL;
  process.env.OUTREACH_UNSUBSCRIBE_KEY = Buffer.alloc(32, 7).toString("hex");
  process.env.PUBLIC_API_URL = "http://127.0.0.1:3001/api";
  let status = "";
  const database = {
    claimSalesEmailMessages: async () => [
      {
        id: "00000000-0000-4000-8000-000000000002",
        recipientEmail: "person@example.test",
        subject: "Synthetic",
        body: "Hello",
        inReplyTo: null,
        references: [],
      },
    ],
    setSalesEmailSendingBody: async () => {
      throw new Error("Synthetic database failure");
    },
    listSuppressedSalesEmails: async () => [],
    finishSalesEmailMessage: async (result: { status: string }) => {
      status = result.status;
    },
  } as unknown as DatabasePort;
  const provider = new RecordingEmailProvider();
  try {
    await new SalesMailboxService(database, provider, storage).dispatchQueued();
    assert.equal(status, "failed");
    assert.equal(provider.sent.length, 0);
  } finally {
    if (previousKey === undefined) delete process.env.OUTREACH_UNSUBSCRIBE_KEY;
    else process.env.OUTREACH_UNSUBSCRIBE_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previousUrl;
  }
});

test("an address suppressed after claim is not handed to SMTP", async () => {
  const previousKey = process.env.OUTREACH_UNSUBSCRIBE_KEY;
  const previousUrl = process.env.PUBLIC_API_URL;
  process.env.OUTREACH_UNSUBSCRIBE_KEY = Buffer.alloc(32, 7).toString("hex");
  process.env.PUBLIC_API_URL = "http://127.0.0.1:3001/api";
  let status = "";
  const database = {
    claimSalesEmailMessages: async () => [
      {
        id: "00000000-0000-4000-8000-000000000003",
        recipientEmail: "person@example.test",
        subject: "Synthetic",
        body: "Hello",
        inReplyTo: null,
        references: [],
      },
    ],
    setSalesEmailSendingBody: async () => undefined,
    listSuppressedSalesEmails: async () => ["person@example.test"],
    finishSalesEmailMessage: async (result: { status: string }) => {
      status = result.status;
    },
  } as unknown as DatabasePort;
  const provider = new RecordingEmailProvider();
  try {
    await new SalesMailboxService(database, provider, storage).dispatchQueued();
    assert.equal(status, "failed");
    assert.equal(provider.sent.length, 0);
  } finally {
    if (previousKey === undefined) delete process.env.OUTREACH_UNSUBSCRIBE_KEY;
    else process.env.OUTREACH_UNSUBSCRIBE_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previousUrl;
  }
});

test("synced attachments use private storage and a retry does not duplicate them", async () => {
  const parsed = await simpleParser(
    Buffer.from(
      [
        "From: sender@example.test",
        "MIME-Version: 1.0",
        'Content-Type: multipart/mixed; boundary="b"',
        "",
        "--b",
        "Content-Type: text/plain",
        "",
        "Hello",
        "--b",
        'Content-Type: application/pdf; name="invoice.pdf"',
        'Content-Disposition: attachment; filename="invoice.pdf"',
        "Content-Transfer-Encoding: base64",
        "",
        "JVBERi0xLjQ=",
        "--b--",
        "",
      ].join("\r\n"),
    ),
  );
  assert.equal(parsed.attachments.length, 1);
  const saved: Array<{
    partIndex: number;
    filename: string;
    objectKey: string | null;
  }> = [];
  const objects: Array<{ key: string; bytes: Buffer; contentType: string }> =
    [];
  const database = {
    hasSalesEmailAttachment: async (_id: string, index: number) =>
      saved.some((item) => item.partIndex === index),
    saveSalesEmailAttachment: async (input: {
      partIndex: number;
      filename: string;
      objectKey: string | null;
    }) => {
      saved.push(input);
    },
  } as unknown as DatabasePort;
  const privateStorage: DocumentStorage = {
    ...storage,
    put: async (key, bytes, contentType) => {
      objects.push({ key, bytes, contentType });
    },
  };
  const emailId = "00000000-0000-4000-8000-000000000004";
  await storeSalesEmailAttachments(
    emailId,
    parsed.attachments,
    database,
    privateStorage,
  );
  await storeSalesEmailAttachments(
    emailId,
    parsed.attachments,
    database,
    privateStorage,
  );
  assert.equal(saved.length, 1);
  assert.equal(saved[0].filename, "invoice.pdf");
  assert.equal(objects.length, 1);
  assert.ok(objects[0].key.startsWith(`sales-email/${emailId}/`));
  assert.equal(objects[0].contentType, "application/octet-stream");
  assert.equal(objects[0].bytes.toString(), "%PDF-1.4");
});

test("oversized attachments retain unavailable metadata without storing bytes", async () => {
  const saved: Array<{ objectKey: string | null; sizeBytes: number }> = [];
  const database = {
    hasSalesEmailAttachment: async () => false,
    saveSalesEmailAttachment: async (input: {
      objectKey: string | null;
      sizeBytes: number;
    }) => {
      saved.push(input);
    },
  } as unknown as DatabasePort;
  let uploaded = false;
  const privateStorage: DocumentStorage = {
    ...storage,
    put: async () => {
      uploaded = true;
    },
  };
  await storeSalesEmailAttachments(
    "00000000-0000-4000-8000-000000000005",
    [
      { filename: "large.bin", content: Buffer.alloc(25 * 1024 * 1024 + 1) },
    ] as Parameters<typeof storeSalesEmailAttachments>[1],
    database,
    privateStorage,
  );
  assert.equal(uploaded, false);
  assert.equal(saved[0].objectKey, null);
  assert.equal(saved[0].sizeBytes, 25 * 1024 * 1024 + 1);
});

test("mailbox messages keep threading headers and identify sent mail", async () => {
  const parsed = await simpleParser(
    Buffer.from(
      [
        "From: BJH Logistics <sales@bjhlogistics.com>",
        "To: Evans <evans@example.test>",
        "Cc: copy@example.test",
        "Message-ID: <mail-1@example.test>",
        "In-Reply-To: <mail-0@example.test>",
        "References: <mail-0@example.test> <mail-1@example.test>",
        "Date: Mon, 12 Nov 2026 10:00:00 +0000",
        "Subject: Setup check",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Synthetic message body",
      ].join("\r\n"),
    ),
  );
  const message = salesEmailFromParsed(
    parsed,
    "Sent",
    "23",
    7,
    "sales@bjhlogistics.com",
    new Date("2026-11-12T10:00:00Z"),
  );
  assert.equal(message.direction, "outgoing");
  assert.equal(message.fromEmail, "sales@bjhlogistics.com");
  assert.equal(message.messageId, "<mail-1@example.test>");
  assert.equal(message.inReplyTo, "<mail-0@example.test>");
  assert.deepEqual(message.references, [
    "<mail-0@example.test>",
    "<mail-1@example.test>",
  ]);
  assert.equal(message.to[0]?.email, "evans@example.test");
  assert.equal(message.cc[0]?.email, "copy@example.test");
  assert.equal(message.body, "Synthetic message body");
});

test("synced mail is fitted to the table limits so one odd message cannot stop the sync", async () => {
  const parsed = await simpleParser(
    Buffer.from(
      [
        `From: ${"a".repeat(260)}@example.test`,
        "To: sales@bjhlogistics.com",
        `Subject: ${"S".repeat(1200)}\u0000end`,
        "Message-ID: <odd@example.test>",
        "Content-Type: text/plain; charset=utf-8",
        "",
        "Body\u0000text",
      ].join("\r\n"),
    ),
  );
  const message = salesEmailFromParsed(
    parsed,
    "INBOX",
    "1",
    1,
    "sales@bjhlogistics.com",
    new Date("2026-11-12T10:00:00Z"),
  );
  assert.equal(message.subject.length <= 1000, true);
  assert.equal(message.subject.includes("\u0000"), false);
  assert.equal(message.body.includes("\u0000"), false);
  assert.equal(message.fromEmail, "unknown@invalid");
});
