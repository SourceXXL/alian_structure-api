import { Job } from "bull";
import {
  WebhookDelivery,
  WebhookDeliveryStatus,
} from "src/infrastructure/webhooks/entities/webhook-delivery.entity";
import { WebhookDeliveryService } from "./webhook-delivery.service";
import {
  WebhookDeliveryJobData,
  WebhookProcessor,
} from "./webhook-processor.service";

describe("WebhookProcessor", () => {
  let processor: WebhookProcessor;
  let deliveryService: jest.Mocked<Pick<WebhookDeliveryService, "processDelivery">>;

  beforeEach(() => {
    deliveryService = {
      processDelivery: jest.fn(),
    };
    processor = new WebhookProcessor(
      deliveryService as unknown as WebhookDeliveryService,
    );
  });

  it("delegates delivery processing to WebhookDeliveryService and returns summary", async () => {
    const mockDelivery: Partial<WebhookDelivery> = {
      id: "deliv-1",
      status: WebhookDeliveryStatus.SUCCESS,
      attempts: 1,
      statusCode: 200,
      durationMs: 42,
    };
    deliveryService.processDelivery.mockResolvedValue(
      mockDelivery as WebhookDelivery,
    );

    const job = {
      id: "job-101",
      data: { deliveryId: "deliv-1", eventId: "evt-1" },
    } as unknown as Job<WebhookDeliveryJobData>;

    const result = await processor.handleDelivery(job);

    expect(deliveryService.processDelivery).toHaveBeenCalledWith("deliv-1");
    expect(result).toEqual({
      status: WebhookDeliveryStatus.SUCCESS,
      deliveryId: "deliv-1",
      attempts: 1,
      statusCode: 200,
      durationMs: 42,
    });
  });

  it("rethrows errors from WebhookDeliveryService so Bull can record job failure", async () => {
    const failure = new Error("Database connection lost");
    deliveryService.processDelivery.mockRejectedValue(failure);

    const job = {
      id: "job-102",
      data: { deliveryId: "deliv-2", eventId: "evt-2" },
    } as unknown as Job<WebhookDeliveryJobData>;

    await expect(processor.handleDelivery(job)).rejects.toThrow(
      "Database connection lost",
    );
  });
});
