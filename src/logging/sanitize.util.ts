/**
 * Sanitize utility for structured logging.
 *
 * Ensures that sensitive fields (passwords, tokens, keys, etc.) are never
 * written to any log sink. All sanitisation is depth-limited to prevent
 * performance issues with deeply nested request/response payloads.
 */

// ---------------------------------------------------------------------------
// Sensitive field registry
// ---------------------------------------------------------------------------

/**
 * Case-insensitive set of body / metadata field names that must be redacted.
 * Extend this list with application-specific sensitive fields.
 */
export const SENSITIVE_FIELDS = new Set<string>([
  // Auth / session
  "password",
  "passwordconfirm",
  "oldpassword",
  "newpassword",
  "currentpassword",
  "confirmpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authtoken",
  "sessiontoken",
  "bearertoken",
  // API access
  "secret",
  "apikey",
  "api_key",
  "clientsecret",
  "client_secret",
  "clientid",
  // PII
  "ssn",
  "socialsecuritynumber",
  "creditcard",
  "cardnumber",
  "cvv",
  "cvc",
  "pin",
  "dateofbirth",
  "dob",
  // Crypto / wallet
  "privatekey",
  "private_key",
  "mnemonic",
  "seed",
  "seedphrase",
  "walletpassphrase",
  "keystorepassword",
  // Infrastructure
  "databasepassword",
  "db_password",
  "smtppassword",
  "smtp_password",
  "redispassword",
  "redis_password",
]);

/**
 * HTTP request headers that must be redacted in log output.
 */
export const SENSITIVE_HEADERS = new Set<string>([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
  "x-refresh-token",
  "proxy-authorization",
  "www-authenticate",
]);

// ---------------------------------------------------------------------------
// Redaction constants
// ---------------------------------------------------------------------------
export const REDACTED = "[REDACTED]";
const MAX_DEPTH = 8;
const MAX_ARRAY_LENGTH = 50;

// ---------------------------------------------------------------------------
// Core sanitisation
// ---------------------------------------------------------------------------

/**
 * Deep-sanitises an arbitrary value, replacing values associated with
 * sensitive field names with [REDACTED].
 *
 * - `depth` is tracked to prevent runaway recursion on circular or very deep
 *   objects.  When the limit is hit the value is replaced with [MAX_DEPTH].
 * - Array items are capped at MAX_ARRAY_LENGTH to bound log size.
 */
export function sanitizeValue(
  value: unknown,
  depth = 0,
  extraSensitiveFields?: Set<string>,
): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return "[MAX_DEPTH]";

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_LENGTH)
      .map((item) => sanitizeValue(item, depth + 1, extraSensitiveFields));
  }

  if (typeof value === "object" && !(value instanceof Date)) {
    return sanitizeObject(
      value as Record<string, unknown>,
      depth,
      extraSensitiveFields,
    );
  }

  return value;
}

/**
 * Sanitises a plain object — the workhorse behind {@link sanitizeValue}.
 */
export function sanitizeObject(
  obj: Record<string, unknown>,
  depth = 0,
  extraSensitiveFields?: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    const lower = key.toLowerCase().replace(/[-_\s]/g, "");
    const isSensitive =
      SENSITIVE_FIELDS.has(lower) || extraSensitiveFields?.has(lower);

    out[key] = isSensitive
      ? REDACTED
      : sanitizeValue(val, depth + 1, extraSensitiveFields);
  }

  return out;
}

/**
 * Sanitises HTTP request headers, redacting security-relevant ones.
 */
export function sanitizeHeaders(
  headers: Record<string, unknown>,
  extraSensitiveHeaders?: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    const isSensitive =
      SENSITIVE_HEADERS.has(lower) || extraSensitiveHeaders?.has(lower);
    out[key] = isSensitive ? REDACTED : value;
  }

  return out;
}

/**
 * Trims a URL query string, redacting sensitive query parameters.
 * e.g. `?token=abc&page=1` → `?token=[REDACTED]&page=1`
 */
export function sanitizeQuery(
  query: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(query)) {
    const lower = key.toLowerCase();
    out[key] = SENSITIVE_FIELDS.has(lower) ? REDACTED : value;
  }

  return out;
}

/**
 * Redacts sensitive information from error messages before logging.
 * Replaces common secret patterns (JWT, API keys, hex private keys).
 */
export function sanitizeErrorMessage(message: string): string {
  return (
    message
      // JWT tokens  (3-part base64url separated by dots)
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, REDACTED)
      // 32-64 byte hex strings (likely private keys / hashes)
      .replace(/\b(?:0x)?[0-9a-fA-F]{64,128}\b/g, REDACTED)
      // Bearer tokens
      .replace(/Bearer\s+\S+/gi, `Bearer ${REDACTED}`)
      // Basic auth
      .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, `Basic ${REDACTED}`)
      // password= style inline values
      .replace(/(password|secret|key|token)\s*=\s*\S+/gi, "$1=" + REDACTED)
  );
}

/**
 * Formats an Error into a structured log-friendly object. Stack traces are
 * only included in non-production environments.
 */
export function formatError(
  error: unknown,
  includeStack = process.env.NODE_ENV !== "production",
): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { message: sanitizeErrorMessage(String(error)), type: "unknown" };
  }

  const out: Record<string, unknown> = {
    type: error.constructor?.name ?? "Error",
    message: sanitizeErrorMessage(error.message),
  };

  if (includeStack && error.stack) {
    out.stack = error.stack;
  }

  // Preserve any extra enumerable properties added to the error
  for (const key of Object.keys(error)) {
    if (key !== "message" && key !== "stack") {
      out[key] = sanitizeValue((error as any)[key]);
    }
  }

  return out;
}
