import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { StaffAuthDirectory } from "../src/auth/staff-admin.port";
import { TeamChatService } from "../src/team-chat/team-chat.service";

test("team chat reuses staff names instead of asking Supabase Auth on every refresh", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 0 });
  const asked: string[] = [];
  const auth = {
    getUser: async (id: string) => {
      asked.push(id);
      return id === "gone"
        ? null
        : { id, email: `${id}@example.test`, name: `Name ${id}` };
    },
  } as unknown as StaffAuthDirectory;
  const service = new TeamChatService({} as never, auth, {} as never);
  const names = (ids: string[]) =>
    (
      service as unknown as {
        names(ids: string[]): Promise<Map<string, string>>;
      }
    ).names(ids);

  const first = await names(["a", "b", "gone", "a"]);
  assert.deepEqual([...first.keys()], ["a", "b"]);
  assert.deepEqual(asked, ["a", "b", "gone"]);

  await names(["a", "b", "gone"]);
  assert.equal(asked.length, 3, "a refresh within minutes asks nothing");

  t.mock.timers.tick(5 * 60_000);
  await names(["a"]);
  assert.deepEqual(asked.slice(3), ["a"], "an old name is looked up again");
});
