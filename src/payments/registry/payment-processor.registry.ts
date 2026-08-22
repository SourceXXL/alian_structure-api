import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from "@nestjs/common";
import {
  IPaymentProcessor,
  PaymentProcessorInfo,
} from "../interfaces/payment-processor.interface";

/**
 * Runtime registry of payment-processor plugins.
 *
 * Adapters register themselves on module init (see PaymentsModule discovery).
 * Operators can enable/disable a processor at runtime without redeploying.
 *
 * ── DB-persistence seam ──────────────────────────────────────────────────
 * Enable/disable state lives in the in-memory {@link disabled} set. To persist
 * it (so a toggle survives restarts and is shared across instances), replace
 * the two `disabled.*` call sites in {@link isEnabled}/{@link setEnabled} with
 * reads/writes against a small `payment_processor_state` table/repository —
 * the public method surface below does not change. Registration itself stays
 * in-memory: it is derived from the deployed code, not operator state.
 */
@Injectable()
export class PaymentProcessorRegistry {
  private readonly logger = new Logger(PaymentProcessorRegistry.name);
  private readonly processors = new Map<string, IPaymentProcessor>();
  /** Names explicitly disabled by an operator. */
  private readonly disabled = new Set<string>();

  /** Register (or overwrite) a processor by its stable `name`. */
  register(processor: IPaymentProcessor): void {
    if (this.processors.has(processor.name)) {
      this.logger.warn(
        `Payment processor "${processor.name}" already registered — overwriting.`,
      );
    }
    this.processors.set(processor.name, processor);
    this.logger.log(`Registered payment processor: ${processor.name}`);
  }

  /** True if a processor with this name is registered (enabled or not). */
  has(name: string): boolean {
    return this.processors.has(name);
  }

  /** True if the processor is registered and not disabled. */
  isEnabled(name: string): boolean {
    return this.processors.has(name) && !this.disabled.has(name);
  }

  /**
   * Resolve an enabled processor by name.
   * @throws BadRequestException if no processor is registered under `name`.
   * @throws ConflictException if the processor exists but is disabled.
   */
  get(name: string): IPaymentProcessor {
    const processor = this.processors.get(name);
    if (!processor) {
      throw new BadRequestException(
        `Unknown payment processor: "${name}". Available: [${this.names().join(", ")}]`,
      );
    }
    if (this.disabled.has(name)) {
      throw new ConflictException(
        `Payment processor "${name}" is currently disabled.`,
      );
    }
    return processor;
  }

  /** All registered processors, regardless of enabled state. */
  list(): IPaymentProcessor[] {
    return Array.from(this.processors.values());
  }

  /** Only processors that are currently enabled. */
  listEnabled(): IPaymentProcessor[] {
    return this.list().filter((p) => !this.disabled.has(p.name));
  }

  /** All registered processor names. */
  names(): string[] {
    return Array.from(this.processors.keys());
  }

  /** Enable a previously disabled processor. */
  enable(name: string): void {
    this.assertRegistered(name);
    this.setEnabled(name, true);
  }

  /** Disable a processor so the factory refuses to route to it. */
  disable(name: string): void {
    this.assertRegistered(name);
    this.setEnabled(name, false);
  }

  /** Serialisable snapshot for list endpoints. */
  info(): PaymentProcessorInfo[] {
    return this.list().map((p) => ({
      name: p.name,
      displayName: p.displayName,
      enabled: !this.disabled.has(p.name),
      capabilities: p.capabilities,
    }));
  }

  private assertRegistered(name: string): void {
    if (!this.processors.has(name)) {
      throw new BadRequestException(`Unknown payment processor: "${name}".`);
    }
  }

  /** Single mutation point for enabled state — the DB seam lives here. */
  private setEnabled(name: string, enabled: boolean): void {
    if (enabled) {
      this.disabled.delete(name);
    } else {
      this.disabled.add(name);
    }
    this.logger.log(
      `Payment processor "${name}" ${enabled ? "enabled" : "disabled"}.`,
    );
  }
}
