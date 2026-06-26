import { Test, TestingModule } from "@nestjs/testing";
import { WalletAuthService } from "./wallet-auth.service";
import { ChallengeService } from "./challenge.service";
import { EnhancedAuthService } from "./enhanced-auth.service";
import { JwtService } from "@nestjs/jwt";
import { getRepositoryToken } from "@nestjs/typeorm";
import { User, UserRole, KycStatus } from "../user/entities/user.entity";
import { Wallet, WalletType, WalletStatus } from "./entities/wallet.entity";
import { Repository } from "typeorm";
import {
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";

// Mock ethers
jest.mock("ethers", () => ({
  verifyMessage: jest.fn(),
}));

describe("WalletAuthService", () => {
  let service: WalletAuthService;
  let challengeService: ChallengeService;
  let jwtService: JwtService;
  let userRepository: Repository<User>;
  let verifyMessage: jest.Mock;

  const mockWallet = {
    id: "wallet-123",
    address: "0x1234567890abcdef1234567890abcdef12345678",
    type: WalletType.PRIMARY,
    status: WalletStatus.ACTIVE,
    userId: "123",
    isPrimary: true,
    name: "Primary Wallet",
    user: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    verificationSignature: null,
    verificationChallenge: null,
    verifiedAt: null,
    linkedIp: null,
    linkedUserAgent: null,
    delegatedById: null,
    delegationExpiresAt: null,
    delegationPermissions: null,
    lastUsedAt: null,
    recoveryCodeHash: null,
    recoveryEnabled: false,
    nonce: "0",
  } as Wallet;

  const mockSecondWallet = {
    id: "wallet-456",
    address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    type: WalletType.SECONDARY,
    status: WalletStatus.ACTIVE,
    userId: "123",
    isPrimary: false,
    name: "Secondary Wallet",
    user: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    verificationSignature: null,
    verificationChallenge: null,
    verifiedAt: null,
    linkedIp: null,
    linkedUserAgent: null,
    delegatedById: null,
    delegationExpiresAt: null,
    delegationPermissions: null,
    lastUsedAt: null,
    recoveryCodeHash: null,
    recoveryEnabled: false,
    nonce: "0",
  } as Wallet;

  const mockUser: User = {
    id: "123",
    username: null,
    walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
    email: "test@example.com",
    password: null,
    emailVerified: true,
    role: UserRole.USER,
    kycStatus: KycStatus.UNVERIFIED,
    isActive: true,
    lastLoginAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    provenanceRecords: [],
    wallets: [mockWallet, mockSecondWallet],
    referralCode: "ABC123",
    referredById: null,
    referredBy: null,
    referrals: [],
        socialAccounts: [],
  };

  const mockChallengeService = {
    issueChallengeForAddress: jest.fn(),
    extractChallengeId: jest.fn(),
    consumeChallenge: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
    verify: jest.fn(),
  };

  const mockEnhancedAuthService = {
    isTwoFactorEnabled: jest.fn().mockResolvedValue(false),
    verifyTwoFactorCode: jest.fn().mockResolvedValue(undefined),
  };

  const mockUserRepository = {
    findOne: jest.fn(),
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  const mockWalletRepository = {
    findOne: jest.fn().mockResolvedValue(mockWallet),
    save: jest.fn().mockResolvedValue(mockWallet),
    create: jest.fn().mockReturnValue(mockWallet),
    find: jest.fn().mockResolvedValue([mockWallet]),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };

  beforeEach(async () => {
    // Reset all mock implementations to their defaults before each test
    mockUserRepository.findOne.mockReset();
    mockUserRepository.findOne.mockResolvedValue(mockUser);
    mockWalletRepository.findOne.mockReset();
    mockWalletRepository.findOne.mockResolvedValue(mockWallet);
    mockWalletRepository.find.mockReset();
    mockWalletRepository.find.mockResolvedValue([mockWallet]);

    // Get the mocked verifyMessage
    verifyMessage = require("ethers").verifyMessage;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletAuthService,
        {
          provide: ChallengeService,
          useValue: mockChallengeService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
        {
          provide: EnhancedAuthService,
          useValue: mockEnhancedAuthService,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(Wallet),
          useValue: mockWalletRepository,
        },
      ],
    }).compile();

    service = module.get<WalletAuthService>(WalletAuthService);
    challengeService = module.get<ChallengeService>(ChallengeService);
    jwtService = module.get<JwtService>(JwtService);
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));

    jest.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("linkWallet", () => {
    const currentAddress = "0x1234567890abcdef1234567890abcdef12345678";
    const newAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const message = "Sign this message to prove ownership";
    const signature = "0x" + "1".repeat(130);
    const challengeId = "challenge-123";

    it("should successfully link a new wallet", async () => {
      mockChallengeService.extractChallengeId.mockReturnValue(challengeId);
      mockChallengeService.consumeChallenge.mockReturnValue({
        address: newAddress.toLowerCase(),
        timestamp: Date.now(),
      });
      verifyMessage.mockReturnValue(newAddress); // Mock signature verification
      // Return null for the new wallet address (not found), then return mockUser for current user lookup
      mockWalletRepository.findOne.mockResolvedValueOnce(null);
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      // Return empty array for existing user wallets, so it creates a new wallet
      mockWalletRepository.find.mockResolvedValueOnce([]);
      mockUserRepository.save.mockResolvedValue({
        ...mockUser,
        walletAddress: newAddress.toLowerCase(),
      });

      const result = await service.linkWallet(
        currentAddress,
        newAddress,
        message,
        signature,
      );

      expect(result.message).toBe("Wallet successfully linked");
      expect(result.walletAddress).toBe(newAddress.toLowerCase());
      expect(mockUserRepository.update).toHaveBeenCalled();
    });

    it("should throw ConflictException if new wallet is already in use", async () => {
      mockChallengeService.extractChallengeId.mockReturnValue(challengeId);
      mockChallengeService.consumeChallenge.mockReturnValue({
        address: newAddress.toLowerCase(),
        timestamp: Date.now(),
      });
      verifyMessage.mockReturnValue(newAddress); // Mock signature verification
      mockUserRepository.findOne.mockResolvedValueOnce(mockUser); // Wallet already exists

      await expect(
        service.linkWallet(currentAddress, newAddress, message, signature),
      ).rejects.toThrow(ConflictException);
    });

    it("should throw UnauthorizedException for invalid challenge", async () => {
      mockChallengeService.extractChallengeId.mockReturnValue(null);

      await expect(
        service.linkWallet(currentAddress, newAddress, message, signature),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should successfully link a secondary wallet when user already has one", async () => {
      mockChallengeService.extractChallengeId.mockReturnValue(challengeId);
      mockChallengeService.consumeChallenge.mockReturnValue({
        address: newAddress.toLowerCase(),
        timestamp: Date.now(),
      });
      verifyMessage.mockReturnValue(newAddress); // Mock signature verification
      // New wallet is available
      mockWalletRepository.findOne.mockResolvedValueOnce(null);
      // User already has one wallet
      mockWalletRepository.find.mockResolvedValueOnce([mockWallet]);
      // Create returns a secondary wallet
      const mockSecondaryWallet = {
        ...mockWallet,
        id: "wallet-456",
        type: WalletType.SECONDARY,
      };
      mockWalletRepository.create.mockReturnValueOnce(mockSecondaryWallet);
      mockWalletRepository.save.mockResolvedValueOnce(mockSecondaryWallet);

      const result = await service.linkWallet(
        mockUser.id,
        newAddress,
        message,
        signature,
      );

      expect(result.message).toBe("Wallet successfully linked");
      expect(result.type).toBe(WalletType.SECONDARY);
      // Don't update user's primary wallet since it's a secondary wallet
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });
  });

  describe("unlinkWallet", () => {
    it("should successfully unlink wallet with verified email", async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      // Return both wallets so the service doesn't think it's the only wallet
      mockWalletRepository.find.mockResolvedValueOnce([
        mockWallet,
        mockSecondWallet,
      ]);
      // Return the second wallet when looking it up
      mockWalletRepository.findOne.mockResolvedValueOnce(mockSecondWallet);

      const result = await service.unlinkWallet(
        mockUser.id,
        mockSecondWallet.id,
      );

      expect(result.message).toContain("Wallet successfully unlinked");
      expect(mockWalletRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockSecondWallet.id, userId: mockUser.id },
      });
    });

    it("should throw NotFoundException if wallet not found", async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockWalletRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.unlinkWallet(mockUser.id, "non-existent-wallet-id"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException if email is null and trying to unlink only wallet", async () => {
      const noEmailUser = { ...mockUser, email: null, emailVerified: false };
      // Always return noEmailUser for any findOne call in this test
      mockUserRepository.findOne.mockImplementation(() =>
        Promise.resolve(noEmailUser),
      );
      // Only one wallet exists - use mockImplementation to ensure it's always returned
      mockWalletRepository.find.mockImplementation(() =>
        Promise.resolve([mockWallet]),
      );
      mockWalletRepository.findOne.mockResolvedValueOnce(mockWallet);

      await expect(
        service.unlinkWallet(noEmailUser.id, mockWallet.id),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException if it's the only wallet and email not verified", async () => {
      const unverifiedUser = { ...mockUser, emailVerified: false };
      mockUserRepository.findOne.mockResolvedValue(unverifiedUser);
      // Only one wallet exists - use exact same setup as the passing email-null test
      mockWalletRepository.find.mockResolvedValueOnce([mockWallet]);
      mockWalletRepository.findOne.mockResolvedValueOnce(mockWallet);

      await expect(
        service.unlinkWallet(unverifiedUser.id, mockWallet.id),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw NotFoundException if user not found when looking up wallet", async () => {
      mockWalletRepository.findOne.mockResolvedValueOnce(null);

      await expect(
        service.unlinkWallet("non-existent-user-id", mockSecondWallet.id),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("recoverWallet", () => {
    const email = "test@example.com";
    const recoveryToken = "a".repeat(64);
    const challengeMessage = "Sign this challenge";

    it("should successfully initiate wallet recovery", async () => {
      mockUserRepository.findOne.mockResolvedValue(mockUser);
      mockChallengeService.issueChallengeForAddress.mockReturnValue(
        challengeMessage,
      );

      const result = await service.recoverWallet(email, recoveryToken);

      expect(result.message).toContain("Recovery initiated");
      expect(result.walletAddress).toBe(mockUser.walletAddress);
      expect(result.challenge).toBe(challengeMessage);
      expect(
        mockChallengeService.issueChallengeForAddress,
      ).toHaveBeenCalledWith(mockUser.walletAddress);
      expect(mockUserRepository.findOne).toHaveBeenCalledWith({
        where: { email: email.toLowerCase(), emailVerified: true },
      });
    });

    it("should throw BadRequestException if user not found", async () => {
      mockUserRepository.findOne.mockResolvedValue(null);

      await expect(service.recoverWallet(email, recoveryToken)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw BadRequestException if email not verified", async () => {
      const unverifiedUser = { ...mockUser, emailVerified: false };
      mockUserRepository.findOne.mockResolvedValue(null); // Query filters by emailVerified: true

      await expect(service.recoverWallet(email, recoveryToken)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe("validateToken", () => {
    it("should successfully validate a valid token", () => {
      const token = "valid.jwt.token";
      const payload = {
        address: mockUser.walletAddress,
        email: mockUser.email,
        role: mockUser.role,
        iat: Math.floor(Date.now() / 1000),
      };
      mockJwtService.verify.mockReturnValue(payload);

      const result = service.validateToken(token);

      expect(result).toEqual(payload);
      expect(mockJwtService.verify).toHaveBeenCalledWith(token);
    });

    it("should throw UnauthorizedException for invalid token", () => {
      const token = "invalid.token";
      mockJwtService.verify.mockImplementation(() => {
        throw new Error("Invalid token");
      });

      expect(() => service.validateToken(token)).toThrow(UnauthorizedException);
    });
  });
});
