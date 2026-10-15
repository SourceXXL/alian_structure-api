import { Queue } from "bull";
import { Repository } from "typeorm";
import { WebhookDelivery } from "src/infrastructure/webhooks/entities/webhook-delivery.entity";
import {
  WebhookEvent,
  WebhookEventStatus,
} from "src/infrastructure/webhooks/entities/webhook-event.entity";
import { WebhookSubscription } from "src/infrastructure/webhooks/entities/webhook-subscription.entity";
import { WebhookDeliveryService } from "./webhook-delivery.service";
import { WebhookEventService } from "./webhook-event.service";
import { WebhookSubscriptionService } from "./webhook-subscription.service";

describe("WebhookEventService", () => {
  let service: WebhookEventService;
  let eventRepo: jest.Mocked<
    Pick<Repository<WebhookEvent>, "create" | "save" | "findOne" | "find">
  >;
  let subscriptionService: jest.Mocked<
    Pick<WebhookSubscriptionService, "findActiveForEvent">
  >;
  let deliveryService: jest.Mocked<
    Pick<WebhookDeliveryService, "createDeliveries">
  >;
  let deliveryQueue: jest.Mocked<Pick<Queue, "add">>;

  beforeEach(() => {
    eventRepo = {
      create: jest.fn((data) => ({
        id: "evt-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        deliveryCount: 0,
        ...data,
      })) as any,
      save: jest.fn(async (event) => event as WebhookEvent),
      findOne: jest.fn(),
      find: jest.fn(),
    };

    subscriptionService = {
      findActiveForEvent: jest.fn(),
    };

    deliveryService = {
      createDeliveries: jest.fn(),
    };

    deliveryQueue = {
      add: jest.fn().mockResolvedValue({ id: "job-1" } as any),
    };

    service = new WebhookEventService(
      eventRepo as unknown as Repository<WebhookEvent>,
      subscriptionService as unknown as WebhookSubscriptionService,
      deliveryService as unknown as WebhookDeliveryService,
      deliveryQueue as unknown as Queue,
    );
  });

  describe("publishEvent", () => {
    it("marks the event DELIVERED with deliveryCount=0 when no active subscribers match", async () => {
      subscriptionService.findActiveForEvent.mockResolvedValue([]);

      const event = await service.publishEvent({
        eventType: "agent.created",
        payload: { agentId: "ag-1" },
      });

      expect(event.status).toBe(WebhookEventStatus.DELIVERED);
      expect(event.deliveryCount).toBe(0);
      expect(deliveryService.createDeliveries).not.toHaveBeenCalled();
      expect(deliveryQueue.add).not.toHaveBeenCalled();
    });

    it("creates deliveries and enqueues a Bull job per matching subscriber", async () => {
      const subscribers = [
        { id: "sub-1" } as WebhookSubscription,
        { id: "sub-2" } as WebhookSubscription,
      ];
      const deliveries = [
        { id: "deliv-1", subscriptionId: "sub-1" } as WebhookDelivery,
        { id: "deliv-2", subscriptionId: "sub-2" } as WebhookDelivery,
      ];

      subscriptionService.findActiveForEvent.mockResolvedValue(subscribers);
      deliveryService.createDeliveries.mockResolvedValue(deliveries);

      const event = await service.publishEvent({
        eventType: "agent.updated",
        payload: { agentId: "ag-9" },
        aggregateId: "ag-9",
        metadata: { source: "api" },
      });

      expect(deliveryService.createDeliveries).toHaveBeenCalledWith(
        expect.objectContaining({ id: "evt-1", eventType: "agent.updated" }),
        subscribers,
      );
      expect(deliveryQueue.add).toHaveBeenCalledTimes(2);
      expect(deliveryQueue.add).toHaveBeenNthCalledWith(
        1,
        "deliver",
        { deliveryId: "deliv-1", eventId: "evt-1" },
        { attempts: 1, removeOnComplete: 100, removeOnFail: 200 },
      );
      expect(deliveryQueue.add).toHaveBeenNthCalledWith(
        2,
        "deliver",
        { deliveryId: "deliv-2", eventId: "evt-1" },
        { attempts: 1, removeOnComplete: 100, removeOnFail: 200 },
      );
      expect(event.status).toBe(WebhookEventStatus.DELIVERING);
      expect(event.deliveryCount).toBe(2);
    });
  });

  describe("getEvent & listEvents", () => {
    it("retrieves an event by ID", async () => {
      const stored = { id: "evt-1" } as WebhookEvent;
      eventRepo.findOne.mockResolvedValue(stored);

      await expect(service.getEvent("evt-1")).resolves.toBe(stored);
      expect(eventRepo.findOne).toHaveBeenCalledWith({
        where: { id: "evt-1" },
      });
    });

    it("lists events with optional eventType filter, limit, and offset", async () => {
      eventRepo.find.mockResolvedValue([]);

      await service.listEvents("agent.created", 25, 10);

      expect(eventRepo.find).toHaveBeenCalledWith({
        where: { eventType: "agent.created" },
        order: { createdAt: "DESC" },
        take: 25,
        skip: 10,
      });
    });
  });

  describe("replayEvent", () => {
    it("returns null if the original event does not exist", async () => {
      eventRepo.findOne.mockResolvedValue(null);

      await expect(service.replayEvent("missing-id")).resolves.toBeNull();
    });

    it("re-publishes the original event payload with replayedFrom metadata", async () => {
      const original = {
        id: "evt-orig",
        eventType: "agent.created",
        payload: { agentId: "ag-1" },
        aggregateId: "ag-1",
        metadata: { env: "staging" },
      } as unknown as WebhookEvent;
      eventRepo.findOne.mockResolvedValue(original);
      subscriptionService.findActiveForEvent.mockResolvedValue([]);

      const replayed = await service.replayEvent("evt-orig");

      expect(replayed).not.toBeNull();
      expect(eventRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: "agent.created",
          payload: { agentId: "ag-1" },
          aggregateId: "ag-1",
          metadata: { env: "staging", replayedFrom: "evt-orig" },
        }),
      );
    });
  });
});
