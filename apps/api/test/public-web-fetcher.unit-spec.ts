import "reflect-metadata";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import zlib from "node:zlib";
import {
  PublicWebPageFetcher,
  checkedUrl,
  isPublicAddress,
  publicOnlyLookup,
} from "../src/leads/public-web-fetcher";

test("only addresses on the public internet are public", () => {
  for (const address of [
    "8.8.8.8",
    "154.161.10.20",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
  ]) {
    assert.equal(isPublicAddress(address), true, address);
  }
  for (const address of [
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:7f00:1",
    "2001:db8::1",
    "2002:c0a8:0101::1",
    "64:ff9b::7f00:1",
    "not an address",
    "999.1.1.1",
    "",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress("[2606:4700:4700::1111]"), true);
});

test("addresses are refused unless they are http(s) on an ordinary port to a public host", () => {
  assert.ok(checkedUrl("https://synthetic.example/contact"));
  assert.ok(checkedUrl("http://synthetic.example:80/"));
  assert.ok(checkedUrl("https://8.8.8.8/"));
  for (const refused of [
    "file:///etc/passwd",
    "ftp://synthetic.example/",
    "gopher://synthetic.example/",
    "javascript:alert(1)",
    "http://localhost/",
    "http://app.localhost/",
    "http://127.0.0.1/",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/",
    "https://synthetic.example:8443/",
    "http://synthetic.example:22/",
    "http://user:pass@synthetic.example/",
    "not a url",
  ]) {
    assert.equal(checkedUrl(refused), null, refused);
  }
});

test("a name that resolves to a private address is refused when connecting", async () => {
  for (const options of [{}, { all: true }]) {
    const outcome = await new Promise<string>((resolve) =>
      publicOnlyLookup("localhost", options, (error) =>
        resolve(error ? error.message : "allowed"),
      ),
    );
    assert.match(outcome, /blocked/, JSON.stringify(options));
  }
});

// A local web server stands in for a site. Its name is mapped to 127.0.0.1 by an
// injected lookup, and its port is allowed, which the default fetcher never does.
const hits: string[] = [];
let siteServer: http.Server;
let internalServer: http.Server;
let sitePort = 0;
let internalPort = 0;

const lookupLocal = ((
  _hostname: string,
  options: { all?: boolean },
  callback: (e: null, a: unknown, f?: number) => void,
) =>
  options.all
    ? callback(null, [{ address: "127.0.0.1", family: 4 }])
    : callback(null, "127.0.0.1", 4)) as never;

before(async () => {
  internalServer = http.createServer((request, response) => {
    hits.push(`internal${request.url}`);
    response.end("<p>secret@internal.example</p>");
  });
  await new Promise<void>((done) =>
    internalServer.listen(0, "127.0.0.1", done),
  );
  internalPort = (internalServer.address() as AddressInfo).port;

  siteServer = http.createServer((request, response) => {
    hits.push(`site${request.url}`);
    switch (request.url) {
      case "/ok":
        response.setHeader("content-type", "text/html; charset=utf-8");
        return void response.end("<p>info@synthetic.example</p>");
      case "/gzip":
        response.writeHead(200, {
          "content-type": "text/html",
          "content-encoding": "gzip",
        });
        return void response.end(
          zlib.gzipSync("<p>zipped@synthetic.example</p>"),
        );
      case "/big":
        response.setHeader("content-type", "text/html");
        return void response.end("x".repeat(2_000));
      case "/pdf":
        response.setHeader("content-type", "application/pdf");
        return void response.end("%PDF");
      case "/missing":
        response.statusCode = 404;
        return void response.end("nope");
      case "/hop1":
        response.writeHead(302, { location: "/hop2" });
        return void response.end();
      case "/hop2":
        response.writeHead(302, { location: "/hop3" });
        return void response.end();
      case "/hop3":
        response.writeHead(302, { location: "/hop4" });
        return void response.end();
      case "/hop4":
        response.writeHead(302, { location: "/ok" });
        return void response.end();
      case "/redirect-ok":
        response.writeHead(301, { location: "/ok" });
        return void response.end();
      case "/redirect-internal":
        response.writeHead(302, {
          location: `http://127.0.0.1:${internalPort}/metadata`,
        });
        return void response.end();
      case "/redirect-file":
        response.writeHead(302, { location: "file:///etc/passwd" });
        return void response.end();
      case "/drip":
        response.setHeader("content-type", "text/html");
        response.write("<p>slow");
        return; // never ends
      default:
        response.statusCode = 500;
        response.end();
    }
  });
  await new Promise<void>((done) => siteServer.listen(0, "127.0.0.1", done));
  sitePort = (siteServer.address() as AddressInfo).port;
});

after(() => {
  siteServer.closeAllConnections();
  siteServer.close();
  internalServer.close();
});

const site = (path: string) => `http://synthetic.example:${sitePort}${path}`;
const fetcher = (extra: object = {}) =>
  new PublicWebPageFetcher({
    lookup: lookupLocal,
    ports: [sitePort],
    timeoutMs: 1_000,
    ...extra,
  });

test("a page is read as text, with compression and redirects followed", async () => {
  assert.deepEqual(await fetcher().fetchPage(site("/ok")), {
    url: site("/ok"),
    html: "<p>info@synthetic.example</p>",
  });
  assert.equal(
    (await fetcher().fetchPage(site("/gzip")))?.html,
    "<p>zipped@synthetic.example</p>",
  );
  const redirected = await fetcher().fetchPage(site("/redirect-ok"));
  assert.equal(redirected?.url, site("/ok"), "the final address is reported");
});

test("pages that are missing, not HTML, or too many redirects away are not read", async () => {
  assert.equal(await fetcher().fetchPage(site("/missing")), null);
  assert.equal(await fetcher().fetchPage(site("/pdf")), null);
  assert.equal(
    await fetcher().fetchPage(site("/hop1")),
    null,
    "four redirects is too many",
  );
  assert.ok(await fetcher({ maxRedirects: 4 }).fetchPage(site("/hop1")));
});

test("a page larger than the limit is cut, not downloaded whole", async () => {
  const page = await fetcher({ maxBytes: 500 }).fetchPage(site("/big"));
  assert.equal(page?.html.length, 500);
});

test("a server that never finishes is given up on", async () => {
  const started = Date.now();
  assert.equal(
    await fetcher({ timeoutMs: 300 }).fetchPage(site("/drip")),
    null,
  );
  assert.ok(Date.now() - started < 3_000);
});

test("redirects to internal addresses and other schemes are never followed", async () => {
  hits.length = 0;
  assert.equal(await fetcher().fetchPage(site("/redirect-internal")), null);
  assert.equal(await fetcher().fetchPage(site("/redirect-file")), null);
  assert.ok(
    !hits.some((hit) => hit.startsWith("internal")),
    "the internal server was never contacted",
  );
});

test("with the default guards, local servers are never contacted at all", async () => {
  hits.length = 0;
  const strict = new PublicWebPageFetcher({ timeoutMs: 1_000 });
  assert.equal(await strict.fetchPage(`http://127.0.0.1:${sitePort}/ok`), null);
  assert.equal(await strict.fetchPage(`http://localhost:${sitePort}/ok`), null);
  // A name that resolves to loopback gets as far as the connection and is refused there.
  const named = new PublicWebPageFetcher({
    ports: [sitePort],
    timeoutMs: 1_000,
  });
  assert.equal(await named.fetchPage(`http://localhost:${sitePort}/ok`), null);
  assert.deepEqual(hits, []);
});
