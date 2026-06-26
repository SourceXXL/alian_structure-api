import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  UseGuards,
  Request,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from "@nestjs/swagger";
import { OAuthStrategy } from "./strategies/oauth/oauth.strategy";
import { JwtAuthGuard } from "./jwt.guard";
import { Public } from "src/common/decorators/public.decorator";
import { OAuthCallbackDto, OAuthLinkDto } from "./dto/oauth.dto";
import { v4 as uuidv4 } from "uuid";

@ApiTags("OAuth / Social Auth")
@Controller("auth/oauth")
export class OAuthController {
  constructor(private readonly oauthStrategy: OAuthStrategy) {}

  @Public()
  @Get(":provider")
  @ApiOperation({ summary: "Get OAuth authorization URL for a provider" })
  @ApiParam({ name: "provider", enum: ["google", "github", "twitter"] })
  @ApiResponse({ status: 200, description: "Returns the authorization URL" })
  getAuthorizationUrl(@Param("provider") provider: string) {
    const state = uuidv4();
    const url = this.oauthStrategy.getAuthorizationUrl(provider, state);
    return { url, state };
  }

  @Public()
  @Post(":provider/callback")
  @ApiOperation({ summary: "Handle OAuth callback and issue JWT" })
  @ApiParam({ name: "provider", enum: ["google", "github", "twitter"] })
  @ApiResponse({ status: 200, description: "Returns JWT token and user info" })
  @ApiResponse({ status: 401, description: "OAuth authentication failed" })
  async handleCallback(
    @Param("provider") provider: string,
    @Body() dto: OAuthCallbackDto,
  ) {
    return this.oauthStrategy.authenticate({ provider, code: dto.code, state: dto.state });
  }

  @Post(":provider/link")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Link a social provider to your existing account" })
  @ApiParam({ name: "provider", enum: ["google", "github", "twitter"] })
  @ApiResponse({ status: 200, description: "Social account linked successfully" })
  async linkProvider(
    @Param("provider") provider: string,
    @Body() dto: OAuthLinkDto,
    @Request() req,
  ) {
    const userId = req.user.sub || req.user.id;
    return this.oauthStrategy.linkProvider(userId, provider, dto.code);
  }

  @Delete(":provider/unlink")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Unlink a social provider from your account" })
  @ApiParam({ name: "provider", enum: ["google", "github", "twitter"] })
  @ApiResponse({ status: 200, description: "Social account unlinked successfully" })
  async unlinkProvider(
    @Param("provider") provider: string,
    @Request() req,
  ) {
    const userId = req.user.sub || req.user.id;
    return this.oauthStrategy.unlinkProvider(userId, provider);
  }

  @Get("providers/linked")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all linked social providers for current user" })
  @ApiResponse({ status: 200, description: "List of linked providers" })
  async getLinkedProviders(@Request() req) {
    const userId = req.user.sub || req.user.id;
    return this.oauthStrategy.getLinkedProviders(userId);
  }

  @Public()
  @Get("providers/available")
  @ApiOperation({ summary: "Get list of available OAuth providers" })
  @ApiResponse({ status: 200, description: "List of enabled providers" })
  getAvailableProviders() {
    return { providers: this.oauthStrategy.getAvailableProviders() };
  }
}
