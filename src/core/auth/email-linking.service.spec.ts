import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { EmailLinkingService } from "./email-linking.service";
import { EmailService } from "./email.service";
import { User } from "../user/entities/user.entity";
import { EmailVerification } from "./entities/email-verification.entity";
import { Wallet } from "./entities/wallet.entity";

const WALLET_ADDRESS = "0x1234567890123456789012345678901234567890";

/**
 * The repository mocks are held in local variables rather than being read back
 * off `module.get(...)`: `Repository.create` is an overloaded method, so
 * `repository.create.mock` is not typed on a `Repository<T>` and the assertion
 * would not compile.
 */
type RepositoryMock = {
  findOne: jest.Mock;
  create: jest.Mock;
  save: jest.Mock;
  delete: jest.Mock;
};

/**
 * `EmailLinkingService` resolves everything through the Wallet repository
 * (`walletRepository.findOne({ where: { address }, relations: ["user"] })`),
 * not directly through the User repository, so the Wallet repo is the primary
 * seam for these tests.
 */
describe("EmailLinkingService", () => {
  let service: EmailLinkingService;
  let userRepo: RepositoryMock;
  let verificationRepo: RepositoryMock;
  let walletRepo: RepositoryMock;
  let emailService: { sendVerificationEmail: jest.Mock };

  // The User entity has many required columns; these are the ones
  // EmailLinkingService actually reads.
  const buildUser = (overrides: Partial<User> = {}): User =>
    ({
      id: "user-1",
      walletAddress: WALLET_ADDRESS,
      email: null,
      emailVerified: false,
      ...overrides,
    }) as unknown as User;

  const buildWallet = (user: User | null): Wallet =>
    ({
      id: "wallet-1",
      address: WALLET_ADDRESS,
      user,
    }) as unknown as Wallet;

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(async (user) => user),
      delete: jest.fn(),
    };
    verificationRepo = {
      findOne: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
      delete: jest.fn(),
    };
    walletRepo = {
      findOne: jest.fn(),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
      delete: jest.fn(),
    };
    emailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue({
        messageId: "test-message-id",
        previewUrl: "https://ethereal.email/message/test",
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailLinkingService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(EmailVerification),
          useValue: verificationRepo,
        },
        { provide: getRepositoryToken(Wallet), useValue: walletRepo },
        { provide: EmailService, useValue: emailService },
      ],
    }).compile();

    service = module.get(EmailLinkingService);

    // Sensible defaults; individual tests override what they care about.
    walletRepo.findOne.mockResolvedValue(buildWallet(buildUser()));
    userRepo.findOne.mockResolvedValue(null);
    verificationRepo.delete.mockResolvedValue(undefined);
  });

  describe("initiateEmailLinking", () => {
    it("sends a verification email and returns a preview url", async () => {
      const result = await service.initiateEmailLinking(
        WALLET_ADDRESS,
        "test@example.com",
      );

      expect(result.message).toContain("Verification email sent");
      expect(result.previewUrl).toBe("https://ethereal.email/message/test");
      expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
        "test@example.com",
        expect.stringMatching(/^[0-9a-f]{64}$/),
      );
    });

    it("persists a 64 hex character verification token valid for 15 minutes", async () => {
      const before = Date.now();
      await service.initiateEmailLinking(WALLET_ADDRESS, "Test@Example.com");

      const createArgs = verificationRepo.create.mock
        .calls[0][0] as EmailVerification;

      expect(createArgs.email).toBe("test@example.com");
      expect(createArgs.walletAddress).toBe(WALLET_ADDRESS.toLowerCase());
      expect(createArgs.token).toMatch(/^[0-9a-f]{64}$/);
      expect(createArgs.expiresAt.getTime()).toBeGreaterThanOrEqual(
        before + 15 * 60 * 1000,
      );
      expect(createArgs.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 15 * 60 * 1000,
      );
    });

    it("rejects an invalid email format", async () => {
      await expect(
        service.initiateEmailLinking(WALLET_ADDRESS, "invalid-email"),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects an unknown wallet", async () => {
      walletRepo.findOne.mockResolvedValue(null);

      await expect(
        service.initiateEmailLinking(WALLET_ADDRESS, "test@example.com"),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects an email already linked to a different account", async () => {
      userRepo.findOne.mockResolvedValue(buildUser({ id: "someone-else" }));

      await expect(
        service.initiateEmailLinking(WALLET_ADDRESS, "test@example.com"),
      ).rejects.toThrow(ConflictException);
    });

    it("rejects an email that is already verified for this wallet", async () => {
      walletRepo.findOne.mockResolvedValue(
        buildWallet(
          buildUser({ email: "test@example.com", emailVerified: true }),
        ),
      );

      await expect(
        service.initiateEmailLinking(WALLET_ADDRESS, "test@example.com"),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("verifyEmailAndLink", () => {
    const buildVerification = (expiresAt: Date): EmailVerification =>
      ({
        id: "1",
        email: "test@example.com",
        token: "a".repeat(64),
        walletAddress: WALLET_ADDRESS,
        expiresAt,
        createdAt: new Date(),
      }) as EmailVerification;

    it("marks the user email as verified and links it to the wallet", async () => {
      const user = buildUser();
      verificationRepo.findOne.mockResolvedValue(
        buildVerification(new Date(Date.now() + 10 * 60 * 1000)),
      );
      walletRepo.findOne.mockResolvedValue(buildWallet(user));

      const result = await service.verifyEmailAndLink("a".repeat(64));

      expect(result.message).toContain("successfully verified");
      expect(result.email).toBe("test@example.com");
      expect(result.walletAddress).toBe(WALLET_ADDRESS);
      expect(user.email).toBe("test@example.com");
      expect(user.emailVerified).toBe(true);
      expect(userRepo.save).toHaveBeenCalled();
    });

    it("rejects an unknown token", async () => {
      verificationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.verifyEmailAndLink("invalid-token"),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects an expired token and deletes the record", async () => {
      verificationRepo.findOne.mockResolvedValue(
        buildVerification(new Date(Date.now() - 1000)),
      );

      await expect(
        service.verifyEmailAndLink("a".repeat(64)),
      ).rejects.toThrow(UnauthorizedException);
      expect(verificationRepo.delete).toHaveBeenCalledWith({
        token: "a".repeat(64),
      });
    });

    it("rejects a verification whose wallet no longer exists", async () => {
      verificationRepo.findOne.mockResolvedValue(
        buildVerification(new Date(Date.now() + 10 * 60 * 1000)),
      );
      walletRepo.findOne.mockResolvedValue(null);

      await expect(
        service.verifyEmailAndLink("a".repeat(64)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getAccountInfo", () => {
    it("returns the linked email for a wallet that has one", async () => {
      walletRepo.findOne.mockResolvedValue(
        buildWallet(
          buildUser({ email: "test@example.com", emailVerified: true }),
        ),
      );

      const result = await service.getAccountInfo(WALLET_ADDRESS);

      expect(result.walletAddress).toBe(WALLET_ADDRESS);
      expect(result.email).toBe("test@example.com");
      expect(result.emailVerified).toBe(true);
    });

    it("returns a null email when the wallet has none linked", async () => {
      walletRepo.findOne.mockResolvedValue(buildWallet(buildUser()));

      const result = await service.getAccountInfo(WALLET_ADDRESS);

      expect(result.email).toBeNull();
      expect(result.emailVerified).toBe(false);
    });

    it("returns a null email when the wallet is unknown", async () => {
      walletRepo.findOne.mockResolvedValue(null);

      const result = await service.getAccountInfo(WALLET_ADDRESS);

      expect(result.email).toBeNull();
      expect(result.emailVerified).toBe(false);
    });
  });

  describe("unlinkEmail", () => {
    it("clears the email and any pending verification", async () => {
      const user = buildUser({
        email: "test@example.com",
        emailVerified: true,
      });
      walletRepo.findOne.mockResolvedValue(buildWallet(user));

      const result = await service.unlinkEmail(WALLET_ADDRESS);

      expect(result.message).toContain("successfully unlinked");
      expect(user.email).toBeNull();
      expect(user.emailVerified).toBe(false);
      expect(verificationRepo.delete).toHaveBeenCalledWith({
        walletAddress: WALLET_ADDRESS.toLowerCase(),
      });
    });

    it("throws when no email is linked", async () => {
      walletRepo.findOne.mockResolvedValue(buildWallet(buildUser()));

      await expect(
        service.unlinkEmail(WALLET_ADDRESS),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws when the wallet is unknown", async () => {
      walletRepo.findOne.mockResolvedValue(null);

      await expect(
        service.unlinkEmail(WALLET_ADDRESS),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getUserByEmail", () => {
    it("looks the user up by a normalised, verified-only email", async () => {
      const user = buildUser({
        email: "test@example.com",
        emailVerified: true,
      });
      userRepo.findOne.mockResolvedValue(user);

      await expect(service.getUserByEmail("TEST@example.com")).resolves.toBe(
        user,
      );
      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { email: "test@example.com", emailVerified: true },
      });
    });
  });
});