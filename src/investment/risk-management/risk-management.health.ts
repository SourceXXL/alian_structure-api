import { Injectable } from "@nestjs/common";
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from "@nestjs/terminus";
import { CircuitBreakerService } from "./circuit-breaker.service";

@Injectable()
export class RiskManagementHealthIndicator extends HealthIndicator {
  constructor(private readonly circuitBreaker: CircuitBreakerService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const status = this.circuitBreaker.getStatus("default");
    const isHealthy = status.state !== "OPEN";

    if (isHealthy) {
      return {
        [key]: {
          status: "up",
          circuitBreakerState: status.state,
          failureCount: status.failureCount,
          lastFailureTime: status.lastFailureTime,
        },
      };
    }

    throw new HealthCheckError(
      "Risk management circuit breaker is open",
      {
        [key]: {
          status: "down",
          circuitBreakerState: status.state,
          failureCount: status.failureCount,
          lastFailureTime: status.lastFailureTime,
        },
      },
    );
  }
}
