import client from "prom-client";
import { register } from "../config/metrics";

const PREFIX = "alian_structure_";

function getOrCreateCounter(
  config: client.CounterConfiguration<string>,
): client.Counter {
  const existing = register.getSingleMetric(config.name);
  if (existing) return existing as client.Counter;
  return new client.Counter({ ...config, registers: [register] });
}

function getOrCreateGauge(
  config: client.GaugeConfiguration<string>,
): client.Gauge {
  const existing = register.getSingleMetric(config.name);
  if (existing) return existing as client.Gauge;
  return new client.Gauge({ ...config, registers: [register] });
}

export const rateLimitAllowedTotal = getOrCreateCounter({
  name: `${PREFIX}rate_limit_allowed_total`,
  help: "Total number of rate-limit requests allowed",
  labelNames: ["tier", "scope", "strategy", "key"],
});

export const rateLimitDeniedTotal = getOrCreateCounter({
  name: `${PREFIX}rate_limit_denied_total`,
  help: "Total number of rate-limit requests denied",
  labelNames: ["tier", "scope", "strategy", "key"],
});

export const rateLimitErrorsTotal = getOrCreateCounter({
  name: `${PREFIX}rate_limit_errors_total`,
  help: "Total number of rate-limiter storage errors",
  labelNames: ["operation", "storage"],
});

export const rateLimitStorageHealth = getOrCreateGauge({
  name: `${PREFIX}rate_limit_storage_health`,
  help: "Rate-limit storage health (1 = redis healthy, 0 = redis unhealthy/in-memory fallback)",
  labelNames: ["storage"],
});
