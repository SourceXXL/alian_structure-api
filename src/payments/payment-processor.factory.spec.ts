import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  IPaymentProcessor,
  PaymentStatus,
} from "./interfaces/payment-processor.interface";
import { PaymentProcessorFactory } from "./payment-processor.factory";
import { PaymentProcessorRegistry } from "./registry/payment-processor.registry";

function fakeProcessor(name: string): IPaymentProcessor {
  return {
    name,
    displayName: name,
    capabilities: {
      supportsPartialRefund: false,
      requiresClientSideSigning: false,
      currencies: [],
    },
    initialize: jest.fn(),
    createPayment: jest
      .fn()
      .mockResolvedValue({ paymentId: "p", status: PaymentStatus.PENDING }),
    signTransaction: jest.fn(),
    submitTransaction: jest.fn(),
    getStatus: jest.fn(),
    refund: jest.fn(),
  };
}

describe("PaymentProcessorFactory", () => {
  let registry: PaymentProcessorRegistry;
  let env: Record<string, string | undefined>;
  let factory: PaymentProcessorFactory;

  beforeEach(() => {
    registry = new PaymentProcessorRegistry();
    registry.register(fakeProcessor("stellar"));
    registry.register(fakeProcessor("grantfox"));
    env = {};
    const config = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;
    factory = new PaymentProcessorFactory(registry, config);
  });

  it("resolves the explicit selector over the env default", () => {
    env.PAYMENTS_DEFAULT_PROCESSOR = "stellar";
    expect(factory.resolve("grantfox").name).toBe("grantfox");
  });

  it("normalises the selector (case/whitespace insensitive)", () => {
    expect(factory.resolve("  STELLAR ").name).toBe("stellar");
  });

  it("falls back to the env default when no selector is given", () => {
    env.PAYMENTS_DEFAULT_PROCESSOR = "grantfox";
    expect(factory.resolve().name).toBe("grantfox");
  });

  it("uses the sole enabled processor when there is no selector or env default", () => {
    registry.disable("grantfox");
    expect(factory.resolve().name).toBe("stellar");
  });

  it("throws when nothing selects a processor and several are enabled", () => {
    expect(() => factory.resolve()).toThrow(BadRequestException);
  });

  it("throws when the explicit selector is unknown", () => {
    expect(() => factory.resolve("paypal")).toThrow(BadRequestException);
  });

  it("propagates the registry's disabled-processor error for an explicit selector", () => {
    registry.disable("stellar");
    expect(() => factory.resolve("stellar")).toThrow(/disabled/i);
  });

  it("throws when no processor is enabled at all", () => {
    registry.disable("stellar");
    registry.disable("grantfox");
    expect(() => factory.resolve()).toThrow(/No payment processor is enabled/i);
  });
});
