import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { AxiosError, AxiosRequestConfig } from "axios";
import { firstValueFrom } from "rxjs";
import { RegisterPaymentProcessor } from "../../decorators/register-payment-processor.decorator";
import {
  CreatedPayment,
  IPaymentProcessor,
  PaymentCapabilities,
  PaymentRequest,
  PaymentStatus,
  PaymentStatusResult,
  RefundRequest,
  RefundResult,
  SignedTransaction,
  SubmittedTransaction,
} from "../../interfaces/payment-processor.interface";

/** Config accepted by {@link GrantfoxAdapter.initialize}. */
export interface GrantfoxConfig {
  apiUrl: string;
  apiKey: string;
}

/**
 * Real Grantfox payment processor: a thin HTTP client over a Grantfox-style
 * REST gateway (`@nestjs/axios`). The base URL and API key are env-driven
 * (`GRANTFOX_API_URL`, `GRANTFOX_API_KEY`).
 *
 * Grantfox is a hosted gateway, so signing/submission happen server-side there:
 * `createPayment` already returns a `SUBMITTED`/`PROCESSING` payment, and
 * `signTransaction`/`submitTransaction` are no-ops that just echo state through
 * (see `requiresClientSideSigning: false`). This keeps the create→sign→submit
 * contract uniform across processors.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  The request/response *shape* is isolated in {@link mapCreateRequest} and
 *  {@link mapPaymentResponse}. If your Grantfox endpoint differs, THOSE TWO
 *  METHODS are the only things to change.
 * ─────────────────────────────────────────────────────────────────────────
 */
@Injectable()
@RegisterPaymentProcessor()
export class GrantfoxAdapter implements IPaymentProcessor<
  GrantfoxConfig,
  PaymentRequest,
  CreatedPayment
