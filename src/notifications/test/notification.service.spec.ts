import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationService } from '../services/notification.service';
import { NotificationTemplateService } from '../services/notification-template.service';
import { NotificationAggregationService } from '../services/notification-aggregation.service';
import { NotificationQueueService } from '../services/notification-queue.service';
import {
  Notification,
  NotificationStatus,
  NotificationChannel,
  NotificationPriority,
  NotificationCategory,
} from '../entities/notification.entity';
import { NotificationDeliveryLog } from '../entities/notification-delivery-log.entity';
import { SendNotificationDto } from '../dto/send-notification.dto';
import { QueryNotificationHistoryDto } from '../dto/query-notification.dto';

describe('NotificationService', () => {
  let service: NotificationService;
  let notificationRepo: Repository<Notification>;
  let deliveryLogRepo: Repository<NotificationDeliveryLog>;
  let templateService: NotificationTemplateService;
  let aggregationService: NotificationAggregationService;
  let queueService: NotificationQueueService;
  let eventEmitter: EventEmitter2;

  const mockQueryBuilder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getCount: jest.fn().mockResolvedValue(0),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 1 }),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue([]),
  };

  const mockNotificationRepo = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(() => mockQueryBuilder),
  };

  const mockDeliveryLogRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
  };

  const mockTemplateService = {
    getTemplate: jest.fn(),
    renderBody: jest.fn(),
  };

  const mockAggregationService = {
    checkAggregation: jest.fn().mockResolvedValue({
      shouldSuppress: false,
      aggregation: { id: 'agg-1', count: 1 },
      currentCount: 1,
    }),
    linkNotification: jest.fn(),
    getAggregationStats: jest.fn(),
  };

  const mockQueueService = {
    enqueueNotification: jest.fn(),
    enqueueScheduledNotification: jest.fn(),
    cancelNotification: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        { provide: getRepositoryToken(Notification), useValue: mockNotificationRepo },
        { provide: getRepositoryToken(NotificationDeliveryLog), useValue: mockDeliveryLogRepo },
        { provide: NotificationTemplateService, useValue: mockTemplateService },
        { provide: NotificationAggregationService, useValue: mockAggregationService },
        { provide: NotificationQueueService, useValue: mockQueueService },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    notificationRepo = module.get(getRepositoryToken(Notification));
    deliveryLogRepo = module.get(getRepositoryToken(NotificationDeliveryLog));
    templateService = module.get<NotificationTemplateService>(NotificationTemplateService);
    aggregationService = module.get<NotificationAggregationService>(NotificationAggregationService);
    queueService = module.get<NotificationQueueService>(NotificationQueueService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('send', () => {
    it('should create and queue a notification', async () => {
      const dto: SendNotificationDto = {
        userId: 'user-1',
        title: 'Test Title',
        body: 'Test Body',
        category: NotificationCategory.SYSTEM,
        priority: NotificationPriority.NORMAL,
        primaryChannel: NotificationChannel.IN_APP,
      };

      const createdNotification = {
        id: 'notif-1',
        ...dto,
        status: NotificationStatus.QUEUED,
        read: false,
        createdAt: new Date(),
        aggregationCount: 0,
        maxAttempts: 5,
        attemptCount: 0,
        deleted: false,
      };

      mockNotificationRepo.create.mockReturnValue(createdNotification);
      mockNotificationRepo.save.mockResolvedValue(createdNotification);

      const result = await service.send(dto);

      expect(result).toEqual(createdNotification);
      expect(mockNotificationRepo.create).toHaveBeenCalled();
      expect(mockNotificationRepo.save).toHaveBeenCalled();
      expect(mockQueueService.enqueueNotification).toHaveBeenCalledWith(
        createdNotification.id,
        expect.any(Object),
      );
    });

    it('should schedule a notification when scheduledAt is provided', async () => {
      const futureDate = new Date(Date.now() + 3600000);
      const dto: SendNotificationDto = {
        userId: 'user-1',
        title: 'Scheduled',
        body: 'Scheduled body',
        scheduledAt: futureDate.toISOString(),
      };

      const createdNotification = {
        id: 'notif-sched',
        ...dto,
        status: NotificationStatus.SCHEDULED,
        read: false,
        createdAt: new Date(),
        aggregationCount: 0,
        maxAttempts: 5,
        attemptCount: 0,
        deleted: false,
      };

      mockNotificationRepo.create.mockReturnValue(createdNotification);
      mockNotificationRepo.save.mockResolvedValue(createdNotification);

      await service.send(dto);

      expect(mockQueueService.enqueueScheduledNotification).toHaveBeenCalledWith(
        createdNotification.id,
        expect.any(Date),
      );
    });

    it('should suppress notification when aggregation triggers suppression', async () => {
      mockAggregationService.checkAggregation.mockResolvedValue({
        shouldSuppress: true,
        aggregation: { id: 'agg-1', count: 3 },
        currentCount: 3,
      });
      mockAggregationService.getAggregationStats.mockResolvedValue(null);

      const dto: SendNotificationDto = {
        userId: 'user-1',
        title: 'Duplicate',
        body: 'Dup body',
        aggregationKey: 'portfolio-drop',
      };

      const suppressedNotif = {
        id: 'notif-suppressed',
        ...dto,
        status: NotificationStatus.CANCELLED,
      };

      mockNotificationRepo.create.mockReturnValue(suppressedNotif);
      mockNotificationRepo.save.mockResolvedValue(suppressedNotif);

      const result = await service.send(dto);

      expect(result.status).toBe(NotificationStatus.CANCELLED);
      expect(mockQueueService.enqueueNotification).not.toHaveBeenCalled();
    });

    it('should render template when templateName and templateVars are provided', async () => {
      mockTemplateService.getTemplate.mockResolvedValue({
        name: 'welcome',
        bodyTemplate: 'Hello {{name}}!',
        htmlTemplate: '<h1>Hello {{name}}!</h1>',
        subject: 'Welcome {{name}}',
      });
      mockTemplateService.renderBody
        .mockReturnValueOnce('Hello Alice!')
        .mockReturnValueOnce('<h1>Hello Alice!</h1>')
        .mockReturnValueOnce('Welcome Alice');

      const dto: SendNotificationDto = {
        userId: 'user-1',
        title: 'Welcome',
        body: 'Hello {{name}}!',
        templateName: 'welcome',
        templateVars: { name: 'Alice' },
      };

      const createdNotif = { id: 'notif-tpl', ...dto };
      mockNotificationRepo.create.mockReturnValue(createdNotif);
      mockNotificationRepo.save.mockResolvedValue(createdNotif);

      await service.send(dto);

      expect(mockTemplateService.getTemplate).toHaveBeenCalledWith('welcome');
      expect(mockTemplateService.renderBody).toHaveBeenCalledTimes(3);
    });
  });

  describe('sendBulk', () => {
    it('should send multiple notifications', async () => {
      const dto = {
        notifications: [
          { userId: 'user-1', title: 'A', body: 'Body A' },
          { userId: 'user-2', title: 'B', body: 'Body B' },
        ],
      };

      const created = [
        { id: 'n1', userId: 'user-1', title: 'A' },
        { id: 'n2', userId: 'user-2', title: 'B' },
      ];

      let callCount = 0;
      mockNotificationRepo.create.mockImplementation(() => created[callCount++]);
      mockNotificationRepo.save.mockImplementation(async (n) => n);

      const results = await service.sendBulk(dto as any);

      expect(results).toHaveLength(2);
      expect(mockQueueService.enqueueNotification).toHaveBeenCalledTimes(2);
    });
  });

  describe('markAsRead', () => {
    it('should mark notifications as read', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 3 });

      const result = await service.markAsRead(['n1', 'n2', 'n3']);

      expect(result.updated).toBe(3);
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all user notifications as read', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 10 });

      const result = await service.markAllAsRead('user-1');

      expect(result.updated).toBe(10);
    });

    it('should filter by category when specified', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 5 });

      await service.markAllAsRead('user-1', { category: 'security' });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'category = :category',
        { category: 'security' },
      );
    });
  });

  describe('markAsUnread', () => {
    it('should mark notifications as unread', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 2 });

      const result = await service.markAsUnread(['n1', 'n2']);

      expect(result.updated).toBe(2);
    });
  });

  describe('getUnreadCount', () => {
    it('should return unread count by category', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([
        { category: 'security', count: '3' },
        { category: 'transaction', count: '5' },
      ]);

      const result = await service.getUnreadCount('user-1');

      expect(result.total).toBe(8);
      expect(result.byCategory).toEqual({
        security: 3,
        transaction: 5,
      });
    });

    it('should return zero when no unread', async () => {
      mockQueryBuilder.getRawMany.mockResolvedValue([]);

      const result = await service.getUnreadCount('user-1');

      expect(result.total).toBe(0);
      expect(result.byCategory).toEqual({});
    });
  });

  describe('getHistory', () => {
    it('should return paginated notification history', async () => {
      const notifications = [
        { id: 'n1', title: 'A', createdAt: new Date() },
        { id: 'n2', title: 'B', createdAt: new Date() },
      ];
      mockQueryBuilder.getMany.mockResolvedValue([...notifications]);
      mockQueryBuilder.getCount.mockResolvedValue(2);

      const dto: QueryNotificationHistoryDto = {
        userId: 'user-1',
        limit: 10,
      };

      const result = await service.getHistory(dto);

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.nextCursor).toBeNull();
    });

    it('should generate cursor when there are more results', async () => {
      const notifications = Array.from({ length: 21 }, (_, i) => ({
        id: `n${i}`,
        title: `Title ${i}`,
        createdAt: new Date(2025, 0, 1),
      }));
      mockQueryBuilder.getMany.mockResolvedValue(notifications);

      const dto: QueryNotificationHistoryDto = {
        userId: 'user-1',
        limit: 20,
      };

      const result = await service.getHistory(dto);

      expect(result.data).toHaveLength(20);
      expect(result.nextCursor).toBeDefined();
      // Cursor should be a valid base64 string
      expect(() => Buffer.from(result.nextCursor!, 'base64')).not.toThrow();
    });

    it('should apply category filter', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      await service.getHistory({
        userId: 'user-1',
        category: NotificationCategory.SECURITY,
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'n.category = :category',
        { category: 'security' },
      );
    });

    it('should apply read filter', async () => {
      mockQueryBuilder.getMany.mockResolvedValue([]);

      await service.getHistory({
        userId: 'user-1',
        read: false,
      });

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith('n.read = false');
    });
  });

  describe('cancel', () => {
    it('should cancel a scheduled notification', async () => {
      const notif = {
        id: 'n1',
        status: NotificationStatus.SCHEDULED,
      };
      mockNotificationRepo.findOne.mockResolvedValue(notif);
      mockNotificationRepo.save.mockImplementation(async (n) => n);

      const result = await service.cancel('n1');

      expect(result.status).toBe(NotificationStatus.CANCELLED);
      expect(mockQueueService.cancelNotification).toHaveBeenCalledWith('n1');
    });

    it('should throw if notification is not scheduled', async () => {
      mockNotificationRepo.findOne.mockResolvedValue({
        id: 'n1',
        status: NotificationStatus.DELIVERED,
      });

      await expect(service.cancel('n1')).rejects.toThrow();
    });
  });

  describe('trackClick', () => {
    it('should mark notification as clicked', async () => {
      await service.trackClick('n1');

      expect(mockNotificationRepo.update).toHaveBeenCalledWith('n1', {
        clicked: true,
        clickedAt: expect.any(Date),
      });
    });
  });

  describe('softDelete', () => {
    it('should soft-delete notifications', async () => {
      mockQueryBuilder.execute.mockResolvedValue({ affected: 2 });

      const result = await service.softDelete(['n1', 'n2']);

      expect(result.deleted).toBe(2);
    });
  });
});
