import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UrlSigningService } from './url-signing.service';

describe('UrlSigningService', () => {
  let urlSigningService: UrlSigningService;
  let jwtService: JwtService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UrlSigningService,
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('signed-jwt-token'),
            verify: jest.fn().mockReturnValue({
              sub: 'test-file-id',
              iat: Math.floor(Date.now() / 1000),
              exp: Math.floor(Date.now() / 1000) + 3600,
              type: 'download',
            }),
            decode: jest.fn().mockReturnValue({
              exp: Math.floor(Date.now() / 1000) + 3600,
            }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(3600), // Default expiry 1 hour
          },
        },
      ],
    }).compile();

    urlSigningService = module.get<UrlSigningService>(UrlSigningService);
    jwtService = module.get<JwtService>(JwtService);
  });

  it('should be defined', () => {
    expect(urlSigningService).toBeDefined();
  });

  describe('generateSignedUrl', () => {
    it('should generate a signed token with correct payload', () => {
      const fileId = 'test-file-id';
      const result = urlSigningService.generateSignedUrl(fileId, 3600);
      
      expect(jwtService.sign).toHaveBeenCalled();
      expect(result.token).toBe('signed-jwt-token');
      expect(result.expiry).toBeInstanceOf(Date);
    });

    it('should use default expiry when not provided', () => {
      const fileId = 'test-file-id';
      urlSigningService.generateSignedUrl(fileId);
      
      expect(jwtService.sign).toHaveBeenCalled();
    });
  });

  describe('verifySignedUrl', () => {
    it('should return true for valid tokens', () => {
      const result = urlSigningService.verifySignedUrl('valid-token', 'test-file-id');
      expect(result).toBe(true);
    });

    it('should return false for tokens with incorrect subject', () => {
      jest.spyOn(jwtService, 'verify').mockReturnValueOnce({
        sub: 'wrong-file-id',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        type: 'download',
      });
      
      const result = urlSigningService.verifySignedUrl('invalid-token', 'test-file-id');
      expect(result).toBe(false);
    });

    it('should return false for invalid tokens', () => {
      jest.spyOn(jwtService, 'verify').mockImplementationOnce(() => {
        throw new Error('Invalid token');
      });
      
      const result = urlSigningService.verifySignedUrl('invalid-token', 'test-file-id');
      expect(result).toBe(false);
    });
  });

  describe('getTokenExpiry', () => {
    it('should correctly extract expiry from token', () => {
      const expiry = urlSigningService.getTokenExpiry('test-token');
      expect(expiry).toBeInstanceOf(Date);
    });

    it('should return null for invalid tokens', () => {
      jest.spyOn(jwtService, 'decode').mockImplementationOnce(() => {
        throw new Error('Invalid token');
      });
      
      const expiry = urlSigningService.getTokenExpiry('invalid-token');
      expect(expiry).toBeNull();
    });
  });
});