import {
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  Min,
  Max,
  MaxLength,
  MinLength,
  ValidateNested,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  NotificationChannel,
  NotificationCategory,
  NotificationPriority,
} from '../entities/notification.entity';

export class SendNotificationDto {
  @ApiProperty({ description: 'Recipient user ID' })
  @IsString()
  userId: string;

  @ApiProperty({ example: 'Portfolio Alert' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'Your portfolio value has dropped by 5%' })
  @IsString()
  @MinLength(1)
  body: string;

  @ApiPropertyOptional({ description: 'HTML version of the body' })
  @IsOptional()
  @IsString()
  htmlBody?: string;

  @ApiPropertyOptional({
    enum: NotificationCategory,
    default: NotificationCategory.SYSTEM,
  })
  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;

  @ApiPropertyOptional({
    enum: NotificationPriority,
    default: NotificationPriority.NORMAL,
  })
  @IsOptional()
  @IsEnum(NotificationPriority)
  priority?: NotificationPriority;

  @ApiPropertyOptional({
    enum: NotificationChannel,
    default: NotificationChannel.IN_APP,
    description: 'Primary delivery channel',
  })
  @IsOptional()
  @IsEnum(NotificationChannel)
  primaryChannel?: NotificationChannel;

  @ApiPropertyOptional({
    enum: NotificationChannel,
    isArray: true,
    description: 'All channels to deliver through',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(NotificationChannel, { each: true })
  channels?: NotificationChannel[];

  @ApiPropertyOptional({ description: 'Template name to render' })
  @IsOptional()
  @IsString()
  templateName?: string;

  @ApiPropertyOptional({
    description: 'Template variables for rendering',
    example: { name: 'Alice', amount: '1000' },
  })
  @IsOptional()
  @IsObject()
  templateVars?: Record<string, any>;

  @ApiPropertyOptional({ description: 'Reference entity ID' })
  @IsOptional()
  @IsString()
  referenceId?: string;

  @ApiPropertyOptional({ description: 'Reference entity type' })
  @IsOptional()
  @IsString()
  referenceType?: string;

  /** Aggregation key to group notifications and prevent spam */
  @ApiPropertyOptional({
    description:
      'Aggregation key: notifications with the same key within the cooldown window will be collapsed',
  })
  @IsOptional()
  @IsString()
  aggregationKey?: string;

  @ApiPropertyOptional({
    description: 'Schedule for future delivery (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20)
  maxAttempts?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class SendBulkNotificationDto {
  @ApiProperty({ type: [SendNotificationDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SendNotificationDto)
  notifications: SendNotificationDto[];
}

export class ScheduleNotificationDto extends SendNotificationDto {
  @ApiProperty({
    description: 'ISO 8601 timestamp for scheduled delivery',
    example: '2025-01-15T09:00:00.000Z',
  })
  @IsDateString()
  scheduledAt: string;
}

export class CancelScheduledNotificationDto {
  @ApiProperty()
  @IsString()
  @IsUUID()
  notificationId: string;
}

export class MarkReadDto {
  @ApiProperty({
    description: 'Notification ID(s) to mark as read',
    isArray: true,
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  notificationIds: string[];
}

export class MarkAllReadDto {
  @ApiPropertyOptional({ enum: NotificationCategory })
  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;

  @ApiPropertyOptional({ description: 'Only mark as read before this time' })
  @IsOptional()
  @IsDateString()
  before?: string;
}

export class NotificationResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  notification: any;

  @ApiPropertyOptional()
  message?: string;
}

export class BulkNotificationResponseDto {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  count: number;

  @ApiProperty({ type: [Object] })
  notifications: any[];
}
