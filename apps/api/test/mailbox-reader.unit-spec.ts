import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { simpleParser } from "mailparser";
import {
  inboundFromMail,
  mailboxFromEnvironment,
} from "../src/intake/mailbox-reader.service";

const setup = {
  INBOUND_IMAP_HOST: "mail.example.test",
  INBOUND_IMAP_USER: "requests@example.test",
  INBOUND_IMAP_PASSWORD: "not-a-real-password",
  INBOUND_IMAP_SINCE: "2026-10-28T09:00:00Z",
};

test("the mailbox is read only when host, user, password and a valid start time are set", () => {
  const ready = mailboxFromEnvironment(setup);
  assert.deepEqual(ready, {
    host: "mail.example.test",
    port: 993,
    user: "requests@example.test",
    password: "not-a-real-password",
    mailbox: "INBOX",
    since: new Date("2026-10-28T09:00:00Z"),
  });
  assert.equal(
    mailboxFromEnvironment({ ...setup, INBOUND_IMAP_PORT: "143" })?.port,
    143,
  );
  for (const missing of Object.keys(setup)) {
    assert.equal(
      mailboxFromEnvironment({ ...setup, [missing]: "" }),
      null,
      missing,
    );
  }
  // Without a clear start time an old inbox could be imported, so reading stays off.
  assert.equal(
    mailboxFromEnvironment({ ...setup, INBOUND_IMAP_SINCE: "soon" }),
    null,
  );
});

const raw = [
  'From: "Synthetic Buyer" <Buyer@Example.test>',
  "To: requests@example.test",
  "Subject: Rate for 2 x 40ft",
  "Message-ID: <rate-1@example.test>",
  "Date: Tue, 28 Oct 2026 10:00:00 +0000",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="mixed"',
  "",
  "--mixed",
  'Content-Type: multipart/related; boundary="related"',
  "",
  "--related",
  "Content-Type: text/html; charset=utf-8",
  "",
  '<p>Please quote 2 x 40ft Shanghai to Tema.</p><img src="cid:logo">',
  "--related",
  "Content-Type: image/png",
  "Content-ID: <logo>",
  "Content-Transfer-Encoding: base64",
  "",
  "iVBORw0KGgo=",
  "--related--",
  "--mixed",
  'Content-Type: application/pdf; name="packing-list.pdf"',
  'Content-Disposition: attachment; filename="packing-list.pdf"',
  "Content-Transfer-Encoding: base64",
  "",
  Buffer.from("%PDF-1.4 synthetic").toString("base64"),
  "--mixed--",
  "",
].join("\r\n");

test("an email from the mailbox becomes the webhook's fields; embedded pictures are not attachments", async () => {
  const received = new Date("2026-10-28T10:00:05Z");
  const { fields, files } = inboundFromMail(
    await simpleParser(Buffer.from(raw)),
    received,
  );
  assert.equal(fields.from_email, "Buyer@Example.test");
  assert.equal(fields.from_name, "Synthetic Buyer");
  assert.equal(fields.to, "requests@example.test");
  assert.equal(fields.subject, "Rate for 2 x 40ft");
  assert.equal(fields.message_id, "<rate-1@example.test>");
  assert.equal(fields.received_at, "2026-10-28T10:00:05.000Z");
  // An HTML-only email: the intake turns the HTML into text.
  assert.match(String(fields.html), /Please quote 2 x 40ft Shanghai to Tema/);
  assert.deepEqual(
    files.map((file) => [file.originalname, file.buffer.toString()]),
    [["packing-list.pdf", "%PDF-1.4 synthetic"]],
  );
});
