import { BadRequestException, Injectable } from "@nestjs/common";
import * as dns from "dns";
import * as net from "net";

export interface ValidatedWebhookTarget {
  url: URL;
  hostname: string;
  port: number;
  resolvedAddresses: Array<{ address: string; family: 4 | 6 }>;
}

export type DnsLookupFn = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

const DEFAULT_LOOKUP: DnsLookupFn = (hostname: string) =>
  dns.promises.lookup(hostname, { all: true, verbatim: true });

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata",
  "instance-data",
]);

const BLOCKED_HOSTNAME_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".home.arpa",
  ".localdomain",
];

/**
 * Parse a dotted-quad IPv4 string into an unsigned 32-bit integer.
 * Returns null if the string is not a canonical 4-octet IPv4 address.
 */
export function parseIpv4ToUint32(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d*)$/.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = ((result << 8) | octet) >>> 0;
  }
  return result >>> 0;
}

function inCidrv4(ipUint32: number, baseIp: string, prefixLen: number): boolean {
  const base = parseIpv4ToUint32(baseIp);
  if (base === null) return false;
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ipUint32 & mask) >>> 0 === (base & mask) >>> 0;
}

/**
 * Expand an IPv6 address into 8 16-bit words (0..0xffff), or null if invalid.
 */
