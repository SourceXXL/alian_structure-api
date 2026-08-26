import {
  Injectable,
  Logger,
  NestMiddleware,
  Optional,
} from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { GrantfoxOAuthService } from "../services/grantfox-oauth.service";

/**
 * Augmented Express request carrying Grantfox identity when a valid
 * Grantfox access token is present in the Authorization header.
 */
export interface GrantfoxAugmentedRequest extends Request {
  grantfox?: {
    userId: string;
    grantfoxUserId: string;
    entitlements: string[];
    billingPermissions: string[];
  };
}

/**
 * Middleware that inspects the `Authorization: Bearer <token>` header,
 * resolves it against the stored Grantfox tokens, and attaches the
 * Grantfox identity + entitlements to `req.grantfox` for downstream
 * handlers.
 *
 * This middleware is **non-blocking**: if no Grantfox token is found or
 * the token is not a Grantfox token, the request proceeds normally
 * without `req.grantfox` being set.
 *
 * Usage:
 * ```ts
 * // In a controller or module:
 * app.use(new GrantfoxIdentityMiddleware(grantfoxOAuthService).use());
 * ```
 */
@Injectable()
export class GrantfoxIdentityMiddleware implements NestMiddleware {
  private readonly logger = new Logger(GrantfoxIdentityMiddleware.name);

  constructor(
    private readonly grantfoxOAuthService: GrantfoxOAuthService,
  ) {}

  use(req: GrantfoxAugmentedRequest, _res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return next();
    }

    const token = authHeader.slice(7);

    // Resolve asynchronously but don't block the request on failure
    this.grantfoxOAuthService
      .resolveIdentity(token)
      .then((identity) => {
        if (identity) {
          req.grantfox = {
            userId: identity.userId,
            grantfoxUserId: identity.grantfoxUserId,
            entitlements: identity.entitlements,
            billingPermissions: identity.billingPermissions,
          };
        }
        next();
      })
      .catch((error) => {
        this.logger.warn(
          `Failed to resolve Grantfox identity: ${(error as Error).message}`,
        );
        // Don't block the request — just proceed without Grantfox context
        next();
      });
  }
}
