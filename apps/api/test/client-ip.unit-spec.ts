import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { clientAddress } from "../src/auth/client-ip-throttler.guard";

test("without CLIENT_IP_HEADER the socket address is used and the header is ignored", () => {
  const request = {
    ip: "10.0.0.5",
    headers: { "cf-connecting-ip": "203.0.113.9" },
  };
  assert.equal(clientAddress(request, {}), "10.0.0.5");
});

test("with CLIENT_IP_HEADER the named header is the address", () => {
  const request = {
    ip: "10.0.0.5",
    headers: { "cf-connecting-ip": " 203.0.113.9 " },
  };
  assert.equal(
    clientAddress(request, { CLIENT_IP_HEADER: "CF-Connecting-IP" }),
    "203.0.113.9",
  );
});

test("a repeated header uses its first value", () => {
  const request = {
    ip: "10.0.0.5",
    headers: { "cf-connecting-ip": ["203.0.113.9", "198.51.100.1"] },
  };
  assert.equal(
    clientAddress(request, { CLIENT_IP_HEADER: "cf-connecting-ip" }),
    "203.0.113.9",
  );
});

test("a missing or blank header falls back to the socket address", () => {
  const environment = { CLIENT_IP_HEADER: "cf-connecting-ip" };
  assert.equal(
    clientAddress({ ip: "10.0.0.5", headers: {} }, environment),
    "10.0.0.5",
  );
  assert.equal(
    clientAddress(
      { ip: "10.0.0.5", headers: { "cf-connecting-ip": "  " } },
      environment,
    ),
    "10.0.0.5",
  );
  assert.equal(clientAddress({ headers: {} }, environment), "unknown");
});
