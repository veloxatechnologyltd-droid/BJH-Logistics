import assert from "node:assert/strict";
import { test } from "node:test";
import {
  emailAuthentication,
  emailAuthenticationPolicy,
  mayJoinChat,
} from "../src/intake/email-authentication";

const sender = "ama@client.example";

test("a DMARC pass, or a DKIM pass signed by the sender's own domain, is a pass", () => {
  assert.equal(
    emailAuthentication(
      "mx.bjh.example; dkim=pass header.d=client.example; spf=pass; dmarc=pass header.from=client.example",
      sender,
    ),
    "pass",
  );
  assert.equal(
    emailAuthentication(
      "mx.bjh.example; dkim=pass header.d=client.example header.s=sel",
      sender,
    ),
    "pass",
  );
  // A subdomain of the signer counts as the signer's own.
  assert.equal(
    emailAuthentication(
      "mx.bjh.example; dkim=pass header.d=client.example",
      "ama@mail.client.example",
    ),
    "pass",
  );
});

test("a DKIM pass for somebody else's domain is not a pass", () => {
  assert.equal(
    emailAuthentication(
      "mx.bjh.example; dkim=pass header.d=attacker.example; spf=none",
      sender,
    ),
    "unknown",
  );
  assert.equal(
    emailAuthentication(
      "mx.bjh.example; dkim=pass header.d=attacker.example; dmarc=fail",
      sender,
    ),
    "fail",
  );
});

test("a failed DMARC, DKIM or SPF check without a pass is a fail", () => {
  assert.equal(
    emailAuthentication("mx.bjh.example; spf=fail; dmarc=fail", sender),
    "fail",
  );
  assert.equal(
    emailAuthentication("mx.bjh.example; dkim=fail", sender),
    "fail",
  );
  assert.equal(emailAuthentication("mx.bjh.example; spf=fail", sender), "fail");
  // A softfail alone is only a warning.
  assert.equal(
    emailAuthentication("mx.bjh.example; spf=softfail", sender),
    "unknown",
  );
});

test("a DMARC pass beats a failed SPF or DKIM check (forwarded mail)", () => {
  assert.equal(
    emailAuthentication(
      "mx.bjh.example; spf=fail; dkim=fail; dmarc=pass",
      sender,
    ),
    "pass",
  );
});

test("no header, an empty one or none results are unknown", () => {
  assert.equal(emailAuthentication(undefined, sender), "unknown");
  assert.equal(emailAuthentication("", sender), "unknown");
  assert.equal(emailAuthentication("mx.bjh.example; none", sender), "unknown");
  assert.equal(emailAuthentication([], sender), "unknown");
});

test("only the topmost header, added by the receiving server, is believed", () => {
  assert.equal(
    emailAuthentication(
      [
        "mx.bjh.example; dmarc=fail; spf=fail",
        "forged.example; dkim=pass header.d=client.example; dmarc=pass",
      ],
      sender,
    ),
    "fail",
  );
});

test("the policy defaults to refusing only failures; require and off are explicit", () => {
  assert.equal(emailAuthenticationPolicy({}), "reject_failures");
  assert.equal(
    emailAuthenticationPolicy({ CHAT_EMAIL_AUTH: " Require " }),
    "require",
  );
  assert.equal(emailAuthenticationPolicy({ CHAT_EMAIL_AUTH: "off" }), "off");
  assert.equal(
    emailAuthenticationPolicy({ CHAT_EMAIL_AUTH: "nonsense" }),
    "reject_failures",
  );
  assert.equal(mayJoinChat("fail", "reject_failures"), false);
  assert.equal(mayJoinChat("unknown", "reject_failures"), true);
  assert.equal(mayJoinChat("pass", "reject_failures"), true);
  assert.equal(mayJoinChat("unknown", "require"), false);
  assert.equal(mayJoinChat("pass", "require"), true);
  assert.equal(mayJoinChat("fail", "off"), true);
});
