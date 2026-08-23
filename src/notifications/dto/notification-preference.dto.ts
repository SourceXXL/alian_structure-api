import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsInt,
  Min,
  Max,
  IsArray,
  ValidateNested,
  IsObject,
  IsEmail,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationCategory } from '../entities/notification.entity';
import { NotificationChannelPreference } from '../entities/notification-preference.entity';

export class UpdateNotificationPreferenceDto {
  @ApiProperty({ enum: NotificationCategory })
  @IsEnum(NotificationCategory)
  category: NotificationCategory;

  @ApiProperty({ description: 'Channel to configure (email, sms, push, webhook, in_app)' })
  @IsString()
  channel: string;

  @ApiProperty({ enum: NotificationChannelPreference })
  @IsEnum(NotificationChannelPreference)
  preference: NotificationChannelPreference;

  @ApiPropertyOptional({ enum: ['hourly', 'daily', 'weekly'], description: 'For digest mode' })
  @IsOptional()
  @IsString()
  digestFrequency?: string;

  @ApiPropertyOptional({ description: 'Quiet hours start (0-23)', minimum: 0, maximum: 23 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  quietHoursStart?: number;

  @ApiPropertyOptional({ description: 'Quiet hours end (0-23)', minimum: 0, maximum: 23 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  quietHoursEnd?: number;

  @ApiPropertyOptional({ description: 'IANA timezone (e.g., America/New_York)' })
  @IsOptional()
  @IsString()
  timezone?: string;

  @ApiPropertyOptional({ description: 'Email address for email channel' })
  @IsOptional()
  @IsEmail()
  emailAddress?: string;

  @ApiPropertyOptional({ description: 'Phone number for SMS channel (E.164 format)' })
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{1,14}$/)
  phoneNumber?: string;

  @ApiPropertyOptional({ description: 'Device push token' })
  @IsOptional()
  @IsString()
  pushToken?: string;

  @ApiPropertyOptional({ description: 'Webhook callback URL' })
  @IsOptional()
  @IsString()
  webhookUrl?: string;

  @ApiPropertyOptional({
    enum: ['low', 'normal', 'high', 'critical'],
    description: 'Minimum priority to trigger this channel',
  })
  @IsOptional()
  @IsString()
  minPriority?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class BulkUpdatePreferenceDto {
  @ApiProperty({ type: [UpdateNotificationPreferenceDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateNotificationPreferenceDto)
  preferences: UpdateNotificationPreferenceDto[];
}

export class SetAllChannelsDto {
  @ApiProperty({ enum: NotificationCategory })
  @IsEnum(NotificationCategory)
  category: NotificationCategory;

  @ApiProperty({
    enum: ['all_on', 'all_off', 'in_app_only', 'essential_only'],
    description: 'Preset: enable/disable all channels at once',
  })
  @IsString()
  preset: 'all_on' | 'all_off' | 'in_app_only' | 'essential_only';
}
