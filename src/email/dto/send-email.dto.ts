import {
  IsEmail,
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  IsArray,
  ValidateNested,
  MaxLength,
  MinLength,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export enum EmailPriority {
  LOW = "low",
  NORMAL = "normal",
  HIGH = "high",
}

export class EmailAttachmentDto {
  @ApiProperty() @IsString() filename: string;
  @ApiPropertyOptional() @IsOptional() @IsString() content?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() path?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() contentType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() cid?: string;
}

export class SendEmailDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail({}, { each: true })
  @IsArray()
  to: string[];
  @ApiProperty({ example: "Welcome!" })
  @IsString()
  @MinLength(1)
  @MaxLength(998)
  subject: string;
  @ApiPropertyOptional() @IsOptional() @IsString() templateName?: string;
  @ApiPropertyOptional({ example: { name: "Alice" } })
  @IsOptional()
  @IsObject()
  templateVars?: Record<string, any>;
  @ApiPropertyOptional() @IsOptional() @IsString() html?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() text?: string;
  @ApiPropertyOptional({ type: [EmailAttachmentDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EmailAttachmentDto)
  attachments?: EmailAttachmentDto[];
  @ApiPropertyOptional({ enum: EmailPriority, default: EmailPriority.NORMAL })
  @IsOptional()
  @IsEnum(EmailPriority)
  priority?: EmailPriority;
}

export class CreateTemplateDto {
  @ApiProperty({ example: "welcome" })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;
  @ApiProperty() @IsString() htmlContent: string;
  @ApiPropertyOptional() @IsOptional() @IsString() textContent?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() subject?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
}

export class SendBulkEmailDto {
  @ApiProperty({ type: [SendEmailDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SendEmailDto)
  emails: SendEmailDto[];
}
