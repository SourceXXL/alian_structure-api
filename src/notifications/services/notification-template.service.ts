import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationTemplate } from '../entities/notification-template.entity';
import {
  CreateNotificationTemplateDto,
  UpdateNotificationTemplateDto,
} from '../dto/notification-template.dto';

@Injectable()
export class NotificationTemplateService {
  private readonly logger = new Logger(NotificationTemplateService.name);

  constructor(
    @InjectRepository(NotificationTemplate)
    private readonly templateRepo: Repository<NotificationTemplate>,
  ) {}

  async createTemplate(
    dto: CreateNotificationTemplateDto,
  ): Promise<NotificationTemplate> {
    const existing = await this.templateRepo.findOne({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException(`Template "${dto.name}" already exists`);
    }

    const template = this.templateRepo.create({
      name: dto.name,
      description: dto.description,
      channel: dto.channel,
      subject: dto.subject,
      bodyTemplate: dto.bodyTemplate,
      htmlTemplate: dto.htmlTemplate,
      smsTemplate: dto.smsTemplate,
      variables: dto.variables,
      category: dto.category,
      metadata: dto.metadata,
    });

    const saved = await this.templateRepo.save(template);
    this.logger.log(`Template created: ${saved.name}`);
    return saved;
  }

  async updateTemplate(
    name: string,
    dto: UpdateNotificationTemplateDto,
  ): Promise<NotificationTemplate> {
    const template = await this.templateRepo.findOne({ where: { name } });
    if (!template) {
      throw new NotFoundException(`Template "${name}" not found`);
    }

    Object.assign(template, dto);
    const saved = await this.templateRepo.save(template);
    this.logger.log(`Template updated: ${saved.name}`);
    return saved;
  }

  async getTemplate(name: string): Promise<NotificationTemplate> {
    const template = await this.templateRepo.findOne({ where: { name } });
    if (!template) {
      throw new NotFoundException(`Template "${name}" not found`);
    }
    return template;
  }

  async getAllTemplates(
    activeOnly = true,
  ): Promise<NotificationTemplate[]> {
    const where = activeOnly ? { active: true } : {};
    return this.templateRepo.find({ where, order: { name: 'ASC' } });
  }

  async deleteTemplate(name: string): Promise<void> {
    const template = await this.templateRepo.findOne({ where: { name } });
    if (!template) {
      throw new NotFoundException(`Template "${name}" not found`);
    }
    template.active = false;
    await this.templateRepo.save(template);
    this.logger.log(`Template deactivated: ${name}`);
  }

  /**
   * Render a template body by replacing {{variable}} placeholders.
   * Supports {{variable}}, {{{variable}}} (triple-brace for raw HTML), and
   * {{#if variable}}...{{/if}} conditional blocks.
   */
  renderBody(
    templateName: string,
    bodyTemplate: string,
    variables: Record<string, any> = {},
  ): string {
    let rendered = bodyTemplate;

    // Handle {{#if variable}}...{{/if}} blocks
    rendered = rendered.replace(
      /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_match, varName, content) => {
        return variables[varName] ? content : '';
      },
    );

    // Handle {{variable}} placeholders
    rendered = rendered.replace(/\{\{(\w+)\}\}/g, (_match, varName) => {
      return variables[varName] !== undefined
        ? String(variables[varName])
        : `{{${varName}}}`;
    });

    return rendered;
  }

  /**
   * Render the subject line of a notification.
   */
  renderSubject(
    templateName: string,
    variables: Record<string, any> = {},
  ): string {
    const template = this.templateNameCache.get(templateName);
    if (!template?.subject) return templateName;
    return this.renderBody(templateName, template.subject, variables);
  }

  // Simple in-memory cache for synchronous subject rendering
  private templateNameCache = new Map<string, NotificationTemplate>();

  async cacheTemplate(name: string): Promise<void> {
    const template = await this.templateRepo.findOne({ where: { name } });
    if (template) this.templateNameCache.set(name, template);
  }
}
