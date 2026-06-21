/**
 * Totp — pure RFC 6238 (TOTP) + RFC 4226 (HOTP) implementation with backup codes, for 2FA (issue #53).
 *
 * Dependency-free except Node's built-in `crypto`. No DB / Nest DI, so the algorithm is unit-testable
 * against the published RFC test vectors and reusable by the auth service, guards, and recovery flow.
 *
 * Covers the cryptographic core of #53:
 *   - Base32 secret generation (Google Authenticator / Authy compatible)
 *   - HOTP + TOTP code generation and constant-time verification with a configurable time window
 *   - otpauth:// provisioning URI (the payload a QR code encodes)
 *   - Single-use backup codes: generation + salted hashing + constant-time check
 *
 * QR-image rendering, persistence, admin enforcement and email notifications are integration concerns
 * built on top of these primitives.
 */
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export interface TotpOptions {
  digits?: number; // default 6
  period?: number; // seconds, default 30
  algorithm?: "sha1" | "sha256" | "sha512"; // default sha1 (authenticator standard)
}

const DEFAULTS = { digits: 6, period: 30, algorithm: "sha1" as const };

export class Totp {
  // ── Base32 (RFC 4648, no padding) ──────────────────────────────────────────
  static base32Encode(buf: Buffer): string {
    let bits = 0;
    let value = 0;
    let out = "";
    for (const byte of buf) {
      value = (value << 8) | byte;
      bits += 8;
      while (bits >= 5) {
        out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    return out;
  }

  static base32Decode(input: string): Buffer {
    const clean = input.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
    let bits = 0;
    let value = 0;
    const out: number[] = [];
    for (const ch of clean) {
      const idx = BASE32_ALPHABET.indexOf(ch);
      if (idx === -1) throw new Error(`invalid base32 character: ${ch}`);
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        out.push((value >>> (bits - 8)) & 0xff);
        bits -= 8;
      }
    }
    return Buffer.from(out);
  }

  /** Generate a random base32 secret (default 20 bytes = 160 bits, the RFC-recommended size). */
  static generateSecret(bytes = 20): string {
    return this.base32Encode(randomBytes(bytes));
  }

  // ── HOTP (RFC 4226) ─────────────────────────────────────────────────────────
  static hotp(secret: string, counter: number, opts: TotpOptions = {}): string {
    const { digits, algorithm } = { ...DEFAULTS, ...opts };
    const key = this.base32Decode(secret);
    const buf = Buffer.alloc(8);
    // 64-bit big-endian counter
    buf.writeBigUInt64BE(BigInt(counter));
    const hmac = createHmac(algorithm, key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const binary =
      ((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff);
    return (binary % 10 ** digits).toString().padStart(digits, "0");
  }

  // ── TOTP (RFC 6238) ───────────────────────────────────────────────────────
  static counterAt(timeMs: number, period: number): number {
    return Math.floor(timeMs / 1000 / period);
  }

  static generate(
    secret: string,
    opts: TotpOptions = {},
    nowMs: number = Date.now(),
  ): string {
    const { period } = { ...DEFAULTS, ...opts };
    return this.hotp(secret, this.counterAt(nowMs, period), opts);
  }

  /**
   * Verify a token allowing ±`window` periods of clock drift (default 1 → accepts the previous,
   * current and next 30s step). Constant-time comparison; returns true on any in-window match.
   */
  static verify(
    token: string,
    secret: string,
    opts: TotpOptions & { window?: number } = {},
    nowMs: number = Date.now(),
  ): boolean {
    const { period, digits } = { ...DEFAULTS, ...opts };
    const window = opts.window ?? 1;
    const candidate = (token ?? "").trim();
    if (candidate.length !== digits) return false;
    const counter = this.counterAt(nowMs, period);
    for (let w = -window; w <= window; w++) {
      const expected = this.hotp(secret, counter + w, opts);
      if (this.constantTimeEqual(candidate, expected)) return true;
    }
    return false;
  }

  /** otpauth:// provisioning URI — the string a QR code encodes for the authenticator app. */
  static provisioningUri(
    secret: string,
    accountName: string,
    issuer: string,
    opts: TotpOptions = {},
  ): string {
    const { digits, period, algorithm } = { ...DEFAULTS, ...opts };
    const label = encodeURIComponent(`${issuer}:${accountName}`);
    const params = new URLSearchParams({
      secret,
      issuer,
      algorithm: algorithm.toUpperCase(),
      digits: String(digits),
      period: String(period),
    });
    return `otpauth://totp/${label}?${params.toString()}`;
  }

  // ── Backup codes ────────────────────────────────────────────────────────────
  /** Generate N single-use backup codes (formatted xxxx-xxxx). Store only the hashes. */
  static generateBackupCodes(count = 10): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      const raw = randomBytes(4).toString("hex"); // 8 hex chars
      codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
    }
    return codes;
  }

  /** Salted SHA-256 hash of a backup code for at-rest storage. */
  static hashBackupCode(code: string, salt: string): string {
    return createHash("sha256")
      .update(`${salt}:${this.normalizeCode(code)}`)
      .digest("hex");
  }

  /** Constant-time check of a presented backup code against a stored hash. */
  static verifyBackupCode(code: string, salt: string, storedHash: string): boolean {
    return this.constantTimeEqual(this.hashBackupCode(code, salt), storedHash);
  }

  private static normalizeCode(code: string): string {
    return (code ?? "").trim().toLowerCase().replace(/-/g, "");
  }

  /** Length-safe constant-time string comparison. */
  static constantTimeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a ?? "", "utf8");
    const bb = Buffer.from(b ?? "", "utf8");
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
