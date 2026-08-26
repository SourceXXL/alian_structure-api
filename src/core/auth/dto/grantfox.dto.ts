import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsString, IsNotEmpty, IsOptional, IsArray } from "class-validator";

export class GrantfoxStartDto {
  @ApiPropertyOptional({
    description:
      "Scopes to request from Grantfox. Defaults to ['openid', 'profile', 'entitlements'].",
    example: ["openid", "profile", "entitlements"],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  scopes?: string[];
}

export class GrantfoxCallbackDto {
  @ApiProperty({
    description: "Authorization code returned by Grantfox",
  })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({
    description: "State parameter for CSRF protection",
  })
  @IsString()
  @IsNotEmpty()
  state: string;
}

export class GrantfoxRefreshDto {
  @ApiProperty({
    description: "Current refresh token to rotate",
  })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}

export class GrantfoxRevokeDto {
  @ApiPropertyOptional({
    description: "Specific refresh token to revoke. If omitted, all tokens for the user are revoked.",
  })
  @IsString()
  @IsOptional()
  refreshToken?: string;
}

export class GrantfoxTokenResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty()
  expiresIn: number;

  @ApiProperty({ required: false })
  tokenType?: string;

  @ApiProperty({ required: false })
  scope?: string;
}

export class GrantfoxUserInfoDto {
  @ApiProperty()
  grantfoxUserId: string;

  @ApiProperty({ required: false })
  email?: string;

  @ApiProperty({ required: false })
  name?: string;

  @ApiProperty({ required: false })
  organization?: string;

  @ApiProperty({ type: [String], required: false })
  entitlements?: string[];

  @ApiProperty({ type: [String], required: false })
  billingPermissions?: string[];
}

export class GrantfoxStartResponseDto {
  @ApiProperty({ description: "OAuth2 authorization URL to redirect the user to" })
  authorizationUrl: string;

  @ApiProperty({ description: "OAuth state parameter for CSRF protection" })
  state: string;
}
