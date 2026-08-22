import { HttpModule } from "@nestjs/axios";
import { Module, OnModuleInit } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { DiscoveryModule, DiscoveryService, Reflector } from "@nestjs/core";
import { Horizon } from "@stellar/stellar-sdk";
import { GrantfoxAdapter } from "./adapters/grantfox/grantfox.adapter";
import { StellarAdapter } from "./adapters/stellar/stellar.adapter";
import {
  DEFAULT_HORIZON_URL,
  STELLAR_HORIZON_SERVER,
} from "./adapters/stellar/stellar.constants";
import { PAYMENT_PROCESSOR_METADATA } from "./decorators/register-payment-processor.decorator";
import { IPaymentProcessor } from "./interfaces/payment-processor.interface";
import { PaymentProcessorFactory } from "./payment-processor.factory";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { PaymentProcessorRegistry } from "./registry/payment-processor.registry";
import { StellarPaymentsController } from "./stellar-payments.controller";

/**
 * Wires the payment-processor plugin system.
 *
 * Imports only Config/Http/Discovery (no TypeORM/Bull/Redis) so the module
 * boots standalone in integration tests. Adapters tagged with
 * `@RegisterPaymentProcessor()` are auto-registered on init — adding a new
 * processor means adding one provider here (or anywhere Nest can discover it),
 * with no change to the registry, factory, controller, or this init logic.
 *
 * The Stellar Horizon `Server` is provided via {@link STELLAR_HORIZON_SERVER}
 * so tests can override it with an in-memory fake (no network I/O offline).
 */
@Module({
  imports: [ConfigModule, HttpModule, DiscoveryModule],
  // StellarPaymentsController MUST precede PaymentsController: its static
  // `payments/stellar/{submit,status}` routes would otherwise be shadowed by the
  // generic dynamic `payments/:id/{submit,status}` routes (Express matches in
  // registration order). See the note in stellar-payments.controller.ts.
  controllers: [StellarPaymentsController, PaymentsController],
  providers: [
    PaymentProcessorRegistry,
    PaymentProcessorFactory,
    PaymentsService,
    StellarAdapter,
    GrantfoxAdapter,
    {
      provide: STELLAR_HORIZON_SERVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>(
          "STELLAR_HORIZON_URL",
          DEFAULT_HORIZON_URL,
        );
        return new Horizon.Server(url);
      },
    },
  ],
  exports: [PaymentProcessorRegistry, PaymentProcessorFactory, PaymentsService],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly reflector: Reflector,
    private readonly registry: PaymentProcessorRegistry,
  ) {}

  /**
   * Discover every provider tagged `@RegisterPaymentProcessor()` and register
   * it. Matching only on our metadata key keeps this from picking up the DeFi
   * protocol adapters (which lack the key).
   */
  onModuleInit(): void {
    for (const wrapper of this.discoveryService.getProviders()) {
      const { instance, metatype } = wrapper;
      if (!instance || !metatype) {
        continue;
      }
      const isProcessor = this.reflector.get<boolean>(
        PAYMENT_PROCESSOR_METADATA,
        metatype,
      );
      if (isProcessor) {
        this.registry.register(instance as IPaymentProcessor);
      }
    }
  }
}
