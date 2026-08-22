import { SetMetadata } from "@nestjs/common";

/**
 * Metadata key stamped onto payment-processor adapter classes. The
 * PaymentsModule reads it during `onModuleInit` (via `Reflector` +
 * `DiscoveryService`) to auto-register every tagged provider.
 */
export const PAYMENT_PROCESSOR_METADATA = "payments:is-processor";

/**
 * Marks a class as a payment-processor plugin so it is auto-registered in the
 * {@link PaymentProcessorRegistry} on startup.
 *
 * This dedicated marker is what keeps discovery from colliding with the DeFi
 * module's adapter discovery: DeFi matches classes whose name ends in "Adapter"
 * and that duck-type `getPosition`/`supportedChains`; payment processors are
 * matched only by this metadata key.
 *
 * @example
 * @Injectable()
 * @RegisterPaymentProcessor()
 * export class StellarAdapter implements IPaymentProcessor { … }
 */
export const RegisterPaymentProcessor = (): ClassDecorator =>
  SetMetadata(PAYMENT_PROCESSOR_METADATA, true);
