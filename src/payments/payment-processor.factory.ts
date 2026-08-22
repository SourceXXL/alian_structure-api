import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IPaymentProcessor } from "./interfaces/payment-processor.interface";
import { PaymentProcessorRegistry } from "./registry/payment-processor.registry";

/**
 * Selects which {@link IPaymentProcessor} handles a request.
 *
 * Precedence (first match wins):
 *   1. Explicit selector — the `X-Payment-Processor` header (or `?processor=`).
 *   2. Env default — `PAYMENTS_DEFAULT_PROCESSOR` (mirrors EmailService's
 *      env-based provider selection).
 *   3. Sole enabled processor — if exactly one is enabled, use it.
 *   4. Otherwise → {@link BadRequestException} asking the caller to choose.
 *
 * Existence/enabled validation is delegated to the registry, so a disabled or
 * unknown selector surfaces the registry's Conflict/BadRequest error.
 */
@Injectable()
export class PaymentProcessorFactory {
  private readonly logger = new Logger(PaymentProcessorFactory.name);

  constructor(
    private readonly registry: PaymentProcessorRegistry,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Resolve a processor from an optional explicit selector (header/query).
   * @param selector value of `X-Payment-Processor` / `?processor=`, if any.
   */
  resolve(selector?: string): IPaymentProcessor {
    const explicit = this.normalize(selector);
    if (explicit) {
      return this.registry.get(explicit);
    }

    const envDefault = this.normalize(
      this.configService.get<string>("PAYMENTS_DEFAULT_PROCESSOR"),
    );
    if (envDefault) {
      return this.registry.get(envDefault);
    }

    const enabled = this.registry.listEnabled();
    if (enabled.length === 1) {
      return enabled[0];
    }

    throw new BadRequestException(
      enabled.length === 0
        ? "No payment processor is enabled."
        : "No payment processor selected. Provide the 'X-Payment-Processor' header " +
            `or set PAYMENTS_DEFAULT_PROCESSOR. Enabled: [${enabled
              .map((p) => p.name)
              .join(", ")}].`,
    );
  }

  /** Normalise a selector to a lowercase key, or undefined when blank. */
  private normalize(value?: string): string | undefined {
    const trimmed = value?.trim().toLowerCase();
    return trimmed ? trimmed : undefined;
  }
}
