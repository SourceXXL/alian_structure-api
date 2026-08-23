import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NotificationPreference,
  NotificationChannelPreference,
} from '../entities/notification-preference.entity';
import {
  UpdateNotificationPreferenceDto,
  SetAllChannelsDto,
} from '../dto/notification-preference.dto';
import { NotificationCategory, NotificationChannel } from '../entities/notification.entity';

@Injectable()
export class NotificationPreferenceService {
  private readonly logger = new Logger(NotificationPreferenceService.name);

  constructor(
    @InjectRepository(NotificationPreference)
    private readonly preferenceRepo: Repository<NotificationPreference>,
  ) {}

  /**
   * Get all preferences for a user.
   */
  async getPreferences(userId: string): Promise<NotificationPreference[]> {
    return this.preferenceRepo.find({
      where: { userId },
      order: { category: 'ASC', channel: 'ASC' },
    });
  }

  /**
   * Get preferences for a specific user, category, and channel.
   */
  async getPreference(
    userId: string,
    category: NotificationCategory,
    channel: string,
  ): Promise<NotificationPreference | null> {
    return this.preferenceRepo.findOne({
      where: { userId, category, channel },
    });
  }

  /**
   * Update or create a preference for a user.
   */
  async updatePreference(
    userId: string,
    dto: UpdateNotificationPreferenceDto,
  ): Promise<NotificationPreference> {
    let preference = await this.preferenceRepo.findOne({
      where: {
        userId,
        category: dto.category,
        channel: dto.channel,
      },
    });

    if (preference) {
      Object.assign(preference, {
        preference: dto.preference,
        digestFrequency: dto.digestFrequency,
        quietHoursStart: dto.quietHoursStart,
        quietHoursEnd: dto.quietHoursEnd,
        timezone: dto.timezone,
        emailAddress: dto.emailAddress,
        phoneNumber: dto.phoneNumber,
        pushToken: dto.pushToken,
        webhookUrl: dto.webhookUrl,
        minPriority: dto.minPriority,
        active: dto.active,
        metadata: dto.metadata,
      });
    } else {
      preference = this.preferenceRepo.create({
        userId,
        category: dto.category,
        channel: dto.channel,
        preference: dto.preference,
        digestFrequency: dto.digestFrequency,
        quietHoursStart: dto.quietHoursStart,
        quietHoursEnd: dto.quietHoursEnd,
        timezone: dto.timezone,
        emailAddress: dto.emailAddress,
        phoneNumber: dto.phoneNumber,
        pushToken: dto.pushToken,
        webhookUrl: dto.webhookUrl,
        minPriority: dto.minPriority,
        active: dto.active,
        metadata: dto.metadata,
      });
    }

    const saved = await this.preferenceRepo.save(preference);
    this.logger.log(
      `Preference updated: user=${userId} category=${dto.category} channel=${dto.channel} → ${dto.preference}`,
    );
    return saved;
  }

  /**
   * Bulk update multiple preferences.
   */
  async bulkUpdate(
    userId: string,
    dtos: UpdateNotificationPreferenceDto[],
  ): Promise<NotificationPreference[]> {
    const results: NotificationPreference[] = [];
    for (const dto of dtos) {
      results.push(await this.updatePreference(userId, dto));
    }
    this.logger.log(`Bulk preference update: ${results.length} records for user ${userId}`);
    return results;
  }

  /**
   * Apply a preset to all channels for a category.
   */
  async setAllChannels(
    userId: string,
    dto: SetAllChannelsDto,
  ): Promise<NotificationPreference[]> {
    const channels = Object.values(NotificationChannel);
    const allCategories = Object.values(NotificationCategory);
    const categories = dto.category ? [dto.category] : allCategories;

    const preferences: NotificationPreference[] = [];

    for (const category of categories) {
      for (const channel of channels) {
        let pref: NotificationChannelPreference;

        switch (dto.preset) {
          case 'all_on':
            pref = NotificationChannelPreference.ENABLED;
            break;
          case 'all_off':
            pref = NotificationChannelPreference.DISABLED;
            break;
          case 'in_app_only':
            pref = channel === NotificationChannel.IN_APP
              ? NotificationChannelPreference.ENABLED
              : NotificationChannelPreference.DISABLED;
            break;
          case 'essential_only':
            pref = channel === NotificationChannel.IN_APP ||
              (category === NotificationCategory.SECURITY || category === NotificationCategory.TRANSACTION)
              ? NotificationChannelPreference.ENABLED
              : NotificationChannelPreference.DISABLED;
            break;
          default:
            pref = NotificationChannelPreference.ENABLED;
        }

        let preference = await this.preferenceRepo.findOne({
          where: { userId, category, channel },
        });

        if (preference) {
          preference.preference = pref;
        } else {
          preference = this.preferenceRepo.create({
            userId,
            category,
            channel,
            preference: pref,
          });
        }

        preferences.push(await this.preferenceRepo.save(preference));
      }
    }

    this.logger.log(
      `Bulk channel preset "${dto.preset}" applied for user ${userId}`,
    );
    return preferences;
  }

  /**
   * Seed default preferences for a new user.
   */
  async seedDefaults(userId: string): Promise<void> {
    const categories = Object.values(NotificationCategory);
    const channels = Object.values(NotificationChannel);

    for (const category of categories) {
      for (const channel of channels) {
        const existing = await this.preferenceRepo.findOne({
          where: { userId, category, channel },
        });
        if (!existing) {
          const isEssential =
            category === NotificationCategory.SECURITY ||
            category === NotificationCategory.TRANSACTION ||
            channel === NotificationChannel.IN_APP;

          await this.preferenceRepo.save(
            this.preferenceRepo.create({
              userId,
              category,
              channel,
              preference: isEssential
                ? NotificationChannelPreference.ENABLED
                : NotificationChannelPreference.DISABLED,
            }),
          );
        }
      }
    }
    this.logger.log(`Default preferences seeded for user ${userId}`);
  }

  /**
   * Delete all preferences for a user.
   */
  async deleteAll(userId: string): Promise<void> {
    await this.preferenceRepo.delete({ userId });
    this.logger.log(`All preferences deleted for user ${userId}`);
  }
}
