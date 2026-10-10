# Kubernetes Health Probe Configuration

This document describes the health check endpoints and how to configure Kubernetes liveness, readiness, and startup probes for the alian-structure API.

## Endpoints

| Endpoint | HTTP method | Purpose | Success code | Failure code |
|---|---|---|---|---|
| `GET /api/v1/health/live` | GET | Liveness — is the process alive? | 200 | — |
| `GET /api/v1/health/ready` | GET | Readiness — can it serve traffic? | 200 | 503 |
| `GET /api/v1/health/startup` | GET | Startup — has it finished initializing? | 200 | 503 |

All endpoints are public (no authentication required) and excluded from rate limiting for probe traffic.

## Response format

```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 123.456,
  "components": {
    "database": { "status": "up", "responseTime": 5 },
    "redis": { "status": "up", "responseTime": 2 },
    "application": { "status": "up" }
  }
}
```

### Status values

| Enum (`HealthStatus`) | Value | Meaning | HTTP Status Mapping |
|---|---|---|---|
| `HealthStatus.OK` | `ok` | All components healthy | `200 OK` |
| `HealthStatus.DEGRADED` | `degraded` | Some non-critical components down (readiness only) | `200 OK` |
| `HealthStatus.ERROR` | `error` | One or more critical components down | `503 Service Unavailable` |

### Component status values

| Enum (`ComponentStatus`) | Value | Meaning |
|---|---|---|
| `ComponentStatus.UP` | `up` | Subsystem responding within timeout threshold |
| `ComponentStatus.DOWN` | `down` | Subsystem unreachable or throwing error |
| `ComponentStatus.DEGRADED` | `degraded` | Subsystem responding with high latency or partial capacity |
| `ComponentStatus.UNKNOWN` | `unknown` | Status evaluation skipped or unconfigured |

## Kubernetes probe configuration

```yaml
# deployment.yaml
spec:
  containers:
    - name: alian-structure-api
      image: alian-structure/api:latest
      ports:
        - containerPort: 3000

      # Startup probe: give the app up to 90 s to fully initialize
      # before liveness/readiness probes take over.
      startupProbe:
        httpGet:
          path: /api/v1/health/startup
          port: 3000
        initialDelaySeconds: 5
        periodSeconds: 10
        failureThreshold: 9        # 9 × 10 s = 90 s maximum startup window
        successThreshold: 1
        timeoutSeconds: 5

      # Liveness probe: restart the container if the process becomes unresponsive.
      # Only activates after startupProbe succeeds.
      livenessProbe:
        httpGet:
          path: /api/v1/health/live
          port: 3000
        initialDelaySeconds: 0
        periodSeconds: 10
        failureThreshold: 3
        successThreshold: 1
        timeoutSeconds: 5

      # Readiness probe: remove the pod from the load balancer if
      # the database or Redis is unreachable.
      readinessProbe:
        httpGet:
          path: /api/v1/health/ready
          port: 3000
        initialDelaySeconds: 0
        periodSeconds: 10
        failureThreshold: 3
        successThreshold: 1
        timeoutSeconds: 5
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | *(unset)* | Redis connection URL (e.g. `redis://:password@redis:6379`). If unset, the readiness probe reports Redis as `down` but does not fail startup. |
| `HEALTH_CHECK_TIMEOUT_MS` | `5000` | Maximum milliseconds to wait for each component check before reporting it as `down`. Minimum: `100`. |

## Probe design rationale

- **Liveness** never queries dependencies. A database outage should not cause the container to restart — Kubernetes should remove it from rotation (readiness) but not kill it.
- **Readiness** checks both database (PostgreSQL) and cache (Redis). A pod is removed from service endpoints when either is unreachable, preventing cascading errors.
- **Startup** checks database connectivity AND confirms the TypeORM DataSource is initialized. This prevents readiness probes from passing before migrations and connection pools are established.
- All component checks are subject to `HEALTH_CHECK_TIMEOUT_MS` via `Promise.race`, ensuring a slow dependency never blocks probe responses indefinitely.

## Performance

Each probe executes a `SELECT 1` against PostgreSQL and a `PING` against Redis. Under normal conditions both complete in < 5 ms. The endpoints add negligible load at Kubernetes default probe intervals (10 s) and comfortably support 100+ requests/second as required.
