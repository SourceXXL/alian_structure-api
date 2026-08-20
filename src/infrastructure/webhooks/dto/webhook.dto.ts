import {
  IsString,
  IsUrl,
  IsArray,
  IsOptional,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  Min,
  Max,
  MaxLength,
  MinLength,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { WebhookSubscriptionStatus } from "../entities/webhook-subscription.entity";

export class CreateWebhookSubscriptionDto {
  @ApiProperty({ example: "https://example.com/webhook" })
  @IsUrl({}, { message: "url must be a valid URL" })
  @MaxLength(2048)
  url: string;

  @ApiProperty({
    example: ["portfolio.rebalanced", "alert.triggered"],
    description:
      "List of event types to subscribe to. Use '*' to receive all events.",
  })
  @IsArray()
  @IsString({ each: true })
  events: string[];

  @ApiPropertyOptional({ example: "Portfolio monitoring webhook" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({
    example: 5,
    description: "Max retry attempts per delivery",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxRetries?: number;

  @ApiPropertyOptional({ example: 1000, description: "Base retry delay in ms" })
  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(60000)
  retryDelayMs?: number;

  @ApiPropertyOptional({
    example: 2,
    description: "Exponential backoff multiplier",
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  backoffMultiplier?: number;

  @ApiPropertyOptional({
    example: 30000,
    description: "HTTP request timeout in ms",
  })
  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;

  @ApiPropertyOptional({
    example: 10,
    description: "Max deliveries per minute",
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  rateLimitPerMinute?: number;

  @ApiPropertyOptional({ example: { "X-Custom-Header": "value" } })
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class UpdateWebhookSubscriptionDto {
  @ApiPropertyOptional({ example: "https://example.com/new-webhook" })
  @IsOptional()
  @IsUrl({}, { message: "url must be a valid URL" })
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({ example: ["portfolio.rebalanced"] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @ApiPropertyOptional({ enum: WebhookSubscriptionStatus })
  @IsOptional()
  @IsEnum(WebhookSubscriptionStatus)
  status?: WebhookSubscriptionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxRetries?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(60000)
  retryDelayMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(5)
  backoffMultiplier?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  rateLimitPerMinute?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;
}

export class PublishWebhookEventDto {
  @ApiProperty({ example: "portfolio.rebalanced" })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  eventType: string;

  @ApiProperty({
    example: { portfolioId: "abc", oldAllocation: {}, newAllocation: {} },
  })
  @IsObject()
  payload: Record<string, any>;

  @ApiPropertyOptional({ example: "portfolio-123" })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  aggregateId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class RetryDeadLetterDto {
  @ApiPropertyOptional({ description: "Specific dead letter ID to retry" })
  @IsOptional()
  @IsString()
  deadLetterId?: string;
}
