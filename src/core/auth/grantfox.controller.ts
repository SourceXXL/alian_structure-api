import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from "@nestjs/swagger";
import { GrantfoxOAuthService } from "./services/grantfox-oauth.service";
import { JwtAuthGuard } from "./jwt.guard";
import { Public } from "src/common/decorators/public.decorator";
import {
  RateLimit,
  SensitiveRateLimit,
} from "src/common/decorators/rate-limit.decorator";
import {
  GrantfoxStartDto,
  GrantfoxCallbackDto,
  GrantfoxRefreshDto,
  GrantfoxRevokeDto,
} from "./dto/grantfox.dto";

@ApiTags("Grantfox OAuth2 SSO")
@Controller("auth/grantfox")
export class GrantfoxController {
  constructor(
    private readonly grantfoxOAuthService: GrantfoxOAuthService,
  ) {}

  /**
   * Start the Grantfox OAuth2 Authorization Code flow with PKCE.
   * Returns the authorization URL the client should redirect to.
   */
  @Public()
  @Post("start")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Start Grantfox OAuth2 authorization",
    description:
      "Generates a PKCE authorization URL for the user to redirect to Grantfox. " +
      "Returns the authorization URL and state parameter for CSRF protection.",
  })
  @ApiResponse({
    status: 200,
    description: "Authorization URL generated successfully",
    schema: {
      type: "object",
      properties: {
        authorizationUrl: { type: "string" },
        state: { type: "string" },
      },
    },
  })
  async startAuthorization(@Body() dto: GrantfoxStartDto) {
    return this.grantfoxOAuthService.startAuthorization(dto.scopes);
  }

  /**
   * Handle the OAuth2 callback from Grantfox.
   * Exchanges the code for tokens and returns the mapped internal user identity.
   */
  @Public()
  @Post("callback")
  @HttpCode(HttpStatus.OK)
  @SensitiveRateLimit("auth")
  @ApiOperation({
    summary: "Handle Grantfox OAuth2 callback",
    description:
      "Exchanges the authorization code for tokens, fetches user info from Grantfox, " +
      "and returns the mapped internal user identity with access/refresh tokens.",
  })
  @ApiResponse({
    status: 200,
    description: "Authorization successful",
    schema: {
      type: "object",
      properties: {
        accessToken: { type: "string" },
        refreshToken: { type: "string" },
        user: {
          type: "object",
          properties: {
            id: { type: "string" },
            email: { type: "string" },
            username: { type: "string" },
            role: { type: "string" },
            tier: { type: "string" },
          },
        },
        entitlements: { type: "array", items: { type: "string" } },
        billingPermissions: { type: "array", items: { type: "string" } },
      },
    },
  })
  @ApiResponse({ status: 400, description: "Invalid authorization code or state" })
  @ApiResponse({ status: 401, description: "Token exchange failed" })
  async handleCallback(
    @Body() dto: GrantfoxCallbackDto,
    @Request() req,
  ) {
    return this.grantfoxOAuthService.handleCallback(
      dto.code,
      dto.state,
      req.ip,
      req.headers["user-agent"],
    );
  }

  /**
   * Refresh the Grantfox access token.
   * Implements refresh token rotation: the old refresh token is revoked and a new pair is issued.
   */
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  @RateLimit({ level: "auth", limit: 10, windowMs: 60000 })
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Refresh Grantfox access token",
    description:
      "Exchange a valid refresh token for a new access + refresh token pair. " +
      "The old refresh token is revoked (rotation).",
  })
  @ApiResponse({
    status: 200,
    description: "Token refreshed successfully",
    schema: {
      type: "object",
      properties: {
        accessToken: { type: "string" },
        refreshToken: { type: "string" },
        expiresIn: { type: "number" },
      },
    },
  })
  @ApiResponse({ status: 401, description: "Invalid or expired refresh token" })
  async refreshToken(@Body() dto: GrantfoxRefreshDto, @Request() req) {
    return this.grantfoxOAuthService.refreshToken(dto.refreshToken, req.ip);
  }

  /**
   * Revoke Grantfox tokens.
   * Revokes a specific refresh token or all tokens for the authenticated user.
   */
  @Post("revoke")
  @HttpCode(HttpStatus.OK)
  @SensitiveRateLimit("auth")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Revoke Grantfox tokens",
    description:
      "Revoke a specific refresh token or all active Grantfox tokens for the " +
      "authenticated user. Also calls the Grantfox revocation endpoint.",
  })
  @ApiResponse({
    status: 200,
    description: "Token(s) revoked successfully",
    schema: {
      type: "object",
      properties: {
        revoked: { type: "boolean" },
        count: { type: "number" },
      },
    },
  })
  @ApiResponse({ status: 400, description: "Token not found or already revoked" })
  async revokeToken(@Body() dto: GrantfoxRevokeDto, @Request() req) {
    const userId = req.user.sub || req.user.id;
    return this.grantfoxOAuthService.revokeToken(userId, dto.refreshToken);
  }

  /**
   * Get the current user's linked Grantfox tokens and entitlements.
   */
  @Get("status")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get Grantfox connection status",
    description:
      "Returns all active Grantfox token records for the authenticated user, " +
      "including entitlements and billing permissions.",
  })
  @ApiResponse({ status: 200, description: "Grantfox connection status" })
  async getStatus(@Request() req) {
    const userId = req.user.sub || req.user.id;
    const tokens =
      await this.grantfoxOAuthService.getUserTokens(userId);
    return {
      connected: tokens.length > 0,
      tokens,
    };
  }
}