> {
  readonly name = "grantfox";
  readonly displayName = "Grantfox";
  readonly capabilities: PaymentCapabilities = {
    supportsPartialRefund: true,
    requiresClientSideSigning: false,
    currencies: ["USD", "EUR", "USDC"],
  };

  private readonly logger = new Logger(GrantfoxAdapter.name);
  private apiUrl: string;
  private apiKey: string;

  constructor(
    private readonly http: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.apiUrl = this.stripTrailingSlash(
      this.configService.get<string>("GRANTFOX_API_URL", ""),
    );
    this.apiKey = this.configService.get<string>("GRANTFOX_API_KEY", "");
  }

  async initialize(config?: Partial<GrantfoxConfig>): Promise<void> {
    if (config?.apiUrl) {
      this.apiUrl = this.stripTrailingSlash(config.apiUrl);
    }
    if (config?.apiKey) {
      this.apiKey = config.apiKey;
    }
  }

  async createPayment(request: PaymentRequest): Promise<CreatedPayment> {
    const body = this.mapCreateRequest(request);
    const data = await this.post<any>(
      "/payments",
      body,
      request.idempotencyKey,
    );
    return this.mapPaymentResponse(data);
  }

  /**
   * Grantfox signs/submits server-side, so there is nothing to sign locally.
   * We echo the payment through so the uniform create→sign→submit flow holds.
   */
  async signTransaction(created: CreatedPayment): Promise<SignedTransaction> {
    return {
      paymentId: created.paymentId,
      signedPayload: created.paymentId,
    };
  }

  /**
   * No client submission step for a hosted gateway; fetch current status so the
   * caller gets a real transaction hash/state.
   */
  async submitTransaction(
    signed: SignedTransaction,
  ): Promise<SubmittedTransaction> {
    const status = await this.getStatus(signed.paymentId);
    return {
      paymentId: signed.paymentId,
      transactionHash: status.transactionHash ?? signed.paymentId,
      status: status.status,
      raw: status.raw,
    };
  }

  async getStatus(paymentId: string): Promise<PaymentStatusResult> {
    const data = await this.get<any>(
      `/payments/${encodeURIComponent(paymentId)}`,
    );
    const mapped = this.mapPaymentResponse(data);
    return {
      paymentId: mapped.paymentId,
      status: mapped.status,
      transactionHash: (data.transactionHash ?? data.txHash) as
        | string
        | undefined,
      confirmedAmount: (data.confirmedAmount ?? data.amount) as
        | string
        | undefined,
      raw: data,
    };
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    const body: Record<string, unknown> = {
      idempotencyKey: request.idempotencyKey,
    };
    if (request.amount !== undefined) {
      body.amount = request.amount;
    }
    if (request.reason !== undefined) {
      body.reason = request.reason;
    }

    const data = await this.post<any>(
      `/payments/${encodeURIComponent(request.paymentId)}/refund`,
      body,
      request.idempotencyKey,
    );

    const refundedAmount = String(
      data.refundedAmount ?? data.amount ?? request.amount ?? "0",
    );
    return {
      refundId: String(data.refundId ?? data.id ?? request.idempotencyKey),
      paymentId: request.paymentId,
      status: this.mapStatus(data.status) ?? PaymentStatus.REFUNDED,
      refundedAmount,
      raw: data,
    };
  }

  // ───────────────────────────── mapping (ADAPT HERE) ─────────────────────

  /**
   * ADAPT: match your Grantfox API's create-payment request shape.
   * Everything Grantfox-specific about the *outgoing* request lives here.
   */
  private mapCreateRequest(request: PaymentRequest): Record<string, unknown> {
    return {
      amount: request.amount,
      currency: request.currency,
      destination: request.destination,
      source: request.source,
      reference: request.reference,
      idempotencyKey: request.idempotencyKey,
      metadata: request.metadata,
    };
  }

  /**
   * ADAPT: match your Grantfox API's payment response shape.
   * Everything Grantfox-specific about the *incoming* response lives here.
   */
  private mapPaymentResponse(data: any): CreatedPayment {
    return {
      paymentId: String(data.id ?? data.paymentId),
      status: this.mapStatus(data.status) ?? PaymentStatus.PROCESSING,
      raw: data,
    };
  }

  /** Map a Grantfox status string onto our {@link PaymentStatus}. */
  private mapStatus(status: unknown): PaymentStatus | undefined {
    if (typeof status !== "string") {
      return undefined;
    }
    switch (status.toLowerCase()) {
      case "pending":
        return PaymentStatus.PENDING;
      case "processing":
      case "in_progress":
        return PaymentStatus.PROCESSING;
      case "submitted":
        return PaymentStatus.SUBMITTED;
      case "confirmed":
      case "succeeded":
      case "success":
      case "completed":
        return PaymentStatus.CONFIRMED;
      case "failed":
      case "error":
        return PaymentStatus.FAILED;
      case "refunded":
        return PaymentStatus.REFUNDED;
      case "partially_refunded":
        return PaymentStatus.PARTIALLY_REFUNDED;
      default:
        return undefined;
    }
  }

  // ───────────────────────────── HTTP plumbing ────────────────────────────

  private async post<T>(
    path: string,
    body: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    this.assertConfigured();
    const config = this.requestConfig(idempotencyKey);
    try {
      const response = await firstValueFrom(
        this.http.post<T>(`${this.apiUrl}${path}`, body, config),
      );
      return response.data;
    } catch (err) {
      throw this.toHttpError(err, `POST ${path}`);
    }
  }

  private async get<T>(path: string): Promise<T> {
    this.assertConfigured();
    try {
      const response = await firstValueFrom(
        this.http.get<T>(`${this.apiUrl}${path}`, this.requestConfig()),
      );
      return response.data;
    } catch (err) {
      throw this.toHttpError(err, `GET ${path}`);
    }
  }

  private requestConfig(idempotencyKey?: string): AxiosRequestConfig {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
    return { headers };
  }

  private assertConfigured(): void {
    if (!this.apiUrl) {
      throw new ServiceUnavailableException(
        "GRANTFOX_API_URL is not configured.",
      );
    }
  }

  private stripTrailingSlash(url: string): string {
    return url.replace(/\/+$/, "");
  }

  /** Map an axios error onto a Nest exception, preserving upstream status. */
  private toHttpError(err: unknown, context: string): HttpException {
    const axiosErr = err as AxiosError<any>;
    const status = axiosErr?.response?.status;
    const upstream =
      axiosErr?.response?.data?.message ??
      axiosErr?.response?.data?.error ??
      axiosErr?.message;
    const detail = `Grantfox ${context} failed: ${upstream ?? "unknown error"}`;
    this.logger.error(detail);

    if (status && status >= 400 && status < 500) {
      return new BadRequestException(detail);
    }
    return new ServiceUnavailableException(detail);
  }
}
