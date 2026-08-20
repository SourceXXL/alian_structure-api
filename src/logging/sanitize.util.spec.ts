import {
  sanitizeValue,
  sanitizeObject,
  sanitizeHeaders,
  sanitizeQuery,
  sanitizeErrorMessage,
  formatError,
  REDACTED,
  SENSITIVE_FIELDS,
  SENSITIVE_HEADERS,
} from "./sanitize.util";

describe("sanitize.util", () => {
  // -------------------------------------------------------------------------
  // sanitizeValue
  // -------------------------------------------------------------------------

  describe("sanitizeValue", () => {
    it("returns primitives unchanged", () => {
      expect(sanitizeValue(42)).toBe(42);
      expect(sanitizeValue("hello")).toBe("hello");
      expect(sanitizeValue(true)).toBe(true);
    });

    it("returns null and undefined unchanged", () => {
      expect(sanitizeValue(null)).toBeNull();
      expect(sanitizeValue(undefined)).toBeUndefined();
    });

    it("redacts sensitive fields in a flat object", () => {
      const result = sanitizeValue({
        username: "alice",
        password: "s3cret",
      }) as any;
      expect(result.username).toBe("alice");
      expect(result.password).toBe(REDACTED);
    });

    it("redacts nested sensitive fields", () => {
      const input = { user: { profile: { token: "abc", name: "Bob" } } };
      const result = sanitizeValue(input) as any;
      expect(result.user.profile.token).toBe(REDACTED);
      expect(result.user.profile.name).toBe("Bob");
    });

    it("processes array items", () => {
      const input = [{ password: "x" }, { name: "y" }];
      const result = sanitizeValue(input) as any[];
      expect(result[0].password).toBe(REDACTED);
      expect(result[1].name).toBe("y");
    });

    it("caps arrays at MAX_ARRAY_LENGTH (50)", () => {
      const big = Array.from({ length: 100 }, (_, i) => i);
      const result = sanitizeValue(big) as unknown[];
      expect(result).toHaveLength(50);
    });

    it("returns [MAX_DEPTH] when nesting exceeds limit", () => {
      // Build a deeply nested object
      let obj: any = { value: "leaf" };
      for (let i = 0; i < 12; i++) obj = { nested: obj };

      const result = sanitizeValue(obj) as any;
      // After MAX_DEPTH levels the value should be the placeholder string
      let node = result;
      let depth = 0;
      while (typeof node === "object" && node !== null && node.nested) {
        node = node.nested;
        depth++;
      }
      expect(node).toBe("[MAX_DEPTH]");
    });

    it("handles Date objects without stringifying their fields", () => {
      const d = new Date("2024-01-01");
      expect(sanitizeValue(d)).toBe(d);
    });
  });

  // -------------------------------------------------------------------------
  // sanitizeObject
  // -------------------------------------------------------------------------

  describe("sanitizeObject", () => {
    it("redacts all default sensitive fields (case-insensitive key normalisation)", () => {
      const sensitiveKeys = [
        "password",
        "Password",
        "PASSWORD",
        "token",
        "apikey",
        "privatekey",
        "ssn",
        "creditcard",
        "mnemonic",
      ];

      for (const key of sensitiveKeys) {
        const result = sanitizeObject({ [key]: "secretValue" });
        expect(result[key]).toBe(REDACTED);
      }
    });

    it("preserves non-sensitive fields", () => {
      const result = sanitizeObject({ name: "Alice", age: 30, active: true });
      expect(result).toEqual({ name: "Alice", age: 30, active: true });
    });

    it("accepts extra sensitive fields", () => {
      const extra = new Set(["internalid"]);
      const result = sanitizeObject({ internalId: "123" }, 0, extra);
      expect(result.internalId).toBe(REDACTED);
    });
  });

  // -------------------------------------------------------------------------
  // sanitizeHeaders
  // -------------------------------------------------------------------------

  describe("sanitizeHeaders", () => {
    it("redacts standard sensitive headers", () => {
      const headers = {
        authorization: "Bearer abc123",
        cookie: "session=xyz",
        "x-api-key": "my-api-key",
        "content-type": "application/json",
        "x-request-id": "uuid-1234",
      };

      const result = sanitizeHeaders(headers);

      expect(result.authorization).toBe(REDACTED);
      expect(result.cookie).toBe(REDACTED);
      expect(result["x-api-key"]).toBe(REDACTED);
      expect(result["content-type"]).toBe("application/json");
      expect(result["x-request-id"]).toBe("uuid-1234");
    });

    it("accepts extra sensitive headers", () => {
      const extra = new Set(["x-internal-token"]);
      const result = sanitizeHeaders({ "x-internal-token": "secret" }, extra);
      expect(result["x-internal-token"]).toBe(REDACTED);
    });
  });

  // -------------------------------------------------------------------------
  // sanitizeQuery
  // -------------------------------------------------------------------------

  describe("sanitizeQuery", () => {
    it("redacts sensitive query parameters", () => {
      const query = { token: "abc", page: "1", apikey: "key123" };
      const result = sanitizeQuery(query);

      expect(result.token).toBe(REDACTED);
      expect(result.apikey).toBe(REDACTED);
      expect(result.page).toBe("1");
    });

    it("returns empty object unchanged", () => {
      expect(sanitizeQuery({})).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // sanitizeErrorMessage
  // -------------------------------------------------------------------------

  describe("sanitizeErrorMessage", () => {
    it("redacts JWT tokens in messages", () => {
      const msg =
        "Auth failed with token eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
      const sanitized = sanitizeErrorMessage(msg);
      expect(sanitized).not.toContain("eyJ");
      expect(sanitized).toContain(REDACTED);
    });

    it("redacts hex private keys", () => {
      const key = "0x" + "a".repeat(64);
      const msg = `Failed with key ${key}`;
      const sanitized = sanitizeErrorMessage(msg);
      expect(sanitized).not.toContain(key);
      expect(sanitized).toContain(REDACTED);
    });

    it("redacts Bearer tokens", () => {
      const msg = "Authorization: Bearer abc123def456";
      const sanitized = sanitizeErrorMessage(msg);
      expect(sanitized).toContain(`Bearer ${REDACTED}`);
      expect(sanitized).not.toContain("abc123def456");
    });

    it("redacts password= style inline values", () => {
      const msg = "connection failed password=my_secret host=db";
      const sanitized = sanitizeErrorMessage(msg);
      expect(sanitized).toContain("password=" + REDACTED);
      expect(sanitized).not.toContain("my_secret");
    });

    it("returns normal messages unchanged", () => {
      const msg = "Something went wrong with the database connection";
      expect(sanitizeErrorMessage(msg)).toBe(msg);
    });
  });

  // -------------------------------------------------------------------------
  // formatError
  // -------------------------------------------------------------------------

  describe("formatError", () => {
    it("formats Error instances", () => {
      const err = new Error("test error");
      const result = formatError(err, false);

      expect(result.type).toBe("Error");
      expect(result.message).toBe("test error");
      expect(result.stack).toBeUndefined(); // includeStack=false
    });

    it("includes stack trace when includeStack=true", () => {
      const err = new Error("with stack");
      const result = formatError(err, true);
      expect(result.stack).toBeDefined();
    });

    it("handles non-Error values", () => {
      const result = formatError("plain string error");
      expect(result.type).toBe("unknown");
      expect(result.message).toBe("plain string error");
    });

    it("sanitises sensitive data in error messages", () => {
      const err = new Error("password=secret123 failed");
      const result = formatError(err, false);
      expect(result.message as string).not.toContain("secret123");
    });

    it("preserves extra enumerable properties on the Error object", () => {
      const err = new Error("extended") as any;
      err.statusCode = 401;
      err.code = "UNAUTHORIZED";

      const result = formatError(err, false);
      expect(result.statusCode).toBe(401);
      expect(result.code).toBe("UNAUTHORIZED");
    });
  });

  // -------------------------------------------------------------------------
  // SENSITIVE_FIELDS coverage
  // -------------------------------------------------------------------------

  describe("SENSITIVE_FIELDS registry", () => {
    const expectedFields = [
      "password",
      "token",
      "accesstoken",
      "refreshtoken",
      "secret",
      "apikey",
      "privatekey",
      "mnemonic",
      "ssn",
      "creditcard",
      "cvv",
      "pin",
    ];

    expectedFields.forEach((field) => {
      it(`includes '${field}'`, () => {
        expect(SENSITIVE_FIELDS.has(field)).toBe(true);
      });
    });
  });

  describe("SENSITIVE_HEADERS registry", () => {
    const expectedHeaders = [
      "authorization",
      "cookie",
      "set-cookie",
      "x-api-key",
      "x-auth-token",
    ];

    expectedHeaders.forEach((header) => {
      it(`includes '${header}'`, () => {
        expect(SENSITIVE_HEADERS.has(header)).toBe(true);
      });
    });
  });
});
