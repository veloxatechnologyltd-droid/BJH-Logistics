import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createEmailProvider,
  createOutreachEmailProvider,
  SmtpEmailProvider,
  sentCopyTarget,
} from "../src/notifications/providers";

function provider(
  sentCopy: ConstructorParameters<typeof SmtpEmailProvider>[0]["sentCopy"],
) {
  const smtp = new SmtpEmailProvider({
    host: "mail.example.test",
    port: 465,
    user: null,
    password: null,
    from: "sales@example.test",
    sentCopy,
  });
  (
    smtp as unknown as {
      transport: { sendMail: () => Promise<{ messageId: string }> };
    }
  ).transport = {
    sendMail: async () => ({ messageId: "<synthetic@example.test>" }),
  };
  return smtp;
}

const message = {
  to: "person@example.test",
  subject: "Synthetic",
  text: "Hello",
};

test("a Sent copy needs the IMAP server and the mailbox login", () => {
  assert.equal(sentCopyTarget(undefined, "993", "u", "p"), undefined);
  assert.equal(
    sentCopyTarget("imap.example.test", "993", null, "p"),
    undefined,
  );
  assert.equal(
    sentCopyTarget("imap.example.test", "993", "u", undefined),
    undefined,
  );
  assert.deepEqual(sentCopyTarget(" imap.example.test ", undefined, "u", "p"), {
    host: "imap.example.test",
    port: 993,
    user: "u",
    password: "p",
  });
});

test("each real sender is set up to file Sent copies only when its IMAP server is known", () => {
  const smtp = {
    EMAIL_SMTP_HOST: "mail.example.test",
    EMAIL_FROM: "quotes@example.test",
    EMAIL_SMTP_USER: "quotes@example.test",
    EMAIL_SMTP_PASSWORD: "secret",
  };
  const sentCopyOf = (email: unknown) =>
    (email as { sentCopy?: unknown }).sentCopy;
  assert.equal(sentCopyOf(createEmailProvider(smtp)), undefined);
  assert.deepEqual(
    sentCopyOf(
      createEmailProvider({ ...smtp, INBOUND_IMAP_HOST: "imap.example.test" }),
    ),
    {
      host: "imap.example.test",
      port: 993,
      user: "quotes@example.test",
      password: "secret",
    },
  );
  assert.deepEqual(
    sentCopyOf(
      createOutreachEmailProvider({
        EMAIL_OUTREACH_SMTP_HOST: "mail.example.test",
        EMAIL_OUTREACH_SMTP_USER: "sales@example.test",
        EMAIL_OUTREACH_SMTP_PASSWORD: "other",
        EMAIL_OUTREACH_FROM: "sales@example.test",
        INBOUND_OUTREACH_IMAP_HOST: "imap.example.test",
      }),
    ),
    {
      host: "imap.example.test",
      port: 993,
      user: "sales@example.test",
      password: "other",
    },
  );
});

test("the Sent copy is the message that went out, with its Message-ID", async () => {
  const smtp = provider({
    host: "imap.example.test",
    port: 993,
    user: "u",
    password: "p",
  });
  let filed: { messageId: string | undefined; subject: unknown } | null = null;
  (
    smtp as unknown as {
      fileSentCopy: (
        target: unknown,
        mail: { subject: unknown },
        messageId: string | undefined,
      ) => Promise<void>;
    }
  ).fileSentCopy = async (_target, mail, messageId) => {
    filed = { messageId, subject: mail.subject };
  };
  const result = await smtp.send(message);
  assert.equal(result.providerMessageId, "<synthetic@example.test>");
  assert.deepEqual(filed, {
    messageId: "<synthetic@example.test>",
    subject: "Synthetic",
  });
});

test("an email that went out is still a success when its Sent copy cannot be filed", async () => {
  // Nothing listens on port 1, so the real IMAP connection is refused.
  const smtp = provider({
    host: "127.0.0.1",
    port: 1,
    user: "u",
    password: "p",
  });
  const result = await smtp.send(message);
  assert.equal(result.providerMessageId, "<synthetic@example.test>");
});

test("no Sent copy is attempted without a Sent copy login", async () => {
  const smtp = provider(undefined);
  (smtp as unknown as { fileSentCopy: () => Promise<void> }).fileSentCopy =
    async () => {
      throw new Error("must not be called");
    };
  const result = await smtp.send(message);
  assert.equal(result.providerMessageId, "<synthetic@example.test>");
});
