import assert from "node:assert/strict";
import { test } from "node:test";
import { contentSecurityPolicy } from "./contentSecurityPolicy.ts";

const hosted = {
  NEXT_PUBLIC_API_BASE_URL: "https://api.example.test/api",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.example",
};

test("scripts need this request's nonce and nothing inline is allowed", () => {
  const policy = contentSecurityPolicy("abc123", hosted);
  assert.match(policy, /script-src 'self' 'nonce-abc123' 'strict-dynamic'/);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval/);
});

test("connections are limited to the app, the API and Supabase", () => {
  const policy = contentSecurityPolicy("n", hosted);
  const connect = /connect-src ([^;]+)/.exec(policy)?.[1].split(" ");
  assert.deepEqual(connect, [
    "'self'",
    "https://api.example.test",
    "wss://api.example.test",
    "https://project.supabase.example",
    "wss://project.supabase.example",
  ]);
});

test("a missing or invalid address is left out, never widened to everything", () => {
  const policy = contentSecurityPolicy("n", {
    NEXT_PUBLIC_API_BASE_URL: "not a url",
  });
  assert.match(policy, /connect-src 'self'$/);
  assert.doesNotMatch(policy, /\*|https?:(?!\/)/);
});

test("a local API address works for development builds", () => {
  const policy = contentSecurityPolicy("n", {
    NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:3001/api",
  });
  assert.match(policy, /http:\/\/127\.0\.0\.1:3001 ws:\/\/127\.0\.0\.1:3001/);
});
