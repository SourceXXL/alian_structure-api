import { JwtModuleOptions } from "@nestjs/jwt";

/**
 * Deriving the duration/algorithm types from `JwtModuleOptions` rather than
 * re-declaring them as `string`/`string[]` keeps this file honest: `jsonwebtoken`
 * types `expiresIn` as `number | ms.StringValue` (a template-literal union) and
 * `algorithms` as `Algorithm[]`, so a bare `string` is not assignable and the
 * compiler catches a malformed TTL at the definition rather than at runtime.
 */
type TokenLifetime = NonNullable<
  NonNullable<JwtModuleOptions["signOptions"]>["expiresIn"]
>;
type VerifyAlgorithms = NonNullable<
  NonNullable<JwtModuleOptions["verifyOptions"]>["algorithms"]
>;

/**
 * Single source of truth for JWT lifetimes and algorithm policy.
 *
 * Previously the access-token lifetime was written out as the string literal
 * `"15m"` in two different services (`AuthService.register`/`AuthService.login`
 * passed it explicitly, `EnhancedAuthService.generateTokens` relied on the
 * `JwtModule` default). That is exactly the kind of drift that lets a token end
 * up with no `exp` claim at all - and a token with no `exp` never expires, so a
 * leak cannot be contained and logout cannot meaningfully revoke it. Keeping the
 * TTL here means both services reference the same value and the module default
 * cannot silently change what the services think they are issuing.
 */

/**
 * Access-token lifetime, as a `ms`-style string understood by `jsonwebtoken`.
 * Shared by `AuthService` and `EnhancedAuthService`.
 */
export const ACCESS_TOKEN_TTL: TokenLifetime = "15m";

/**
 * `ACCESS_TOKEN_TTL` expressed in seconds, for assertions and for places that
 * need a numeric value (e.g. `exp - iat` checks).
 */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * Refresh-token lifetime. Deliberately unchanged - refresh tokens are
 * long-lived by design and are revoked server-side via the `refresh_tokens`
 * table rather than by expiry alone.
 */
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** `REFRESH_TOKEN_TTL_MS` as a `jsonwebtoken` duration string. */
export const REFRESH_TOKEN_TTL: TokenLifetime = "7d";

/**
 * Lifetime for the long-lived tokens issued by `DashboardModule` (websocket
 * gateway tickets) and `NotificationModule` (consumer tokens). These are
 * separate issuers from the 15-minute access-token issuer in `AuthModule`, and
 * their TTLs are unchanged.
 */
export const LONG_LIVED_TOKEN_TTL: TokenLifetime = "24h";

/**
 * Algorithm used to sign new tokens. Pinned explicitly rather than relying on
 * `jsonwebtoken`'s default so that changing the default can never silently
 * change what we issue.
 */
export const JWT_SIGNING_ALGORITHM = "HS256";

/**
 * Algorithms accepted during verification. Pinning an allowlist means a token
 * presented with some other algorithm is rejected outright instead of the
 * verifier deciding for itself.
 */
export const JWT_VERIFY_ALGORITHMS: VerifyAlgorithms = [
  JWT_SIGNING_ALGORITHM,
];

export interface JwtIssuerConfig {
  /** Signing/verification secret. */
  secret: string;
  /** Default lifetime applied when a caller does not pass its own `expiresIn`. */
  expiresIn: TokenLifetime;
}

/**
 * Build the `JwtModule` options for an issuer.
 *
 * Both the signing and the verification side are pinned:
 *
 *  - `signOptions.algorithm` - so we always issue `HS256`, never whatever the
 *    library defaults to.
 *  - `verifyOptions.algorithms` - an explicit allowlist. `jsonwebtoken.verify`
 *    throws `JsonWebTokenError: invalid algorithm` for anything outside it,
 *    which blocks algorithm-substitution attempts.
 *
 * Note that `algorithms` belongs on `verifyOptions` (it is a *verification*
 * concern); `JwtModuleOptions` has no top-level `algorithms` key, so putting
 * it at the top level of the module options would be silently ignored.
 */
export function buildJwtModuleOptions(config: JwtIssuerConfig): JwtModuleOptions {
  return {
    secret: config.secret,
    signOptions: {
      expiresIn: config.expiresIn,
      algorithm: JWT_SIGNING_ALGORITHM,
    },
    // Copied so callers cannot mutate the shared allowlist.
    verifyOptions: {
      algorithms: [...JWT_VERIFY_ALGORITHMS],
    },
  };
}

/**
 * Options for the access-token issuer (`AuthModule`), which backs both
 * `AuthService` and `EnhancedAuthService`.
 */
export function buildAccessTokenJwtModuleOptions(
  secret: string,
): JwtModuleOptions {
  return buildJwtModuleOptions({ secret, expiresIn: ACCESS_TOKEN_TTL });
}