import client from "prom-client";

// Create a Registry to register the metrics
export const register = new client.Registry();

// Add default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({
  register,
  prefix: "alian_structure_",
});

// Custom metrics
export const httpRequestDuration = new client.Histogram({
  name: "alian_structure_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.1, 0.3, 0.5, 0.7, 1, 3, 5, 7, 10],
  registers: [register],
});

export const httpRequestTotal = new client.Counter({
  name: "alian_structure_http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

export const httpRequestsInProgress = new client.Gauge({
  name: "alian_structure_http_requests_in_progress",
  help: "Number of HTTP requests currently in progress",
  labelNames: ["method", "route"],
  registers: [register],
});

export const databaseQueryDuration = new client.Histogram({
  name: "alian_structure_database_query_duration_seconds",
  help: "Duration of database queries in seconds",
  labelNames: ["operation", "table"],
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers: [register],
});

export const activeConnections = new client.Gauge({
  name: "alian_structure_active_connections",
  help: "Number of active connections",
  labelNames: ["type"],
  registers: [register],
});

export const errorTotal = new client.Counter({
  name: "alian_structure_errors_total",
  help: "Total number of errors",
  labelNames: ["type", "severity"],
  registers: [register],
});

// Business metrics examples
export const userSignups = new client.Counter({
  name: "alian_structure_user_signups_total",
  help: "Total number of user signups",
  registers: [register],
});

export const activeUsers = new client.Gauge({
  name: "alian_structure_active_users",
  help: "Number of currently active users",
  registers: [register],
});

// Compute job queue metrics
export const jobDuration = new client.Histogram({
  name: "alian_structure_job_duration_seconds",
  help: "Duration of compute job processing in seconds",
  labelNames: ["job_type", "status"],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300],
  registers: [register],
});

export const jobSuccessTotal = new client.Counter({
  name: "alian_structure_job_success_total",
  help: "Total number of successfully completed jobs",
  labelNames: ["job_type"],
  registers: [register],
});

export const jobFailureTotal = new client.Counter({
  name: "alian_structure_job_failure_total",
  help: "Total number of failed jobs",
  labelNames: ["job_type", "failure_reason"],
  registers: [register],
});

export const queueLength = new client.Gauge({
  name: "alian_structure_queue_length",
  help: "Number of jobs in various queue states",
  labelNames: ["queue_name", "state"],
  registers: [register],
});

export const billingUsageUnits = new client.Counter({
  name: "alian_structure_billing_usage_units_total",
  help: "Total metered billing units recorded",
  labelNames: ["plan", "metric"],
  registers: [register],
});

export const billingEstimatedChargesCents = new client.Gauge({
  name: "alian_structure_billing_estimated_charges_cents",
  help: "Latest estimated billing charge in cents by plan",
  labelNames: ["plan"],
  registers: [register],
});
