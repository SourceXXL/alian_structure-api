import { Injectable } from "@nestjs/common";
import { PaymentProcessorFactory } from "./payment-processor.factory";
import { PaymentProcessorRegistry } from "./registry/payment-processor.registry";
import {
  CreatedPayment,
  PaymentProcessorInfo,
  PaymentRequest,
  PaymentStatusResult,
  RefundRequest,
  SignedTransaction,
  SubmittedTransaction,
} from "./interfaces/payment-processor.interface";

/**
 * Thin orchestrator the controller delegates to. Every operation resolves the
 * target processor through the {@link PaymentProcessorFactory} (header/env/sole
 * -enabled precedence) and forwards to it, so the controller stays free of any
 * processor-selection logic.
 *
 * The flow is intentionally stateless — create/sign/submit payloads are passed
 * back through request bodies. Persisting payment records is a documented DB
 * seam (see README); the processor selector must therefore be supplied on each
 * call (header or `?processor=`), since there is no stored payment to look it
 * up from.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly factory: PaymentProcessorFactory,
    private readonly registry: PaymentProcessorRegistry,
  ) {}

  createPayment(
    request: PaymentRequest,
    selector?: string,
  ): Promise<CreatedPayment> {
    return this.factory.resolve(selector).createPayment(request);
  }

  signTransaction(
    created: CreatedPayment,
    selector?: string,
  ): Promise<SignedTransaction> {
    return this.factory.resolve(selector).signTransaction(created);
  }

  submitTransaction(
    signed: SignedTransaction,
    selector?: string,
  ): Promise<SubmittedTransaction> {
    return this.factory.resolve(selector).submitTransaction(signed);
  }

  /**
   * Convenience composition of sign + submit for server-side-signing processors
   * (e.g. Stellar): resolve the processor once, sign the created payment, then
   * submit the signed result. Backs the `/payments/stellar/submit` alias so a
   * create → submit flow needs no separate client sign step.
   */
  async signAndSubmit(
    created: CreatedPayment,
    selector?: string,
  ): Promise<SubmittedTransaction> {
    const processor = this.factory.resolve(selector);
    const signed = await processor.signTransaction(created);
    return processor.submitTransaction(signed);
  }

  getStatus(
    paymentId: string,
    selector?: string,
  ): Promise<PaymentStatusResult> {
    return this.factory.resolve(selector).getStatus(paymentId);
  }

  refund(request: RefundRequest, selector?: string) {
    return this.factory.resolve(selector).refund(request);
  }

  /** All registered processors and their enabled state, for the list endpoint. */
  listProcessors(): PaymentProcessorInfo[] {
    return this.registry.info();
  }

  enableProcessor(name: string): PaymentProcessorInfo[] {
    this.registry.enable(name);
    return this.registry.info();
  }

  disableProcessor(name: string): PaymentProcessorInfo[] {
    this.registry.disable(name);
    return this.registry.info();
  }
}
