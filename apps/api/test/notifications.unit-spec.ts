import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizePhone } from "../src/notifications/phone";
import {
  deliveryDispatchedMessage,
  etaMessage,
  formatGhanaTime,
  invoiceIssuedMessage,
  milestoneMessage,
  paymentReceivedMessage,
  quoteIssuedMessage,
  staffMessage,
} from "../src/notifications/notification-messages";
import {
  ArkeselSmsProvider,
  RecordingEmailProvider,
  RecordingSmsProvider,
  createEmailProvider,
  createInquiryEmailProvider,
  createSmsProvider,
} from "../src/notifications/providers";
import {
  MAX_ATTEMPTS,
  retryDelaySeconds,
} from "../src/notifications/notification-dispatcher.service";
import { publicWebUrl } from "../src/notifications/notifications.service";

test("Ghana numbers are normalised however they are typed", () => {
  for (const typed of [
    "0244058592",
    "024 405 8592",
    "024-405-8592",
    "233244058592",
    "00233244058592",
    "+233 24 405 8592",
    "+233244058592",
    " (024) 405 8592 ",
  ]) {
    assert.equal(normalizePhone(typed), "+233244058592", typed);
  }
});

test("other international numbers need a plus or 00, and bad numbers are refused", () => {
  assert.equal(normalizePhone("+44 7700 900123"), "+447700900123");
  assert.equal(normalizePhone("0044 7700 900123"), "+447700900123");
  for (const bad of [
    "",
    "abc",
    "12345",
    "24405859",
    "0244058",
    "+233 24 405",
    "2440585921234",
  ]) {
    assert.equal(normalizePhone(bad), null, bad);
  }
});

test("times in messages are Ghana time and messages carry the reference", () => {
  assert.equal(
    formatGhanaTime("2026-10-05T06:00:00Z"),
    "5 Oct 2026, 06:00 (Ghana time)",
  );
  const milestone = milestoneMessage(
    "BJH",
    "BJH/SI/2026/0004",
    "Cargo arrived",
  );
  assert.equal(milestone.subject, "BJH/SI/2026/0004: Cargo arrived");
  assert.match(
    milestone.smsText,
    /^BJH: BJH\/SI\/2026\/0004 - Cargo arrived\.$/,
  );
  assert.match(
    etaMessage("BJH", "BJH/SI/2026/0004", "2026-10-05T06:00:00Z").smsText,
    /5 Oct 2026, 06:00/,
  );
});

test("money in messages always shows two decimals", () => {
  const invoice = invoiceIssuedMessage(
    "BJH",
    "BJH/INV/2026/0001",
    287736,
    "GHS",
    "2026-10-25",
  );
  assert.match(invoice.body, /GHS 2,877\.36/);
  assert.match(invoice.smsText, /due 2026-10-25/);
  const payment = paymentReceivedMessage(
    "BJH",
    "BJH/RCT/2026/0001",
    "BJH/INV/2026/0001",
    100000,
    187736,
    "GHS",
  );
  assert.match(payment.body, /GHS 1,000\.00/);
  assert.match(payment.body, /receipt BJH\/RCT\/2026\/0001/);
  assert.match(payment.smsText, /Balance GHS 1,877\.36/);
});

test("quote email tells first-time customers how to get account details", () => {
  const message = quoteIssuedMessage("BJH Logistics", "BJH/Q/SI/2026/0001");
  assert.match(message.body, /attached as a PDF/);
  assert.match(
    message.body,
    /first time signing in, please contact BJH Logistics for your customer account details\./,
  );
  assert.match(message.body, /customer portal below/);
});

test("a dispatch message names the waybill, driver and vehicle", () => {
  const message = deliveryDispatchedMessage(
    "BJH",
    "BJH/WB/2026/0001",
    "Kofi",
    "0244058592",
    "GX 1-26",
    "Kumasi",
  );
  for (const part of ["BJH/WB/2026/0001", "Kofi", "0244058592", "GX 1-26"]) {
    assert.ok(message.smsText.includes(part), part);
  }
  assert.ok(message.body.includes("Kumasi"));
});

