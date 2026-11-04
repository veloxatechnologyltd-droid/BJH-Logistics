import assert from "node:assert/strict";
import { test } from "node:test";
import { uint8ArrayToUrlBase64, urlBase64ToUint8Array } from "./pushKey.ts";

// A real-looking VAPID public key: 65 bytes, so 87 base64url characters.
const key =
  "BEl62iUYgUivxIkv69yViEuiBIa-ib37J8xQmeqvH_8y4Nv9m6l2HkWQz5qvk3Yh5Gc0y6VLrVvQqWx2ZJNgyIc";

test("turns a VAPID key into the bytes a browser subscribes with, and back", () => {
  const bytes = urlBase64ToUint8Array(key);
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 0x04, "an uncompressed P-256 point starts with 4");
  assert.equal(uint8ArrayToUrlBase64(bytes), key);
});

test("accepts keys with or without padding, and the + and / forms", () => {
  assert.deepEqual(
    urlBase64ToUint8Array("-_-_"),
    urlBase64ToUint8Array("+/+/"),
  );
  assert.deepEqual(urlBase64ToUint8Array("YQ"), urlBase64ToUint8Array("YQ=="));
  assert.equal(uint8ArrayToUrlBase64(new Uint8Array([97])), "YQ");
});
