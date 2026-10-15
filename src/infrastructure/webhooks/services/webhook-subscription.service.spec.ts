import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Repository } from "typeorm";
import {
  WebhookSubscription,
  WebhookSubscriptionStatus,
} from "src/infrastructure/webhooks/entities/webhook-subscription.entity";
import { WebhookSubscriptionService } from "./webhook-subscription.service";
import { WebhookUrlValidatorService } from "./webhook-url-validator.service";

describe("WebhookSubscriptionService", () => {
  let service: WebhookSubscriptionService;
  let subscriptionRepo: jest.Mocked<
    Pick<
      Repository<WebhookSubscription>,
      "create" | "save" | "find" | "findOne" | "createQueryBuilder"
    >
  >;
  let urlValidator: WebhookUrlValidatorService;

  beforeEach(() => {
    subscriptionRepo = {
      create: jest.fn((entity) => ({
        id: "sub-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        ...entity,
      })) as any,
      save: jest.fn(async (entity) => entity as WebhookSubscription),
      find: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    urlValidator = new WebhookUrlValidatorService();
    urlValidator.setLookupFn(async () => [
      { address: "93.184.216.34", family: 4 },
    ]);

    service = new WebhookSubscriptionService(
      subscriptionRepo as unknown as Repository<WebhookSubscription>,
      urlValidator,
    );
  });

  describe("create", () => {
    it("validates the URL, generates a whsec_ signing key, and applies default retry/rate settings", async () => {
      const result = await service.create("user-1", {
        url: "https://hooks.example.com/events",
        events: ["agent.created", "agent.updated"],
        description: "Production webhook",
      });

      expect(result.userId).toBe("user-1");
      expect(result.url).toBe("https://hooks.example.com/events");
      expect(result.signingKey).toMatch(/^whsec_[a-f0-9]{64}$/);
      expect(result.maxRetries).toBe(5);
      expect(result.retryDelayMs).toBe(1000);
      expect(result.backoffMultiplier).toBe(2);
      expect(result.timeoutMs).toBe(30000);
      expect(result.rateLimitPerMinute).toBe(10);
      expect(result.status).toBe(WebhookSubscriptionStatus.ACTIVE);
      expect(subscriptionRepo.save).toHaveBeenCalledTimes(1);
    });

    it("rejects SSRF / loopback / metadata URLs before persisting", async () => {
      await expect(
        service.create("user-1", {
          url: "http://169.254.169.254/latest/meta-data/",
          events: ["*"],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(subscriptionRepo.save).not.toHaveBeenCalled();
    });
  });

  describe("findAll & findOne", () => {
    it("scopes findAll to the requesting userId ordered by createdAt DESC", async () => {
      subscriptionRepo.find.mockResolvedValue([]);

      await service.findAll("user-42");

      expect(subscriptionRepo.find).toHaveBeenCalledWith({
        where: { userId: "user-42" },
        order: { createdAt: "DESC" },
      });
    });

    it("returns the subscription when id and userId match", async () => {
      const existing = {
        id: "sub-1",
        userId: "user-1",
      } as WebhookSubscription;
      subscriptionRepo.findOne.mockResolvedValue(existing);

      const found = await service.findOne("sub-1", "user-1");
      expect(found).toBe(existing);
      expect(subscriptionRepo.findOne).toHaveBeenCalledWith({
        where: { id: "sub-1", userId: "user-1" },
      });
    });

    it("throws NotFoundException when subscription does not exist or belongs to another user", async () => {
      subscriptionRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne("sub-1", "other-user")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("findActiveForEvent", () => {
    it("matches active subscriptions subscribed to the exact event type or wildcard '*'", async () => {
      const wildcardSub = {
        id: "sub-wildcard",
        status: WebhookSubscriptionStatus.ACTIVE,
        events: ["*"],
      } as WebhookSubscription;
      const exactSub = {
        id: "sub-exact",
        status: WebhookSubscriptionStatus.ACTIVE,
        events: ["agent.created", "agent.deleted"],
      } as WebhookSubscription;
      const unrelatedSub = {
        id: "sub-unrelated",
        status: WebhookSubscriptionStatus.ACTIVE,
        events: ["payment.completed"],
      } as WebhookSubscription;

      subscriptionRepo.find.mockResolvedValue([
        wildcardSub,
        exactSub,
        unrelatedSub,
      ]);

      const matches = await service.findActiveForEvent("agent.created");

      expect(subscriptionRepo.find).toHaveBeenCalledWith({
        where: { status: WebhookSubscriptionStatus.ACTIVE },
      });
      expect(matches).toEqual([wildcardSub, exactSub]);
    });
  });

  describe("update", () => {
    it("re-validates a newly supplied URL and saves updates", async () => {
      const existing = {
        id: "sub-1",
        userId: "user-1",
        url: "https://hooks.example.com/old",
        description: "Old",
      } as WebhookSubscription;
      subscriptionRepo.findOne.mockResolvedValue(existing);

      const updated = await service.update("sub-1", "user-1", {
        url: "https://hooks.example.com/new",
        description: "New",
      });

      expect(updated.url).toBe("https://hooks.example.com/new");
      expect(updated.description).toBe("New");
    });

    it("rejects updating a subscription URL to a private/loopback target", async () => {
      const existing = {
        id: "sub-1",
        userId: "user-1",
        url: "https://hooks.example.com/old",
      } as WebhookSubscription;
      subscriptionRepo.findOne.mockResolvedValue(existing);

      await expect(
        service.update("sub-1", "user-1", {
          url: "https://127.0.0.1/internal",
        }),
      ).rejects.toThrow(BadRequestException);

      expect(subscriptionRepo.save).not.toHaveBeenCalled();
    });
  });

  describe("remove, rotateKey, and toggleStatus", () => {
    it("soft-disables a subscription on remove()", async () => {
      const existing = {
        id: "sub-1",
        userId: "user-1",
        status: WebhookSubscriptionStatus.ACTIVE,
      } as WebhookSubscription;
      subscriptionRepo.findOne.mockResolvedValue(existing);

      await service.remove("sub-1", "user-1");

      expect(existing.status).toBe(WebhookSubscriptionStatus.DISABLED);
      expect(subscriptionRepo.save).toHaveBeenCalledWith(existing);
    });

    it("generates a distinct signing key on rotateKey()", async () => {
      const existing = {
        id: "sub-1",
        userId: "user-1",
        signingKey: "whsec_old_key",
      } as WebhookSubscription;
      subscriptionRepo.findOne.mockResolvedValue(existing);

      const rotated = await service.rotateKey("sub-1", "user-1");

      expect(rotated.newSigningKey).toMatch(/^whsec_[a-f0-9]{64}$/);
      expect(rotated.newSigningKey).not.toBe("whsec_old_key");
      expect(existing.signingKey).toBe(rotated.newSigningKey);
    });

    it("updates subscription status on toggleStatus()", async () => {
      const existing = {
        id: "sub-1",
        userId: "user-1",
        status: WebhookSubscriptionStatus.ACTIVE,
      } as WebhookSubscription;
      subscriptionRepo.findOne.mockResolvedValue(existing);

      const paused = await service.toggleStatus(
        "sub-1",
        "user-1",
        WebhookSubscriptionStatus.PAUSED,
      );

      expect(paused.status).toBe(WebhookSubscriptionStatus.PAUSED);
    });
  });
});