export function parseIpv6Words(ip: string): number[] | null {
  // Strip zone index if present (e.g. fe80::1%eth0)
  const zoneIdx = ip.indexOf("%");
  const clean = (zoneIdx !== -1 ? ip.slice(0, zoneIdx) : ip).toLowerCase();

  if (!clean || clean.includes(":::")) return null;

  let working = clean;
  // Handle embedded IPv4 tail (e.g. ::ffff:127.0.0.1 or ::ffff:169.254.169.254)
  const lastColon = working.lastIndexOf(":");
  if (lastColon !== -1 && working.slice(lastColon + 1).includes(".")) {
    const ipv4Part = working.slice(lastColon + 1);
    const v4 = parseIpv4ToUint32(ipv4Part);
    if (v4 === null) return null;
    const hi = ((v4 >>> 16) & 0xffff).toString(16);
    const lo = (v4 & 0xffff).toString(16);
    working = `${working.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const doubleColonParts = working.split("::");
  if (doubleColonParts.length > 2) return null;

  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const tokens = side.split(":");
    const nums: number[] = [];
    for (const t of tokens) {
      if (!/^[0-9a-f]{1,4}$/.test(t)) return null;
      nums.push(parseInt(t, 16));
    }
    return nums;
  };

  if (doubleColonParts.length === 1) {
    const words = parseSide(doubleColonParts[0]);
    return words && words.length === 8 ? words : null;
  }

  const left = parseSide(doubleColonParts[0]);
  const right = parseSide(doubleColonParts[1]);
  if (!left || !right) return null;
  const missing = 8 - (left.length + right.length);
  if (missing < 1) return null;
  return [...left, ...new Array(missing).fill(0), ...right];
}

/**
 * Returns true if the given IPv4 or IPv6 literal belongs to a loopback,
 * private, link-local, cloud-metadata, CGNAT, multicast,unspecified, or
 * reserved address range.
 */
export function isBlockedIpAddress(ip: string): boolean {
  const trimmed = ip.trim().replace(/^\[|\]$/g, "");
  const v4 = parseIpv4ToUint32(trimmed);
  if (v4 !== null) {
    return (
      inCidrv4(v4, "0.0.0.0", 8) || // "This" network (RFC 1122)
      inCidrv4(v4, "10.0.0.0", 8) || // Private-use (RFC 1918)
      inCidrv4(v4, "100.64.0.0", 10) || // Shared / CGNAT (RFC 6598)
      inCidrv4(v4, "127.0.0.0", 8) || // Loopback (RFC 1122)
      inCidrv4(v4, "169.254.0.0", 16) || // Link-local + cloud metadata 169.254.169.254 (RFC 3927)
      inCidrv4(v4, "172.16.0.0", 12) || // Private-use (RFC 1918)
      inCidrv4(v4, "192.0.0.0", 24) || // IETF Protocol Assignments (RFC 6890)
      inCidrv4(v4, "192.0.2.0", 24) || // TEST-NET-1 (RFC 5737)
      inCidrv4(v4, "192.88.99.0", 24) || // 6to4 relay anycast (RFC 7526)
      inCidrv4(v4, "192.168.0.0", 16) || // Private-use (RFC 1918)
      inCidrv4(v4, "198.18.0.0", 15) || // Benchmarking (RFC 2544)
      inCidrv4(v4, "198.51.100.0", 24) || // TEST-NET-2 (RFC 5737)
      inCidrv4(v4, "203.0.113.0", 24) || // TEST-NET-3 (RFC 5737)
      inCidrv4(v4, "224.0.0.0", 4) || // Multicast (RFC 5771)
      inCidrv4(v4, "240.0.0.0", 4) // Reserved + broadcast 255.255.255.255
    );
  }

  const words = parseIpv6Words(trimmed);
  if (!words) {
    // Fail closed on unparseable IP strings
    return true;
  }

  const isAllZeroPrefix = (count: number) =>
    words.slice(0, count).every((w) => w === 0);

  // Unspecified ::/128
  if (isAllZeroPrefix(8)) return true;

  // Loopback ::1/128
  if (isAllZeroPrefix(7) && words[7] === 1) return true;

  // IPv4-mapped ::ffff:0:0/96 or IPv4-compatible ::/96
  if (isAllZeroPrefix(5) && (words[5] === 0xffff || words[5] === 0)) {
    const embeddedV4 = ((words[6] << 16) | words[7]) >>> 0;
    const dotted = [
      (embeddedV4 >>> 24) & 0xff,
      (embeddedV4 >>> 16) & 0xff,
      (embeddedV4 >>> 8) & 0xff,
      embeddedV4 & 0xff,
    ].join(".");
    return isBlockedIpAddress(dotted);
  }

  // IPv4-translated ::ffff:0:0:0/96 (RFC 2765)
  if (
    words[0] === 0 &&
    words[1] === 0 &&
    words[2] === 0 &&
    words[3] === 0 &&
    words[4] === 0xffff &&
    words[5] === 0
  ) {
    const embeddedV4 = ((words[6] << 16) | words[7]) >>> 0;
    const dotted = [
      (embeddedV4 >>> 24) & 0xff,
      (embeddedV4 >>> 16) & 0xff,
      (embeddedV4 >>> 8) & 0xff,
      embeddedV4 & 0xff,
    ].join(".");
    return isBlockedIpAddress(dotted);
  }

  // NAT64 well-known prefix 64:ff9b::/96 and 64:ff9b:1::/48
  if (words[0] === 0x0064 && words[1] === 0xff9b) {
    const embeddedV4 = ((words[6] << 16) | words[7]) >>> 0;
    const dotted = [
      (embeddedV4 >>> 24) & 0xff,
      (embeddedV4 >>> 16) & 0xff,
      (embeddedV4 >>> 8) & 0xff,
      embeddedV4 & 0xff,
    ].join(".");
    return isBlockedIpAddress(dotted);
  }

  // 6to4 2002::/16 embeds an IPv4 address in words[1..2]
  if (words[0] === 0x2002) {
    const embeddedV4 = ((words[1] << 16) | words[2]) >>> 0;
    const dotted = [
      (embeddedV4 >>> 24) & 0xff,
      (embeddedV4 >>> 16) & 0xff,
      (embeddedV4 >>> 8) & 0xff,
      embeddedV4 & 0xff,
    ].join(".");
    return isBlockedIpAddress(dotted);
  }

  // Teredo 2001:0000::/32
  if (words[0] === 0x2001 && words[1] === 0x0000) return true;

  // Documentation 2001:db8::/32
  if (words[0] === 0x2001 && words[1] === 0x0db8) return true;

  // Discard-only 100::/64
  if (words[0] === 0x0100 && words[1] === 0 && words[2] === 0 && words[3] === 0)
    return true;

  // Unique local fc00::/7 (fc00..fdff)
  if ((words[0] & 0xfe00) === 0xfc00) return true;

  // Link-local fe80::/10 (fe80..febf)
  if ((words[0] & 0xffc0) === 0xfe80) return true;

  // Site-local deprecated fec0::/10
  if ((words[0] & 0xffc0) === 0xfec0) return true;

  // Multicast ff00::/8
  if ((words[0] & 0xff00) === 0xff00) return true;

  return false;
}

/**
 * Detect obfuscated numeric/octal/hex host encodings such as `127.1`,
 * `0x7f000001`, `2130706433`, or `0177.0.0.1` that URL parsers may normalize.
 */
function hasObfuscatedIpHostname(rawUrl: string, parsedHost: string): boolean {
  // Check raw host authority before URL normalization
  const match = rawUrl.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]+)/);
  if (match) {
    const authority = match[1];
    const hostPort = authority.includes("@")
      ? authority.slice(authority.lastIndexOf("@") + 1)
      : authority;
    const rawHost = hostPort.startsWith("[")
      ? hostPort.slice(0, hostPort.indexOf("]") + 1)
      : hostPort.split(":")[0];

    // Pure integer host (e.g. 2130706433) or hex host (0x7f000001)
    if (/^\d+$/.test(rawHost) || /^0x[0-9a-f]+$/i.test(rawHost)) {
      return true;
    }

    // Dotted quad with fewer than 4 parts of all-digits/hex/octal (e.g. 127.1)
    const labels = rawHost.split(".");
    if (
      labels.length >= 2 &&
      labels.every(
        (l) => /^\d+$/.test(l) || /^0x[0-9a-f]+$/i.test(l) || /^0[0-7]+$/.test(l),
      )
    ) {
      if (labels.length !== 4) return true;
      // Reject leading-zero octal octets like 0177.0.0.1
      if (labels.some((l) => l.length > 1 && l.startsWith("0"))) return true;
    }
  }

  if (/^\d+$/.test(parsedHost) || /^0x[0-9a-f]+$/i.test(parsedHost)) {
    return true;
  }

  return false;
}

@Injectable()
export class WebhookUrlValidatorService {
  private lookupFn: DnsLookupFn = DEFAULT_LOOKUP;

  /**
   * Override the DNS lookup implementation (used in unit tests to remain offline).
   */
  setLookupFn(fn: DnsLookupFn): void {
    this.lookupFn = fn;
  }

  private isInsecureHttpAllowed(): boolean {
    const env = process.env.NODE_ENV || "production";
    if (process.env.WEBHOOK_ALLOW_INSECURE_HTTP === "true" && env !== "production") {
      return true;
    }
    return env === "development";
  }

  private isPrivateNetworkOptOutEnabled(): boolean {
    const env = process.env.NODE_ENV || "production";
    return (
      env !== "production" &&
      process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS === "true"
    );
  }

  private getAllowedPorts(protocol: string): Set<number> {
    const ports = new Set<number>();
    if (protocol === "https:") {
      ports.add(443);
    } else if (protocol === "http:") {
      ports.add(80);
      ports.add(443);
    }

    const extra = process.env.WEBHOOK_ALLOWED_PORTS;
    if (extra) {
      for (const token of extra.split(",")) {
        const parsed = Number(token.trim());
        if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
          ports.add(parsed);
        }
      }
    }
    return ports;
  }

  /**
   * Validate a webhook URL at subscription registration/update time or right
   * before outbound delivery (defeating DNS rebinding).
   */
  async validateWebhookUrl(rawUrl: string): Promise<ValidatedWebhookTarget> {
    if (!rawUrl || typeof rawUrl !== "string") {
      throw new BadRequestException("Webhook URL must be a non-empty string");
    }

    const trimmed = rawUrl.trim();
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      throw new BadRequestException("Invalid webhook URL format");
    }

    // 1. Scheme allowlist
    const protocol = parsed.protocol.toLowerCase();
    const allowHttp = this.isInsecureHttpAllowed();
    if (protocol !== "https:" && !(allowHttp && protocol === "http:")) {
      throw new BadRequestException(
        `Webhook URL scheme "${protocol.replace(":", "")}" is not allowed; use https`,
      );
    }

    // 2. Reject embedded credentials (user:pass@host)
    if (parsed.username || parsed.password) {
      throw new BadRequestException(
        "Webhook URL must not contain embedded credentials",
      );
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname) {
      throw new BadRequestException("Webhook URL must include a valid hostname");
    }

    // 3. Port validation
    const effectivePort = parsed.port
      ? Number(parsed.port)
      : protocol === "https:"
        ? 443
        : 80;
    const allowedPorts = this.getAllowedPorts(protocol);
    if (!allowedPorts.has(effectivePort)) {
      throw new BadRequestException(
        `Webhook URL port ${effectivePort} is not permitted`,
      );
    }

    if (this.isPrivateNetworkOptOutEnabled()) {
      return {
        url: parsed,
        hostname,
        port: effectivePort,
        resolvedAddresses: [],
      };
    }

    // 4. Reject obfuscated numeric/octal/hex IP encodings and reserved hostnames
    if (hasObfuscatedIpHostname(trimmed, hostname)) {
      throw new BadRequestException(
        "Webhook URL hostname uses a disallowed numeric or obfuscated IP encoding",
      );
    }

    if (
      BLOCKED_HOSTNAMES.has(hostname) ||
      BLOCKED_HOSTNAME_SUFFIXES.some((s) => hostname.endsWith(s))
    ) {
      throw new BadRequestException(
        `Webhook URL hostname "${hostname}" is not permitted`,
      );
    }

    // 5. Direct IP literal check
    const ipVersion = net.isIP(hostname);
    if (ipVersion === 4 || ipVersion === 6) {
      if (isBlockedIpAddress(hostname)) {
        throw new BadRequestException(
          `Webhook URL target IP "${hostname}" is in a forbidden private, loopback, or reserved range`,
        );
      }
      return {
        url: parsed,
        hostname,
        port: effectivePort,
        resolvedAddresses: [{ address: hostname, family: ipVersion }],
      };
    }

    // 6. Resolve DNS and verify every A/AAAA record is globally routable
    let records: Array<{ address: string; family: number }>;
    try {
      records = await this.lookupFn(hostname);
    } catch {
      throw new BadRequestException(
        `Webhook URL hostname "${hostname}" could not be resolved`,
      );
    }

    if (!Array.isArray(records) || records.length === 0) {
      throw new BadRequestException(
        `Webhook URL hostname "${hostname}" resolved to no addresses`,
      );
    }

    const validated: Array<{ address: string; family: 4 | 6 }> = [];
    for (const rec of records) {
      const addr = rec?.address;
      const family = rec?.family === 6 ? 6 : 4;
      if (!addr || isBlockedIpAddress(addr)) {
        throw new BadRequestException(
          `Webhook URL hostname "${hostname}" resolves to a forbidden internal or reserved IP address`,
        );
      }
      validated.push({ address: addr, family });
    }

    return {
      url: parsed,
      hostname,
      port: effectivePort,
      resolvedAddresses: validated,
    };
  }
}