test("a staff message uses its subject or a default, and the SMS is kept short", () => {
  assert.equal(
    staffMessage("BJH", null, "Hello").subject,
    "A message from BJH",
  );
  assert.equal(staffMessage("BJH", "Update", "Hello").subject, "Update");
  assert.ok(staffMessage("BJH", null, "x".repeat(2000)).smsText.length <= 480);
});

test("without credentials the providers are stubs that send nothing", async () => {
  const email = createEmailProvider({});
  const sms = createSmsProvider({});
  assert.equal(email.name, "stub");
  assert.equal(sms.name, "stub");
  assert.ok(email instanceof RecordingEmailProvider);
  assert.ok(sms instanceof RecordingSmsProvider);
  assert.equal(createSmsProvider({ ARKESEL_API_KEY: "key" }).name, "arkesel");
  assert.equal(
    createEmailProvider({
      EMAIL_SMTP_HOST: "mail.example.test",
      EMAIL_FROM: "BJH <noreply@example.test>",
    }).name,
    "smtp",
  );
  // A host without a sender address is not enough to send real mail.
  assert.equal(
    createEmailProvider({ EMAIL_SMTP_HOST: "mail.example.test" }).name,
    "stub",
  );
  assert.equal(
    createSmsProvider({ ARKESEL_API_KEY: "key", SMS_PROVIDER: "stub" }).name,
    "stub",
  );
});

test("Arkesel is called as its API describes and failures are reported", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify({ status: "success", data: { id: "msg_1" } }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const provider = new ArkeselSmsProvider({
      apiKey: "secret-key",
      senderId: "BJHLogistics",
    });
    const result = await provider.send({ to: "+233244058592", text: "Hello" });
    assert.equal(result.providerMessageId, "msg_1");
    assert.equal(calls[0].url, "https://sms.arkesel.com/api/v2/sms/send");
    assert.equal(calls[0].init.method, "POST");
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers["api-key"], "secret-key");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      sender: "BJHLogistics",
      message: "Hello",
      recipients: ["+233244058592"],
    });

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ status: "error", message: "Invalid sender" }),
        { status: 400 },
      )) as typeof fetch;
    await assert.rejects(
      provider.send({ to: "+233244058592", text: "Hello" }),
      /Arkesel rejected the message \(400: Invalid sender\)/,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("failed deliveries back off and are given up after five attempts", () => {
  assert.equal(MAX_ATTEMPTS, 5);
  assert.deepEqual([1, 2, 3, 4].map(retryDelaySeconds), [60, 240, 540, 960]);
});

test("links use the configured public address", () => {
  assert.equal(
    publicWebUrl({ PUBLIC_WEB_URL: "https://app.example.test/" }),
    "https://app.example.test",
  );
  assert.equal(
    publicWebUrl({ WEB_ORIGIN: "http://a.test,http://b.test" }),
    "http://a.test",
  );
  assert.equal(publicWebUrl({}), "http://127.0.0.1:3002");
});

test("replies to inquiries go out from the inquiries mailbox, never from the quote one", async () => {
  // No mail server: a stub, as for every message.
  assert.equal(createInquiryEmailProvider({}).name, "stub");
  const mail = {
    EMAIL_SMTP_HOST: "mail.example.test",
    EMAIL_FROM: "BJH <quote@example.test>",
  };
  // Mail is set up but not the inquiries sender: the delivery fails and says why.
  await assert.rejects(
    createInquiryEmailProvider(mail).send({
      to: "a@b.example",
      subject: "s",
      text: "t",
    }),
    /inquiries mailbox is not set up for sending/,
  );
  const inquiries = createInquiryEmailProvider({
    ...mail,
    EMAIL_INQUIRY_FROM: "BJH <inquiries@example.test>",
    EMAIL_INQUIRY_SMTP_USER: "inquiries@example.test",
    EMAIL_INQUIRY_SMTP_PASSWORD: "not-real",
  });
  assert.equal(inquiries.name, "smtp");
  assert.equal(
    (inquiries as unknown as { from: string }).from,
    "BJH <inquiries@example.test>",
  );
});
