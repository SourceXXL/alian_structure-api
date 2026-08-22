import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  IPaymentProcessor,
  PaymentStatus,
} from "../interfaces/payment-processor.interface";
import { PaymentProcessorRegistry } from "./payment-processor.registry";

/** Minimal fake processor for registry tests (no network). */
function fakeProcessor(name: string): IPaymentProcessor {
  return {
    name,
    displayName: name,
    capabilities: {
      supportsPartialRefund: false,
      requiresClientSideSigning: false,
      currencies: [],
    },
    initialize: jest.fn().mockResolvedValue(undefined),
    createPayment: jest
      .fn()
      .mockResolvedValue({ paymentId: "p", status: PaymentStatus.PENDING }),
    signTransaction: jest.fn(),
    submitTransaction: jest.fn(),
    getStatus: jest.fn(),
    refund: jest.fn(),
  };
}

describe("PaymentProcessorRegistry", () => {
  let registry: PaymentProcessorRegistry;

  beforeEach(() => {
    registry = new PaymentProcessorRegistry();
  });

  it("registers and resolves a processor by name", () => {
    const stellar = fakeProcessor("stellar");
    registry.register(stellar);

    expect(registry.has("stellar")).toBe(true);
    expect(registry.get("stellar")).toBe(stellar);
    expect(registry.names()).toEqual(["stellar"]);
  });

  it("overwrites a processor registered under the same name", () => {
    const first = fakeProcessor("stellar");
    const second = fakeProcessor("stellar");
    registry.register(first);
    registry.register(second);

    expect(registry.list()).toHaveLength(1);
    expect(registry.get("stellar")).toBe(second);
  });

  it("throws BadRequest for an unknown processor", () => {
    expect(() => registry.get("nope")).toThrow(BadRequestException);
  });

  it("throws Conflict when resolving a disabled processor", () => {
    registry.register(fakeProcessor("stellar"));
    registry.disable("stellar");

    expect(registry.isEnabled("stellar")).toBe(false);
    expect(() => registry.get("stellar")).toThrow(ConflictException);
  });

  it("re-enables a disabled processor", () => {
    registry.register(fakeProcessor("stellar"));
    registry.disable("stellar");
    registry.enable("stellar");

    expect(registry.isEnabled("stellar")).toBe(true);
    expect(registry.get("stellar")).toBeDefined();
  });

  it("lists only enabled processors via listEnabled()", () => {
    registry.register(fakeProcessor("stellar"));
    registry.register(fakeProcessor("grantfox"));
    registry.disable("grantfox");

    expect(registry.list()).toHaveLength(2);
    expect(registry.listEnabled().map((p) => p.name)).toEqual(["stellar"]);
  });

  it("throws BadRequest when enabling/disabling an unknown processor", () => {
    expect(() => registry.enable("ghost")).toThrow(BadRequestException);
    expect(() => registry.disable("ghost")).toThrow(BadRequestException);
  });

  it("reports a serialisable snapshot via info()", () => {
    registry.register(fakeProcessor("stellar"));
    registry.register(fakeProcessor("grantfox"));
    registry.disable("grantfox");

    expect(registry.info()).toEqual([
      expect.objectContaining({ name: "stellar", enabled: true }),
      expect.objectContaining({ name: "grantfox", enabled: false }),
    ]);
  });
});
