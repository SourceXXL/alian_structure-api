import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { NotificationService } from './services/notification.service';
import { NotificationTemplateService } from './services/notification-template.service';
import { NotificationAnalyticsService } from './services/notification-analytics.service';
import { NotificationAggregationService } from './services/notification-aggregation.service';
import { NotificationPreferenceService } from './services/notification-preference.service';
import {
  SendNotificationDto,
  SendBulkNotificationDto,
  MarkReadDto,
  MarkAllReadDto,
} from './dto/send-notification.dto';
import {
  UpdateNotificationPreferenceDto,
  BulkUpdatePreferenceDto,
  SetAllChannelsDto,
} from './dto/notification-preference.dto';
import {
  QueryNotificationHistoryDto,
  DeleteNotificationDto,
} from './dto/query-notification.dto';
import {
  CreateNotificationTemplateDto,
  UpdateNotificationTemplateDto,
  RenderTemplatePreviewDto,
} from './dto/notification-template.dto';
import {
  QueryAnalyticsDto,
  EngagementSummaryDto,
} from './dto/notification-analytics.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(
    private readonly notificationService: NotificationService,
    private readonly templateService: NotificationTemplateService,
    private readonly analyticsService: NotificationAnalyticsService,
    private readonly aggregationService: NotificationAggregationService,
    private readonly preferenceService: NotificationPreferenceService,
  ) {}

  // ─── Notification CRUD ──────────────────────────────────────────────

  @Post('send')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send a single notification' })
  @ApiResponse({ status: 201, description: 'Notification sent successfully' })
  async sendNotification(@Body() dto: SendNotificationDto) {
    const notification = await this.notificationService.send(dto);
    return { success: true, notification };
  }

  @Post('send-bulk')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Send bulk notifications' })
  @ApiResponse({ status: 201, description: 'Bulk notifications sent' })
  async sendBulkNotification(@Body() dto: SendBulkNotificationDto) {
    const notifications = await this.notificationService.sendBulk(dto);
    return { success: true, count: notifications.length, notifications };
  }

  @Get('history/:userId')
  @ApiOperation({ summary: 'Get notification history for a user' })
  @ApiParam({ name: 'userId' })
  async getHistory(
    @Param('userId') userId: string,
    @Query() query: QueryNotificationHistoryDto,
  ) {
    query.userId = userId;
    const result = await this.notificationService.getHistory(query);
    return { success: true, ...result };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single notification' })
  @ApiParam({ name: 'id' })
  async getById(@Param('id') id: string) {
    const notification = await this.notificationService.getById(id);
    return { success: true, notification };
  }

  @Get(':id/delivery')
  @ApiOperation({ summary: 'Get delivery status for a notification' })
  @ApiParam({ name: 'id' })
  async getDeliveryStatus(@Param('id') id: string) {
    const logs = await this.notificationService.getDeliveryStatus(id);
    return { success: true, deliveryLogs: logs };
  }

  // ─── Read / Unread Tracking ─────────────────────────────────────────

  @Post('mark-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark notifications as read' })
  async markAsRead(@Body() dto: MarkReadDto) {
    const result = await this.notificationService.markAsRead(dto.notificationIds);
    return { success: true, ...result };
  }

  @Post('mark-all-read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all notifications as read for a user' })
  async markAllAsRead(@Body() dto: MarkAllReadDto & { userId: string }) {
    const result = await this.notificationService.markAllAsRead(dto.userId, {
      category: dto.category,
      before: dto.before,
    });
    return { success: true, ...result };
  }

  @Post('mark-unread')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark notifications as unread' })
  async markAsUnread(@Body() dto: MarkReadDto) {
    const result = await this.notificationService.markAsUnread(dto.notificationIds);
    return { success: true, ...result };
  }

  @Post(':id/click')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Track a notification click-through' })
  @ApiParam({ name: 'id' })
  async trackClick(@Param('id') id: string) {
    await this.notificationService.trackClick(id);
    return { success: true };
  }

  @Get('unread-count/:userId')
  @ApiOperation({ summary: 'Get unread notification count for a user' })
  @ApiParam({ name: 'userId' })
  async getUnreadCount(
    @Param('userId') userId: string,
    @Query('category') category?: string,
  ) {
    const result = await this.notificationService.getUnreadCount(userId, category);
    return { success: true, ...result };
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete notifications' })
  async softDelete(@Body() dto: DeleteNotificationDto) {
    const result = await this.notificationService.softDelete(dto.notificationIds);
    return { success: true, ...result };
  }

  // ─── Scheduling ─────────────────────────────────────────────────────

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a scheduled notification' })
  @ApiParam({ name: 'id' })
  async cancelScheduled(@Param('id') id: string) {
    const notification = await this.notificationService.cancel(id);
    return { success: true, notification };
  }

  // ─── Notification Preferences ──────────────────────────────────────

  @Get('preferences/:userId')
  @ApiOperation({ summary: 'Get all notification preferences for a user' })
  @ApiParam({ name: 'userId' })
  async getPreferences(@Param('userId') userId: string) {
    const preferences = await this.preferenceService.getPreferences(userId);
    return { success: true, preferences };
  }

  @Put('preferences/:userId')
  @ApiOperation({ summary: 'Update a notification preference' })
  @ApiParam({ name: 'userId' })
  async updatePreference(
    @Param('userId') userId: string,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    const preference = await this.preferenceService.updatePreference(userId, dto);
    return { success: true, preference };
  }

  @Put('preferences/:userId/bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Bulk update notification preferences' })
  @ApiParam({ name: 'userId' })
  async bulkUpdatePreferences(
    @Param('userId') userId: string,
    @Body() dto: BulkUpdatePreferenceDto,
  ) {
    const preferences = await this.preferenceService.bulkUpdate(userId, dto.preferences);
    return { success: true, count: preferences.length, preferences };
  }

  @Put('preferences/:userId/preset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Apply a preset to all channels for a category' })
  @ApiParam({ name: 'userId' })
  async setPreset(
    @Param('userId') userId: string,
    @Body() dto: SetAllChannelsDto,
  ) {
    const preferences = await this.preferenceService.setAllChannels(userId, dto);
    return { success: true, count: preferences.length };
  }

  @Post('preferences/:userId/seed')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Seed default notification preferences for a new user' })
  @ApiParam({ name: 'userId' })
  async seedDefaults(@Param('userId') userId: string) {
    await this.preferenceService.seedDefaults(userId);
    return { success: true, message: 'Default preferences seeded' };
  }

  @Delete('preferences/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete all notification preferences for a user' })
  @ApiParam({ name: 'userId' })
  async deleteAllPreferences(@Param('userId') userId: string) {
    await this.preferenceService.deleteAll(userId);
    return { success: true, message: 'All preferences deleted' };
  }

  // ─── Templates ──────────────────────────────────────────────────────

  @Get('templates/all')
  @ApiOperation({ summary: 'Get all notification templates' })
  async getTemplates() {
    const templates = await this.templateService.getAllTemplates();
    return { success: true, templates };
  }

  @Post('templates')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a notification template' })
  async createTemplate(@Body() dto: CreateNotificationTemplateDto) {
    const template = await this.templateService.createTemplate(dto);
    return { success: true, template };
  }

  @Put('templates/:name')
  @ApiOperation({ summary: 'Update a notification template' })
  @ApiParam({ name: 'name' })
  async updateTemplate(
    @Param('name') name: string,
    @Body() dto: UpdateNotificationTemplateDto,
  ) {
    const template = await this.templateService.updateTemplate(name, dto);
    return { success: true, template };
  }

  @Post('templates/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Preview a rendered template' })
  async previewTemplate(@Body() dto: RenderTemplatePreviewDto) {
    const template = await this.templateService.getTemplate(dto.templateName);
    const renderedBody = this.templateService.renderBody(
      dto.templateName,
      template.bodyTemplate,
      dto.variables,
    );
    const renderedHtml = template.htmlTemplate
      ? this.templateService.renderBody(dto.templateName, template.htmlTemplate, dto.variables)
      : undefined;
    const renderedSubject = template.subject
      ? this.templateService.renderBody(dto.templateName, template.subject, dto.variables)
      : undefined;
    return {
      success: true,
      preview: {
        subject: renderedSubject,
        body: renderedBody,
        html: renderedHtml,
      },
    };
  }

  @Delete('templates/:name')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate a notification template' })
  @ApiParam({ name: 'name' })
  async deleteTemplate(@Param('name') name: string) {
    await this.templateService.deleteTemplate(name);
    return { success: true, message: `Template "${name}" deactivated` };
  }

  // ─── Analytics ──────────────────────────────────────────────────────

  @Get('analytics/query')
  @ApiOperation({ summary: 'Query notification analytics' })
  async queryAnalytics(@Query() dto: QueryAnalyticsDto) {
    const data = await this.analyticsService.queryAnalytics(dto);
    return { success: true, data };
  }

  @Get('analytics/engagement')
  @ApiOperation({ summary: 'Get engagement summary (delivery/open/click rates)' })
  async getEngagementSummary(@Query() dto: EngagementSummaryDto) {
    const summary = await this.analyticsService.getEngagementSummary(dto);
    return { success: true, ...summary };
  }

  // ─── Aggregation ────────────────────────────────────────────────────

  @Get('aggregation/stats/:userId/:key')
  @ApiOperation({ summary: 'Get aggregation stats for a user and key' })
  @ApiParam({ name: 'userId' })
  @ApiParam({ name: 'key' })
  async getAggregationStats(
    @Param('userId') userId: string,
    @Param('key') key: string,
  ) {
    const stats = await this.aggregationService.getAggregationStats(userId, key);
    return { success: true, stats };
  }
}
