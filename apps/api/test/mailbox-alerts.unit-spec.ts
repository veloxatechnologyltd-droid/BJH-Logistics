import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MailboxAlerts,
  isRecipientProblem,
  watchSending,
} from "../src/notifications/mailbox-alerts";
import {
  RecordingEmailProvider,
  type EmailProvider,
} from "../src/notifications/providers";

/** A "real" (non-stub) sender that records, or fails with the given error. */
function sender(fail?: unknown) {
  const recorder = new RecordingEmailProvider();
  return {
    sent: recorder.sent,
    fail,
    provider: {
      name: "smtp",
      async send(message) {
        if (fail) throw fail;
        return recorder.send(message);
      },
    } as EmailProvider,
  };
}

const authError = Object.assign(
  new Error("Invalid login: 535 Invalid Username or Password"),
  {
    code: "EAUTH",
    responseCode: 535,
  },
);

test("a broken quotes mailbox is reported once, through sales, then its recovery", async () => {
  const quotes = sender();
  const sales = sender();
  const alerts = new MailboxAlerts("john@example.test", {
    quotes: quotes.provider,
    sales: sales.provider,
  });

  await alerts.failed("quotes", "sending", "535 Invalid Username or Password");
  await alerts.failed("quotes", "sending", "535 Invalid Username or Password");
  assert.equal(quotes.sent.length, 0);
  assert.equal(sales.sent.length, 1);
  assert.equal(sales.sent[0].to, "john@example.test");
  assert.match(sales.sent[0].subject, /Quotes mailbox cannot send/);
  assert.match(sales.sent[0].text, /535 Invalid Username or Password/);

  await alerts.recovered("quotes", "sending");
  await alerts.recovered("quotes", "sending");
  assert.equal(sales.sent.length, 2);
  assert.match(sales.sent[1].subject, /Quotes mailbox is sending email again/);
});

test("a broken sales mailbox is reported through quotes", async () => {
  const quotes = sender();
  const sales = sender();
  const alerts = new MailboxAlerts("john@example.test", {
    quotes: quotes.provider,
    sales: sales.provider,
  });
  await alerts.failed("sales", "reading", "AUTHENTICATIONFAILED");
  assert.equal(sales.sent.length, 0);
  assert.equal(quotes.sent.length, 1);
  assert.match(quotes.sent[0].subject, /Sales mailbox cannot read/);
});

test("sending and reading are separate problems", async () => {
  const sales = sender();
  const alerts = new MailboxAlerts("john@example.test", {
    quotes: sender().provider,
    sales: sales.provider,
  });
  await alerts.failed("quotes", "sending", "x");
  await alerts.failed("quotes", "reading", "x");
  await alerts.failed("inquiries", "sending", "x");
  assert.equal(sales.sent.length, 3);
});

test("an alert that could not be sent is tried again on the next failure", async () => {
  const sales = sender();
  let down = true;
  const flaky: EmailProvider = {
    name: "smtp",
    async send(message) {
      if (down) throw new Error("down too");
      return sales.provider.send(message);
    },
  };
  const alerts = new MailboxAlerts("john@example.test", {
    quotes: sender().provider,
    sales: flaky,
  });
  await alerts.failed("quotes", "sending", "x");
  // Nothing was reported, so recovery says nothing either.
  await alerts.recovered("quotes", "sending");
  assert.equal(sales.sent.length, 0);

  await alerts.failed("quotes", "sending", "x");
  assert.equal(sales.sent.length, 0);
  down = false;
  await alerts.failed("quotes", "sending", "x");
  assert.equal(sales.sent.length, 1);
});

test("without ALERT_EMAIL or a real other mailbox, nobody is emailed", async () => {
  const sales = sender();
  await new MailboxAlerts(null, {
    quotes: sender().provider,
    sales: sales.provider,
  }).failed("quotes", "sending", "x");
  assert.equal(sales.sent.length, 0);

  const stub = new RecordingEmailProvider();
  await new MailboxAlerts("john@example.test", {
    quotes: sender().provider,
    sales: stub,
  }).failed("quotes", "sending", "x");
  assert.equal(stub.sent.length, 0);
});

test("a single bad recipient is not a broken mailbox", () => {
  assert.equal(isRecipientProblem(authError), false);
  assert.equal(isRecipientProblem(new Error("connection refused")), false);
  assert.equal(
    isRecipientProblem({
      code: "EENVELOPE",
      response: "550 5.1.1 no such user",
    }),
    true,
  );
  assert.equal(
    isRecipientProblem({ command: "RCPT TO", response: "550 5.1.1 unknown" }),
    true,
  );
  assert.equal(
    isRecipientProblem({
      command: "RCPT TO",
      response: "550 5.7.1 relay denied",
    }),
    false,
  );
});

test("watched senders report mailbox failures and recovery, not recipient rejections", async () => {
  const calls: string[] = [];
  const alerts = {
    failed: async (mailbox: string, action: string, reason: string) => {
      calls.push(`failed ${mailbox} ${action} ${reason}`);
    },
    recovered: async (mailbox: string, action: string) => {
      calls.push(`recovered ${mailbox} ${action}`);
    },
  } as unknown as MailboxAlerts;
  const message = { to: "a@example.test", subject: "s", text: "t" };

  await assert.rejects(
    watchSending(sender(authError).provider, "quotes", alerts).send(message),
  );
  await assert.rejects(
    watchSending(
      sender({ code: "EENVELOPE", response: "550 no such user" }).provider,
      "quotes",
      alerts,
    ).send(message),
  );
  await watchSending(sender().provider, "quotes", alerts).send(message);
  assert.deepEqual(calls, [
    "failed quotes sending Invalid login: 535 Invalid Username or Password",
    "recovered quotes sending",
  ]);

  const stub = new RecordingEmailProvider();
  assert.equal(watchSending(stub, "quotes", alerts), stub);
});
