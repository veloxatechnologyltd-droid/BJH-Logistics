import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

/**
 * Reads one public web page. The address comes from a search result, so it is
 * untrusted: a site must not be able to point this server at BJH's own network, the
 * cloud metadata address or localhost. Three guards:
 * - only http(s) on the ordinary ports (80 and 443);
 * - the address a name resolves to is checked when the connection is made (not
 *   before, so a name that changes its answer cannot slip past), and a name with any
 *   non-public address is refused outright;
 * - every redirect is checked the same way, and there are at most three.
 * Pages are read up to a size limit with a time limit, as plain HTML (no scripts run).
 */

export interface FetchedPage {
  /** The address the page was finally read from, after redirects. */
  url: string;
  html: string;
}

export interface PageFetcher {
  /** The page, or null when it cannot be read (blocked, missing, not HTML, too slow). */
  fetchPage(url: string): Promise<FetchedPage | null>;
}

function ipv4Octets(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  return octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ? octets
    : null;
}

function isPublicIpv4([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
  if (a === 169 && b === 254) return false; // link local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

/** The eight 16-bit groups of an IPv6 address, or null if it is not one. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase().split("%")[0];
  // A dotted IPv4 tail ("::ffff:1.2.3.4") is two more groups.
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const octets = ipv4Octets(tail[1]);
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = text.slice(0, -tail[1].length) + `${high}:${low}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [
    ...head,
    ...Array(halves.length === 2 ? missing : 0).fill("0"),
    ...rest,
  ];
  const numbers = groups.map((group) => parseInt(group, 16));
  return numbers.length === 8 &&
    numbers.every((n, i) => /^[0-9a-f]{1,4}$/.test(groups[i]) && n <= 0xffff)
    ? numbers
    : null;
}

/** True only for an address on the public internet. Anything unparsable is not public. */
export function isPublicAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "");
  if (net.isIPv4(bare)) {
    const octets = ipv4Octets(bare);
    return octets !== null && isPublicIpv4(octets);
  }
  if (!net.isIPv6(bare)) return false;
  const groups = ipv6Groups(bare);
  if (!groups) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  // IPv4 inside IPv6 (mapped ::ffff:a.b.c.d): judge the IPv4 address.
  if (
    g0 === 0 &&
    g1 === 0 &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0xffff
  ) {
    return isPublicIpv4([g6 >> 8, g6 & 255, g7 >> 8, g7 & 255]);
  }
  // Only global unicast (2000::/3) is public, less the ranges that are not routable
  // or that carry an IPv4 address inside (documentation, Teredo, 6to4).
  if ((g0 & 0xe000) !== 0x2000) return false;
  if (g0 === 0x2001 && (g1 === 0x0db8 || g1 === 0)) return false;
  if (g0 === 0x2002) return false;
  return true;
}

/** `dns.lookup` that fails unless every address the name resolves to is public. */
export function publicOnlyLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (
    error: NodeJS.ErrnoException | null,
    address: string | dns.LookupAddress[],
    family?: number,
  ) => void,
): void {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    if (
      addresses.length === 0 ||
      addresses.some((entry) => !isPublicAddress(entry.address))
    ) {
      return callback(new Error("blocked: not a public address"), "");
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

/** Null unless this is an http(s) address on an ordinary port for a public host. */
export function checkedUrl(
  raw: string,
  ports: number[] = [80, 443],
): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (url.port !== "" && !ports.includes(Number(url.port))) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) !== 0) return isPublicAddress(host) ? url : null;
  if (host === "localhost" || host.endsWith(".localhost")) return null;
  return url;
}

export interface PublicWebPageFetcherOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Replaced in tests; the default refuses non-public addresses. */
  lookup?: typeof publicOnlyLookup;
  /** Ports a site may use besides the default; tests only. */
  ports?: number[];
}

const USER_AGENT = "BJH-Logistics-LeadFinder/1.0 (public contact pages only)";

export class PublicWebPageFetcher implements PageFetcher {
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;
  private readonly lookup: typeof publicOnlyLookup;
  private readonly ports: number[];

  constructor(options: PublicWebPageFetcherOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxBytes = options.maxBytes ?? 500_000;
    this.maxRedirects = options.maxRedirects ?? 3;
    this.lookup = options.lookup ?? publicOnlyLookup;
    this.ports = options.ports ?? [80, 443];
  }

  async fetchPage(start: string): Promise<FetchedPage | null> {
    let url = checkedUrl(start, this.ports);
    for (let hop = 0; url && hop <= this.maxRedirects; hop++) {
      const outcome = await this.fetchOnce(url).catch(() => null);
      if (!outcome) return null;
      if (outcome.kind === "page") return { url: url.href, html: outcome.html };
      url = checkedUrl(new URL(outcome.location, url).href, this.ports);
    }
    return null;
  }

  private fetchOnce(
    url: URL,
  ): Promise<
    | { kind: "page"; html: string }
    | { kind: "redirect"; location: string }
    | null
  > {
    const transport = url.protocol === "https:" ? https : http;
    return new Promise((resolveOnce, rejectOnce) => {
      // The socket timeout is for silence; this one is for a server that drips bytes.
      const overall = setTimeout(
        () => request.destroy(new Error("too slow")),
        this.timeoutMs * 2,
      );
      const resolve: typeof resolveOnce = (value) => {
        clearTimeout(overall);
        resolveOnce(value);
      };
      const reject = (error: unknown) => {
        clearTimeout(overall);
        rejectOnce(error);
      };
      const request = transport.request(
        url,
        {
          method: "GET",
          lookup: this.lookup as never,
          timeout: this.timeoutMs,
          headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
            "accept-encoding": "gzip, deflate, br",
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const location = response.headers.location;
          if (status >= 300 && status < 400 && location) {
            response.resume();
            return resolve({ kind: "redirect", location });
          }
          const type = String(
            response.headers["content-type"] ?? "",
          ).toLowerCase();
          const readable =
            type === "" ||
            type.includes("text/html") ||
            type.includes("application/xhtml");
          if (status < 200 || status >= 300 || !readable) {
            response.resume();
            return resolve(null);
          }
          const encoding = String(
            response.headers["content-encoding"] ?? "",
          ).toLowerCase();
          const decoder =
            encoding === "gzip" || encoding === "x-gzip"
              ? zlib.createGunzip()
              : encoding === "deflate"
                ? zlib.createInflate()
                : encoding === "br"
                  ? zlib.createBrotliDecompress()
                  : null;
          if (encoding && encoding !== "identity" && !decoder) {
            response.resume();
            return resolve(null);
          }
          const body = decoder ? response.pipe(decoder) : response;
          decoder?.on("error", () => resolve(null));
          const chunks: Buffer[] = [];
          let size = 0;
          body.on("data", (chunk: Buffer) => {
            size += chunk.length;
            // Past the limit, what was read is enough; the rest is not downloaded.
            if (size > this.maxBytes) {
              chunks.push(
                chunk.subarray(0, chunk.length - (size - this.maxBytes)),
              );
              request.destroy();
              resolve({
                kind: "page",
                html: Buffer.concat(chunks).toString("utf8"),
              });
              return;
            }
            chunks.push(chunk);
          });
          body.on("end", () =>
            resolve({
              kind: "page",
              html: Buffer.concat(chunks).toString("utf8"),
            }),
          );
          body.on("error", () => resolve(null));
        },
      );
      request.on("timeout", () => request.destroy(new Error("timeout")));
      request.on("error", reject);
      request.end();
    });
  }
}
