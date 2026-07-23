import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { LocalStorageBackend } from './local-storage.backend';
import { UrlSigningService } from '../services/url-signing.service';
import { JwtService } from '@nestjs/jwt';

describe('LocalStorageBackend', () => {
  let localStorageBackend: LocalStorageBackend;
  let urlSigningService: UrlSigningService;
  let configService: ConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalStorageBackend,
        {
          provide: UrlSigningService,
          useValue: {
            generateSignedUrl: jest.fn().mockReturnValue({
              token: 'test-token',
              expiry: new Date(Date.now() + 3600 * 1000),
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              switch (key) {
                case 'LOCAL_STORAGE_PATH':
                  return './test-uploads';
                case 'APP_BASE_URL':
                  return 'http://localhost:3000';
                default:
                  return null;
              }
            }),
          },
        },
        JwtService,
      ],
    }).compile();

    localStorageBackend = module.get<LocalStorageBackend>(LocalStorageBackend);
    urlSigningService = module.get<UrlSigningService>(UrlSigningService);
    configService = module.get<ConfigService>(ConfigService);
  });

  it('should be defined', () => {
    expect(localStorageBackend).toBeDefined();
  });

  it('should initialize storage directories correctly', () => {
    const uploadPath = configService.get('LOCAL_STORAGE_PATH');
    expect(uploadPath).toBe('./test-uploads');
  });

  describe('getSignedUrl', () => {
    it('should generate a signed URL using UrlSigningService', async () => {
      const fileId = 'test-file-id';
      const signedUrl = await localStorageBackend.getSignedUrl(fileId, 3600);
      
      expect(urlSigningService.generateSignedUrl).toHaveBeenCalledWith(fileId, 3600);
      expect(signedUrl).toContain('/api/files/download/test-file-id?token=test-token');
      expect(signedUrl).toContain('http://localhost:3000');
    });

    it('should use default expiry if not provided', async () => {
      const fileId = 'test-file-id';
      await localStorageBackend.getSignedUrl(fileId);
      
      expect(urlSigningService.generateSignedUrl).toHaveBeenCalledWith(fileId, 3600);
    });
  });
});