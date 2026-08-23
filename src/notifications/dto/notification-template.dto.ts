import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsObject,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateNotificationTemplateDto {
  @ApiProperty({ example: 'portfolio_alert' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: 'Portfolio value threshold alert' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description: string;

  @ApiProperty({ example: 'email', description: 'Target channel' })
  @IsString()
  channel: string;

  @ApiPropertyOptional({ example: 'Your portfolio has reached {{threshold}}' })
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiProperty({ example: 'Hello {{name}}, your portfolio is now {{value}}.' })
  @IsString()
  bodyTemplate: string;

  @ApiPropertyOptional({
    description: 'HTML template with Handlebars-style variables',
  })
  @IsOptional()
  @IsString()
  htmlTemplate?: string;

  @ApiPropertyOptional({ description: 'SMS-specific template' })
  @IsOptional()
  @IsString()
  smsTemplate?: string;

  @ApiPropertyOptional({
    example: ['name', 'value', 'threshold'],
    description: 'Template variable names',
  })
  @IsOptional()
  @IsArray()
  variables?: string[];

  @ApiPropertyOptional({ example: 'portfolio' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class UpdateNotificationTemplateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bodyTemplate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  htmlTemplate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  smsTemplate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  variables?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class RenderTemplatePreviewDto {
  @ApiProperty()
  @IsString()
  templateName: string;

  @ApiProperty({
    example: { name: 'Alice', value: '$15,000', threshold: '$10,000' },
  })
  @IsObject()
  variables: Record<string, any>;
}
