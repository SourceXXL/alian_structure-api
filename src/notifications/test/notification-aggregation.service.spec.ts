import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationAggregationService } from '../services/notification-aggregation.service';
import { NotificationAggregation } from '../entities/notification-aggregation.entity';

describe('NotificationAggregationService', () => {
  let service: NotificationAggregationService;
  let repo: Repository<NotificationAggregation>;

  const mockRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(() => ({
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    })),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationAggregationService,
        { provide: getRepositoryToken(NotificationAggregation), useValue: mockRepo },
      ],
    }).compile();

    service = module.get<NotificationAggregationService>(NotificationAggregationService);
    repo = module.get(getRepositoryToken(NotificationAggregation));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkAggregation', () => {
    it('should allow notification through when no existing aggregation', async () => {
      mockRepo.findOne.mockResolvedValue(null);
      const newAgg = {
        id: 'agg-1',
        userId: 'user-1',
        aggregationKey: 'key-1',
        count: 1,
        sent: false,
      };
      mockRepo.create.mockReturnValue(newAgg);
      mockRepo.save.mockResolvedValue(newAgg);

      const result = await service.checkAggregation('user-1', 'key-1');

      expect(result.shouldSuppress).toBe(false);
      expect(result.currentCount).toBe(1);
      expect(mockRepo.create).toHaveBeenCalled();
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('should suppress when cooldown is still active', async () => {
      const existing = {
        id: 'agg-existing',
        userId: 'user-1',
        aggregationKey: 'key-1',
        count: 2,
        sent: false,
        lastNotificationAt: new Date(Date.now() - 1000), // 1 second ago
        cooldownSeconds: 300, // 5 minutes
      };
      mockRepo.findOne.mockResolvedValue(existing);
      mockRepo.save.mockResolvedValue({ ...existing, count: 3 });

      const result = await service.checkAggregation('user-1', 'key-1');

      expect(result.shouldSuppress).toBe(true);
      expect(result.currentCount).toBe(3);
      expect(existing.count).toBe(3);
    });

    it('should allow through when cooldown has expired', async () => {
      const expired = {
        id: 'agg-expired',
        userId: 'user-1',
        aggregationKey: 'key-1',
        count: 5,
        sent: false,
        lastNotificationAt: new Date(Date.now() - 600000), // 10 minutes ago
        cooldownSeconds: 300, // 5 minutes
      };
      mockRepo.findOne.mockResolvedValue(expired);

      const newAgg = {
        id: 'agg-new',
        userId: 'user-1',
        aggregationKey: 'key-1',
        count: 1,
        sent: false,
      };
      mockRepo.create.mockReturnValue(newAgg);
      mockRepo.save.mockResolvedValue(newAgg);

      const result = await service.checkAggregation('user-1', 'key-1');

      expect(result.shouldSuppress).toBe(false);
      expect(result.currentCount).toBe(1);
      // Old aggregation should be marked as sent
      expect(expired.sent).toBe(true);
    });

    it('should pass through without aggregation when no key provided', async () => {
      const result = await service.checkAggregation('user-1', '');

      expect(result.shouldSuppress).toBe(false);
      expect(result.currentCount).toBe(0);
      expect(mockRepo.findOne).not.toHaveBeenCalled();
    });
  });

  describe('linkNotification', () => {
    it('should update the aggregation with notification ID', async () => {
      await service.linkNotification('agg-1', 'notif-1');

      expect(mockRepo.update).toHaveBeenCalledWith('agg-1', {
        latestNotificationId: 'notif-1',
      });
    });
  });

  describe('getAggregationStats', () => {
    it('should return stats for active aggregation', async () => {
      const agg = {
        count: 3,
        lastNotificationAt: new Date(),
      };
      mockRepo.findOne.mockResolvedValue(agg);

      const stats = await service.getAggregationStats('user-1', 'key-1');

      expect(stats).toEqual({
        count: 3,
        lastNotificationAt: agg.lastNotificationAt,
      });
    });

    it('should return null when no active aggregation', async () => {
      mockRepo.findOne.mockResolvedValue(null);

      const stats = await service.getAggregationStats('user-1', 'key-1');

      expect(stats).toBeNull();
    });
  });

  describe('cleanupOldAggregations', () => {
    it('should delete old aggregation records', async () => {
      const qb = {
        delete: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 5 }),
      };
      mockRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.cleanupOldAggregations();

      expect(result).toBe(5);
    });
  });
});
