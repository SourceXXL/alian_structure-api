import { Totp } from "./totp";

// RFC 6238 Appendix B test seed (ASCII "12345678901234567890") as a base32 secret.
const RFC_SECRET = Totp.base32Encode(Buffer.from("12345678901234567890", "ascii"));

describe("Totp", () => {
  describe("base32", () => {
    it("round-trips arbitrary bytes", () => {
      const buf = Buffer.from("hello world", "utf8");
      expect(Totp.base32Decode(Totp.base32Encode(buf)).equals(buf)).toBe(true);
    });
    it("rejects invalid characters", () => {
      expect(() => Totp.base32Decode("0189!")).toThrow();
    });
  });

  describe("generateSecret", () => {
    it("produces a decodable base32 secret of the requested size", () => {
      const s = Totp.generateSecret(20);
      expect(Totp.base32Decode(s).length).toBe(20);
    });
    it("produces distinct secrets", () => {
      expect(Totp.generateSecret()).not.toBe(Totp.generateSecret());
    });
  });

  describe("RFC 6238 test vectors (SHA1, 6 digits)", () => {
    // 8-digit RFC codes -> last 6 digits for the default 6-digit config
    const cases: Array<[number, string]> = [
      [59, "287082"],
      [1111111109, "081804"],
      [1234567890, "005924"],
      [2000000000, "279037"],
    ];
    it.each(cases)("at T=%i seconds -> %s", (t, expected) => {
      expect(Totp.generate(RFC_SECRET, {}, t * 1000)).toBe(expected);
    });
  });

  describe("verify", () => {
    it("accepts the current code", () => {
      const now = 1234567890 * 1000;
      const code = Totp.generate(RFC_SECRET, {}, now);
      expect(Totp.verify(code, RFC_SECRET, {}, now)).toBe(true);
    });
    it("accepts a code one step old within the drift window", () => {
      const now = 1234567890 * 1000;
      const prev = Totp.generate(RFC_SECRET, {}, now - 30 * 1000);
      expect(Totp.verify(prev, RFC_SECRET, { window: 1 }, now)).toBe(true);
    });
    it("rejects a code outside the window", () => {
      const now = 1234567890 * 1000;
      const old = Totp.generate(RFC_SECRET, {}, now - 5 * 60 * 1000);
      expect(Totp.verify(old, RFC_SECRET, { window: 1 }, now)).toBe(false);
    });
    it("rejects a wrong-length / garbage token", () => {
      const now = Date.now();
      expect(Totp.verify("123", RFC_SECRET, {}, now)).toBe(false);
      expect(Totp.verify("abcdef", RFC_SECRET, {}, now)).toBe(false);
    });
  });

  describe("provisioningUri", () => {
    it("builds a valid otpauth URI with issuer + secret", () => {
      const uri = Totp.provisioningUri(RFC_SECRET, "alice@example.com", "Alian");
      expect(uri.startsWith("otpauth://totp/")).toBe(true);
      expect(uri).toContain(`secret=${RFC_SECRET}`);
      expect(uri).toContain("issuer=Alian");
      expect(uri).toContain("Alian%3Aalice%40example.com");
    });
  });

  describe("backup codes", () => {
    it("generates the requested number of formatted single-use codes", () => {
      const codes = Totp.generateBackupCodes(10);
      expect(codes).toHaveLength(10);
      codes.forEach((c) => expect(c).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/));
      expect(new Set(codes).size).toBe(10); // unique
    });
    it("verifies a hashed backup code and rejects a wrong one", () => {
      const [code] = Totp.generateBackupCodes(1);
      const salt = "user-salt";
      const hash = Totp.hashBackupCode(code, salt);
      expect(Totp.verifyBackupCode(code, salt, hash)).toBe(true);
      expect(Totp.verifyBackupCode("0000-0000", salt, hash)).toBe(false);
    });
    it("normalizes formatting/casing when verifying", () => {
      const code = "abcd-1234";
      const salt = "s";
      const hash = Totp.hashBackupCode(code, salt);
      expect(Totp.verifyBackupCode("ABCD1234", salt, hash)).toBe(true);
    });
  });

  describe("constantTimeEqual", () => {
    it("is true for equal strings, false for different", () => {
      expect(Totp.constantTimeEqual("abc", "abc")).toBe(true);
      expect(Totp.constantTimeEqual("abc", "abd")).toBe(false);
      expect(Totp.constantTimeEqual("abc", "abcd")).toBe(false);
    });
  });
});
