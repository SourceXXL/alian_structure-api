import { ApiProperty } from "@nestjs/swagger";
import { IsString, IsNotEmpty, IsOptional } from "class-validator";

export class OAuthCallbackDto {
  @ApiProperty({ description: "Authorization code from OAuth provider" })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: "State parameter for CSRF protection", required: false })
  @IsString()
  @IsOptional()
  state?: string;
}

export class OAuthLinkDto {
  @ApiProperty({ description: "Authorization code from OAuth provider" })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({ description: "State parameter", required: false })
  @IsString()
  @IsOptional()
  state?: string;
}
