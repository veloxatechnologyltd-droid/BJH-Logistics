import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { isPushEndpoint } from "@bjh/contracts";
import type { TeamKey } from "@bjh/contracts";
import { rolesForTeam, teamsFor } from "../src/team-chat/team-chat.service";
import { createPushProvider } from "../src/push/push-provider";

const teams: TeamKey[] = ["sales", "customer_service", "operations", "finance"];

test("the roles a team channel notifies are exactly the roles that are in it", () => {
  for (const team of teams) {
    // Everyone notified for a channel is a member of it ...
    for (const role of rolesForTeam(team)) {
      assert.ok(
        teamsFor([role]).includes(team),
        `${role} is notified for ${team} but is not in it`,
      );
    }
  }
  // ... and every role that puts someone in a channel is notified for it.
  for (const role of [
    "super_admin",
    "sales_rep",
    "customer_service_rep",
    "finance_rep",
    "import_rep",
    "export_rep",
    "air_import_rep",
    "air_export_rep",
    "sea_import_rep",
    "sea_export_rep",
  ] as const) {
    for (const team of teamsFor([role])) {
      assert.ok(
        rolesForTeam(team).includes(role),
        `${role} is in ${team} but is not notified for it`,
      );
    }
  }
});

test("only browser push services are accepted as an address", () => {
  for (const good of [
    "https://fcm.googleapis.com/fcm/send/abc",
    "https://updates.push.services.mozilla.com/wpush/v2/abc",
    "https://web.push.apple.com/abc",
    "https://wns2-par02p.notify.windows.com/w/?token=abc",
  ]) {
    assert.equal(isPushEndpoint(good), true, good);
  }
  for (const bad of [
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://fcm.googleapis.com.evil.example/abc",
    "https://evilfcm.googleapis.com/abc",
    "https://127.0.0.1/abc",
    "https://169.254.169.254/latest/meta-data",
    "https://localhost:3001/abc",
    "https://a:b@fcm.googleapis.com/abc",
    "javascript:alert(1)",
    "",
  ]) {
    assert.equal(isPushEndpoint(bad), false, bad);
  }
});

test("push is off unless all three VAPID settings are present", () => {
  assert.equal(createPushProvider({}).publicKey, null);
  assert.equal(
    createPushProvider({ VAPID_PUBLIC_KEY: "only-this" }).publicKey,
    null,
  );
  assert.equal(createPushProvider({}).name, "stub");
});
