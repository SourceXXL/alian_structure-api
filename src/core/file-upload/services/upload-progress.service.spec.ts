import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UploadProgressService } from './upload-progress.service';
import { UploadSessionEntity } from '../entities/upload-session.entity';
import { UploadSessionStatus } from '../entities/upload-session.entity';

describe('UploadProgressService', () => {
  let uploadProgressService: UploadProgressService;
  let uploadSessionRepository: Repository<UploadSessionEntity>;

  const mockSession = {
    id: 'test-session-id',
    fileId: 'test-file-id',
    totalSize: 1000000, // 1MB
    uploadedSize: 500000, // 500KB uploaded
    receivedChunks: [0, 1],
    totalChunks: 4,
    status: UploadSessionStatus.PENDING,
    lastChunkReceivedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UploadProgressService,
        {
          provide: getRepositoryToken(UploadSessionEntity),
          useValue: {
            findOne: jest.fn().mockResolvedValue(mockSession),
            save: jest.fn().mockResolvedValue(true),
            find: jest.fn().mockResolvedValue([mockSession]),
          },
        },
      ],
    }).compile();

    uploadProgressService = module.get<UploadProgressService>(UploadProgressService);
    uploadSessionRepository = module.get<Repository<UploadSessionEntity>>(getRepositoryToken(UploadSessionEntity));
  });

  it('should be defined', () => {
    expect(uploadProgressService).toBeDefined();
  });

  describe('getUploadProgress', () => {
    it('should return upload progress for a valid session', async () => {
      const progress = await uploadProgressService.getUploadProgress('test-session-id');
      
      expect(progress).not.toBeNull();
      expect(progress?.sessionId).toBe('test-session-id');
      expect(progress?.percentage).toBe(50); // 500KB / 1MB = 50%
      expect(progress?.chunksReceived).toBe(2);
      expect(progress?.totalChunks).toBe(4);
    });

    it('should return null for non-existent sessions', async () => {
      jest.spyOn(uploadSessionRepository, 'findOne').mockResolvedValueOnce(null);
      
      const progress = await uploadProgressService.getUploadProgress('non-existent-session');
      expect(progress).toBeNull();
    });
  });

  describe('updateChunkProgress', () => {
    it('should update progress when a new chunk is received', async () => {
      const progress = await uploadProgressService.updateChunkProgress('test-session-id', 2, 250000);
      
      expect(uploadSessionRepository.save).toHaveBeenCalled();
      expect(progress?.uploadedSize).toBe(750000);
      expect(progress?.chunksReceived).toBe(3);
    });

    it('should not double count chunks that are already received', async () => {
      // Chunk 1 is already in receivedChunks
      const progress = await uploadProgressService.updateChunkProgress('test-session-id', 1, 250000);
      
      expect(progress?.uploadedSize).toBe(500000); // Size doesn't change
      expect(progress?.chunksReceived).toBe(2); // Chunk count doesn't change
    });
  });

  describe('isUploadComplete', () => {
    it('should return false when not all chunks are received', async () => {
      const isComplete = await uploadProgressService.isUploadComplete('test-session-id');
      expect(isComplete).toBe(false);
    });

    it('should return true when all chunks are received', async () => {
      jest.spyOn(uploadSessionRepository, 'findOne').mockResolvedValueOnce({
        ...mockSession,
        receivedChunks: [0, 1, 2, 3], // All 4 chunks received
      });
      
      const isComplete = await uploadProgressService.isUploadComplete('test-session-id');
      expect(isComplete).toBe(true);
    });
  });

  describe('markAsCompleted', () => {
    it('should update session status to completed', async () => {
      const result = await uploadProgressService.markAsCompleted('test-session-id', 'processed-file-id');
      
      expect(uploadSessionRepository.save).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });

  describe('markAsFailed', () => {
    it('should update session status to failed with error message', async () => {
      const result = await uploadProgressService.markAsFailed('test-session-id', 'Upload failed due to network error');
      
      expect(uploadSessionRepository.save).toHaveBeenCalled();
      expect(result).toBe(true);
    });
  });
});