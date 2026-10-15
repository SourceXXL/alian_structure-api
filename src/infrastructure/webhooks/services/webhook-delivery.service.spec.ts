import { HttpService } from "@nestjs/axios";
import { of, throwError } from "rxjs";
import { Repository } from "typeorm";
import { WebhookDeadLetter } from "src/infrastructure/webhooks/entities/webhook-dead-letter.entity";
import {
  WebhookDelivery,
  WebhookDeliveryStatus,
} from "src/infrastructure/webhooks/entities/webhook-delivery.entity";
import {
  WebhookEvent,
  WebhookEventStatus,
} from "src/infrastructure/webhooks/entities/webhook-event.entity";
import {
  WebhookSubscription,
  WebhookSubscriptionStatus,
} from "src/infrastructure/webhooks/entities/webhook-subscription.entity";
import { WebhookDeliveryService } from "./webhook-delivery.service";
import { WebhookHmacService } from "./webhook-hmac.service";
import {
  DnsLookupFn,
  WebhookUrlValidatorService,
} from "./webhook-url-validator.service";

describe("WebhookDeliveryService", () => {
  let service: WebhookDeliveryService;
  let deliveryRepo: jest.Mocked<
    Pick<
      Repository<WebhookDelivery>,
      "create" | "save" | "findOne" | "find" | "createQueryBuilder"
    >
  >;
  let deadLetterRepo: jest.Mocked<
    Pick<Repository<WebhookDeadLetter>, "create" | "save" | "findOne" | "find">
  >;
  let eventRepo: jest.Mocked<
    Pick<Repository<WebhookEvent>, "findOne" | "createQueryBuilder">
  >;
  let subscriptionRepo: jest.Mocked<
    Pick<Repository<WebhookSubscription>, "save" | "findOne" | "find">
  >;
  let httpService: jest.Mocked<Pick<HttpService, "post">>;
  let hmacService: WebhookHmacService;
  let dnsResolver: jest.MockedFunction<DnsLookupFn>;
  let urlValidator: WebhookUrlValidatorService;
  let eventQueryBuilder: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    execute: jest.Mock;
  };

  const makeSubscription = (
    overrides: Partial<WebhookSubscription> = {},
  ): WebhookSubscription =>
    ({
      id: "sub-1",
      userId: "user-1",
      url: "https://hooks.example.com/receive",
      signingKey: "whsec_test_key_123456",
      events: ["agent.created"],
      status: WebhookSubscriptionStatus.ACTIVE,
      maxRetries: 3,
      retryDelayMs: 1000,
      backoffMultiplier: 2,
      timeoutMs: 5000,
      rateLimitPerMinute: 10,
      ...overrides,
    }) as WebhookSubscription;

  const makeEvent = (overrides: Partial<WebhookEvent> = {}): WebhookEvent =>
    ({
      id: "evt-1",
      eventType: "agent.created",
      aggregateId: "ag-1",
      payload: { agentId: "ag-1" },
      status: WebhookEventStatus.DELIVERING,
      deliveryCount: 1,
      successCount: 0,
      failureCount: 0,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      ...overrides,
    }) as WebhookEvent;

  beforeEach(() => {
    eventQueryBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    };

    deliveryRepo = {
      create: jest.fn((data) => ({ id: "deliv-1", attempts: 0, ...data }) as any),
      save: jest.fn(async (entity) => entity as any),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      createQueryBuilder: jest.fn(),
    };

    deadLetterRepo = {
      create: jest.fn((data) => ({ id: "dlq-1", ...data }) as any),
      save: jest.fn(async (entity) => entity as any),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };

    eventRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(eventQueryBuilder as any),
    };

    subscriptionRepo = {
      save: jest.fn(async (sub) => sub as WebhookSubscription),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
    };

    httpService = {
      post: jest.fn(),
    };

    hmacService = new WebhookHmacService();
    dnsResolver = jest
      .fn<ReturnType<DnsLookupFn>, Parameters<DnsLookupFn>>()
      .mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    urlValidator = new WebhookUrlValidatorService();
    urlValidator.setLookupFn(dnsResolver);

    service = new WebhookDeliveryService(
      deliveryRepo as unknown as Repository<WebhookDelivery>,
      deadLetterRepo as unknown as Repository<WebhookDeadLetter>,
      eventRepo as unknown as Repository<WebhookEvent>,
      subscriptionRepo as unknown as Repository<WebhookSubscription>,
      httpService as unknown as HttpService,
      hmacService,
      urlValidator,
    );
  });

  describe("createDeliveries", () => {
    it("creates PENDING delivery records with maxAttempts from subscription.maxRetries", async () => {
      const event = makeEvent();
      const sub = makeSubscription({ maxRetries: 5 });

      const created = await service.createDeliveries(event, [sub]);

      expect(created).toHaveLength(1);
      expect(deliveryRepo.create).toHaveBeenCalledWith({
        subscriptionId: "sub-1",
        eventId: "evt-1",
        status: WebhookDeliveryStatus.PENDING,
        maxAttempts: 5,
      });
      expect(deliveryRepo.save).toHaveBeenCalledTimes(1);
    });
  });

  describe("processDelivery — 2xx success", () => {
    it("marks delivery SUCCESS, signs headers with HMAC-SHA256, disables redirects, and increments event successCount", async () => {
      const subscription = makeSubscription();
      const event = makeEvent();
      const delivery: WebhookDelivery = {
        id: "deliv-1",
        eventId: event.id,
        subscriptionId: subscription.id,
        status: WebhookDeliveryStatus.PENDING,
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      } as WebhookDelivery;

      deliveryRepo.findOne.mockResolvedValue(delivery);
      subscriptionRepo.findOne.mockResolvedValue(subscription);
      eventRepo.findOne.mockResolvedValue(event);

      httpService.post.mockReturnValue(
        of({
          status: 200,
          data: { ok: true },
          headers: { "content-type": "application/json" },
        } as any),
      );

      const result = await service.processDelivery("deliv-1");

      expect(result.status).toBe(WebhookDeliveryStatus.SUCCESS);
      expect(result.attempts).toBe(1);
      expect(result.statusCode).toBe(200);
      expect(result.deliveredAt).toBeInstanceOf(Date);
      expect(httpService.post).toHaveBeenCalledWith(
        "https://hooks.example.com/receive",
        expect.any(String),
        expect.objectContaining({
          maxRedirects: 0,
          headers: expect.objectContaining({
            "X-Webhook-Event-Id": "evt-1",
            "X-Webhook-Event-Type": "agent.created",
            "X-Webhook-Signature": expect.stringMatching(/^sha256=[a-f0-9]{64}$/),
          }),
        }),
      );
      expect(eventQueryBuilder.update).toHaveBeenCalledWith(WebhookEvent);
      expect(eventQueryBuilder.where).toHaveBeenCalledWith("id = :id", {
        id: "evt-1",
      });
    });
  });

  describe("processDelivery — 5xx retry and dead-letter escalation", () => {
    it("marks delivery FAILED and schedules exponential backoff nextRetryAt when attempts < maxAttempts", async () => {
      const subscription = makeSubscription({
        maxRetries: 3,
        retryDelayMs: 1000,
        backoffMultiplier: 2,
      });
      const event = makeEvent();
      const delivery: WebhookDelivery = {
        id: "deliv-retry",
        eventId: event.id,
        subscriptionId: subscription.id,
        status: WebhookDeliveryStatus.PENDING,
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
      } as WebhookDelivery;

      deliveryRepo.findOne.mockResolvedValue(delivery);
      subscriptionRepo.findOne.mockResolvedValue(subscription);
      eventRepo.findOne.mockResolvedValue(event);

      httpService.post.mockReturnValue(
        of({
          status: 503,
          data: "Service Unavailable",
          headers: {},
        } as any),
      );

      const before = Date.now();
      const result = await service.processDelivery("deliv-retry");

      expect(result.status).toBe(WebhookDeliveryStatus.FAILED);
      expect(result.attempts).toBe(1);
      expect(result.statusCode).toBe(503);
      expect(result.nextRetryAt).toBeInstanceOf(Date);
      expect(result.nextRetryAt.getTime()).toBeGreaterThanOrEqual(before + 900);
      expect((result.metadata as any).attempts).toHaveLength(1);
      expect(deadLetterRepo.save).not.toHaveBeenCalled();
    });

    it("moves delivery to DEAD_LETTERED and records a WebhookDeadLetter when attempts reach maxAttempts", async () => {
      const subscription = makeSubscription({ maxRetries: 3 });
      const event = makeEvent();
      const delivery: WebhookDelivery = {
        id: "deliv-dlq",
        eventId: event.id,
        subscriptionId: subscription.id,
        status: WebhookDeliveryStatus.FAILED,
        attempts: 2,
        maxAttempts: 3,
        createdAt: new Date(),
      } as WebhookDelivery;

      deliveryRepo.findOne.mockResolvedValue(delivery);
      subscriptionRepo.findOne.mockResolvedValue(subscription);
      eventRepo.findOne.mockResolvedValue(event);

      httpService.post.mockReturnValue(
        throwError(() => new Error("connect ECONNREFUSED")),
      );

      const result = await service.processDelivery("deliv-dlq");

      expect(result.status).toBe(WebhookDeliveryStatus.DEAD_LETTERED);
      expect(result.attempts).toBe(3);
      expect(deadLetterRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deliveryId: delivery.id,
          subscriptionId: subscription.id,
          eventId: event.id,
          url: subscription.url,
          totalAttempts: 3,
          userId: subscription.userId,
        }),
      );
      expect(deadLetterRepo.save).toHaveBeenCalledTimes(1);
      expect(eventQueryBuilder.update).toHaveBeenCalledWith(WebhookEvent);
    });
  });

  describe("SSRF, redirect, rate-limit, and response truncation safeguards", () => {
    it("blocks delivery-time DNS rebinding to a private/metadata IP without making an HTTP request", async () => {
      const subscription = makeSubscription({
        url: "https://rebind.example.com/hook",
      });
      const event = makeEvent();
      const delivery: WebhookDelivery = {
        id: "deliv-rebind",
        eventId: event.id,
        subscriptionId: subscription.id,
        status: WebhookDeliveryStatus.PENDING,
        attempts: 0,
        maxAttempts: 2,
        createdAt: new Date(),
      } as WebhookDelivery;

      deliveryRepo.findOne.mockResolvedValue(delivery);
      subscriptionRepo.findOne.mockResolvedValue(subscription);
      eventRepo.findOne.mockResolvedValue(event);

      dnsResolver.mockResolvedValueOnce([
        { address: "169.254.169.254", family: 4 },
      ]);

      const result = await service.processDelivery("deliv-rebind");

      expect(httpService.post).not.toHaveBeenCalled();
      expect(result.status).toBe(WebhookDeliveryStatus.FAILED);
      expect(result.errorMessage).toContain("SSRF validation failed");
    });

    it("rejects 3xx redirect responses instead of following them to internal services", async () => {
      const subscription = makeSubscription();
      const event = makeEvent();
      const delivery: WebhookDelivery = {
        id: "deliv-redirect",
        eventId: event.id,
        subscriptionId: subscription.id,
        status: WebhookDeliveryStatus.PENDING,
        attempts: 0,
        maxAttempts: 2,
        createdAt: new Date(),
      } as WebhookDelivery;

      deliveryRepo.findOne.mockResolvedValue(delivery);
      subscriptionRepo.findOne.mockResolvedValue(subscription);
      eventRepo.findOne.mockResolvedValue(event);

      httpService.post.mockReturnValue(
        of({
          status: 302,
          data: "Found",
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        } as any),
      );

      const result = await service.processDelivery("deliv-redirect");

      expect(result.status).toBe(WebhookDeliveryStatus.FAILED);
      expect(result.statusCode).toBe(302);
      expect(result.errorMessage).toContain(
        "Redirect responses (HTTP 302) are not allowed",
      );
    });

    it("enforces per-subscription outbound rateLimitPerMinute", async () => {
      const subscription = makeSubscription({ rateLimitPerMinute: 1 });
      const event = makeEvent();
      const makeDeliv = (id: string): WebhookDelivery =>
        ({
          id,
          eventId: event.id,
          subscriptionId: subscription.id,
          status: WebhookDeliveryStatus.PENDING,
          attempts: 0,
          maxAttempts: 2,
          createdAt: new Date(),
        }) as WebhookDelivery;

      subscriptionRepo.findOne.mockResolvedValue(subscription);
      eventRepo.findOne.mockResolvedValue(event);
      httpService.post.mockReturnValue(
        of({ status: 200, data: "ok", headers: {} } as any),
      );

      const first = makeDeliv("deliv-rate-1");
      deliveryRepo.findOne.mockResolvedValueOnce(first);
      const res1 = await service.processDelivery("deliv-rate-1");
      expect(res1.status).toBe(WebhookDeliveryStatus.SUCCESS);

      const second = makeDeliv("deliv-rate-2");
      deliveryRepo.findOne.mockResolvedValueOnce(second);
      const res2 = await service.processDelivery("deliv-rate-2");

      expect(res2.status).toBe(WebhookDeliveryStatus.FAILED);
      expect(res2.errorMessage).toContain("Outbound rate limit exceeded");
      expect(httpService.post).toHaveBeenCalledTimes(1);
    });

    it("truncates oversized response bodies before storing on delivery records", async () => {
      const subscription = makeSubscription();
      const event = makeEvent();
      const delivery: WebhookDelivery = {
        id: "deliv-large-body",
        eventId: event.id,
        subscriptionId: subscription.id,
        status: WebhookDeliveryStatus.PENDING,
        attempts: 0,
        maxAttempts: 2,
        createdAt: new Date(),
      } as WebhookDelivery;

      deliveryRepo.findOne.mockResolvedValue(delivery);
      subscriptionRepo.findOne.mockResolvedValue(subscription);
      eventRepo.findOne.mockResolvedValue(event);

      const hugeBody = "X".repeat(5000);
      httpService.post.mockReturnValue(
        of({ status: 200, data: hugeBody, headers: {} } as any),
      );

      const result = await service.processDelivery("deliv-large-body");

      expect(result.responseBody.length).toBeLessThan(550);
      expect(result.responseBody).toContain("...[truncated]");
    });
  });

  describe("retryDeadLetter", () => {
    it("creates a fresh PENDING delivery and marks the dead letter retried for its owner", async () => {
      const subscription = makeSubscription({ userId: "user-1", maxRetries: 4 });
      const deadLetter: WebhookDeadLetter = {
        id: "dlq-1",
        subscriptionId: subscription.id,
        eventId: "evt-1",
        deliveryId: "deliv-old",
        userId: "user-1",
        retried: false,
      } as WebhookDeadLetter;

      deadLetterRepo.findOne.mockResolvedValue(deadLetter);
      subscriptionRepo.findOne.mockResolvedValue(subscription);

      const requeued = await service.retryDeadLetter("dlq-1", "user-1");

      expect(requeued).not.toBeNull();
      expect(requeued.status).toBe(WebhookDeliveryStatus.PENDING);
      expect(requeued.maxAttempts).toBe(4);
      expect(deadLetter.retried).toBe(true);
      expect(deadLetterRepo.save).toHaveBeenCalledWith(deadLetter);
    });

    it("returns null when a user attempts to retry another user's dead letter", async () => {
      deadLetterRepo.findOne.mockResolvedValue(null);

      const res = await service.retryDeadLetter("dlq-other", "user-attacker");

      expect(res).toBeNull();
      expect(deliveryRepo.save).not.toHaveBeenCalled();
    });
  });
});
