import {
  IsString,
  IsOptional,
  IsEnum,
  IsInt,
  Min,
  Max,
  IsDateString,
  IsBoolean,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  NotificationCategory,
  NotificationChannel,
  NotificationStatus,
  NotificationPriority,
} from '../entities/notification.entity';

export class QueryNotificationHistoryDto {
  @ApiProperty({ description: 'User ID' })
  @IsString()
  userId: string;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ description: 'Offset-based pagination cursor' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ enum: NotificationCategory, description: 'Filter by category' })
  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;

  @ApiPropertyOptional({ enum: NotificationChannel, description: 'Filter by channel' })
  @IsOptional()
  @IsEnum(NotificationChannel)
  channel?: NotificationChannel;

  @ApiPropertyOptional({
    description: 'Filter by read status',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  read?: boolean;

  @ApiPropertyOptional({ enum: NotificationStatus, description: 'Filter by status' })
  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  @ApiPropertyOptional({ enum: NotificationPriority, description: 'Filter by priority' })
  @IsOptional()
  @IsEnum(NotificationPriority)
  priority?: NotificationPriority;

  @ApiPropertyOptional({ description: 'Only notifications after this time (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  after?: string;

  @ApiPropertyOptional({ description: 'Only notifications before this time (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  before?: string;

  @ApiPropertyOptional({
    enum: ['createdAt', 'readAt', 'priority'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @ApiPropertyOptional({ enum: ['ASC', 'DESC'], default: 'DESC' })
  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}

export class UnreadCountDto {
  @ApiProperty()
  @IsString()
  userId: string;

  @ApiPropertyOptional({ enum: NotificationCategory })
  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;
}

export class DeleteNotificationDto {
  @ApiProperty({ isArray: true, type: [String], description: 'Notification IDs to soft-delete' })
  @IsString({ each: true })
  notificationIds: string[];
}
