import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
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
 * `EmailLinkingService` resolves everything through the Wallet repository
 * (`walletRepository.findOne({ where: { address }, relations: ["user"] })`),
 * not directly through the User repository, so the Wallet repo is the primary
 * seam for these tests.
 */
describe("EmailLinkingService", () => {
  let service: EmailLinkingService;
  let userRepository: Repository<User>;
  let emailVerificationRepository: Repository<EmailVerification>;
  let walletRepository: Repository<Wallet>;
  let emailService: EmailService;

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

  const mockEmailService = {
    sendVerificationEmail: jest.fn().mockResolvedValue({
      messageId: "test-message-id",
      previewUrl: "https://ethereal.email/message/test",
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailLinkingService,
        {
          provide: getRepositoryToken(User),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(async (user) => user),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(EmailVerification),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn((v) => v),
            save: jest.fn(async (v) => v),
            delete: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Wallet),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn((v) => v),
            save: jest.fn(async (v) => v),
            delete: jest.fn(),
          },
        },
        {
          provide: EmailService,
          useValue: mockEmailService,
        },
      ],
    }).compile();

    service = module.get<EmailLinkingService>(EmailLinkingService);
    userRepository = module.get<Repository<User>>(getRepositoryToken(User));
    emailVerificationRepository = module.get<Repository<EmailVerification>>(
      getRepositoryToken(EmailVerification),
    );
    walletRepository = module.get<Repository<Wallet>>(getRepositoryToken(Wallet));
    emailService = module.get<EmailService>(EmailService);

    // Sensible defaults; individual tests override what they care about.
    jest
      .spyOn(walletRepository, "findOne")
      .mockResolvedValue(buildWallet(buildUser()));
    jest.spyOn(userRepository, "findOne").mockResolvedValue(null);
    jest
      .spyOn(emailVerificationRepository, "delete")
      .mockResolvedValue(undefined as never);
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

      const createArgs =
        emailVerificationRepository.create.mock.calls[0][0] as EmailVerification;

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
      jest.spyOn(walletRepository, "findOne").mockResolvedValue(null);

      await expect(
        service.initiateEmailLinking(WALLET_ADDRESS, "test@example.com"),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects an email already linked to a different account", async () => {
      jest
        .spyOn(userRepository, "findOne")
        .mockResolvedValue(buildUser({ id: "someone-else" }));

      await expect(
        service.initiateEmailLinking(WALLET_ADDRESS, "test@example.com"),
      ).rejects.toThrow(ConflictException);
    });

    it("rejects an email that is already verified for this wallet", async () => {
      jest
        .spyOn(walletRepository, "findOne")
        .mockResolvedValue(
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
      jest
        .spyOn(emailVerificationRepository, "findOne")
        .mockResolvedValue(
          buildVerification(new Date(Date.now() + 10 * 60 * 1000)),
        );
      jest.spyOn(walletRepository, "findOne").mockResolvedValue(
        buildWallet(user),
      );

      const result = await service.verifyEmailAndLink("a".repeat(64));

      expect(result.message).toContain("successfully verified");
      expect(result.email).toBe("test@example.com");
      expect(result.walletAddress).toBe(WALLET_ADDRESS);
      expect(user.email).toBe("test@example.com");
      expect(user.emailVerified).toBe(true);
      expect(userRepository.save).toHaveBeenCalled();
    });

    it("rejects an unknown token", async () => {
      jest
        .spyOn(emailVerificationRepository, "findOne")
        .mockResolvedValue(null);

      await expect(
        service.verifyEmailAndLink("invalid-token"),
      ).rejects.toThrow(NotFoundException);
    });

    it("rejects an expired token and deletes the record", async () => {
      jest
        .spyOn(emailVerificationRepository, "findOne")
        .mockResolvedValue(buildVerification(new Date(Date.now() - 1000)));

      await expect(
        service.verifyEmailAndLink("a".repeat(64)),
      ).rejects.toThrow(UnauthorizedException);
      expect(emailVerificationRepository.delete).toHaveBeenCalledWith({
        token: "a".repeat(64),
      });
    });

    it("rejects a verification whose wallet no longer exists", async () => {
      jest
        .spyOn(emailVerificationRepository, "findOne")
        .mockResolvedValue(
          buildVerification(new Date(Date.now() + 10 * 60 * 1000)),
        );
      jest.spyOn(walletRepository, "findOne").mockResolvedValue(null);

      await expect(
        service.verifyEmailAndLink("a".repeat(64)),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getAccountInfo", () => {
    it("returns the linked email for a wallet that has one", async () => {
      jest.spyOn(walletRepository, "findOne").mockResolvedValue(
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
      jest.spyOn(walletRepository, "findOne").mockResolvedValue(
        buildWallet(buildUser()),
      );

      const result = await service.getAccountInfo(WALLET_ADDRESS);

      expect(result.email).toBeNull();
      expect(result.emailVerified).toBe(false);
    });

    it("returns a null email when the wallet is unknown", async () => {
      jest.spyOn(walletRepository, "findOne").mockResolvedValue(null);

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
      jest.spyOn(walletRepository, "findOne").mockResolvedValue(
        buildWallet(user),
      );

      const result = await service.unlinkEmail(WALLET_ADDRESS);

      expect(result.message).toContain("successfully unlinked");
      expect(user.email).toBeNull();
      expect(user.emailVerified).toBe(false);
      expect(emailVerificationRepository.delete).toHaveBeenCalledWith({
        walletAddress: WALLET_ADDRESS.toLowerCase(),
      });
    });

    it("throws when no email is linked", async () => {
      jest
        .spyOn(walletRepository, "findOne")
        .mockResolvedValue(buildWallet(buildUser()));

      await expect(
        service.unlinkEmail(WALLET_ADDRESS),
      ).rejects.toThrow(NotFoundException);
    });

    it("throws when the wallet is unknown", async () => {
      jest.spyOn(walletRepository, "findOne").mockResolvedValue(null);

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
      jest.spyOn(userRepository, "findOne").mockResolvedValue(user);

      await expect(service.getUserByEmail("TEST@example.com")).resolves.toBe(
        user,
      );
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: "test@example.com", emailVerified: true },
      });
    });
  });
});