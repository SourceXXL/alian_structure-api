import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { Span, SpanStatusCode } from "@opentelemetry/api";
import { createSpan } from "../config/tracing";
import {
  httpRequestDuration,
  httpRequestTotal,
  httpRequestsInProgress,
  errorTotal,
} from "../config/metrics";
import { generateRandomId } from "src/common/utils/random-id";

/**
 * Normalise an Express request path so it can be safely used as a Prometheus
 * label. Replaces UUIDs, numeric identifiers, hex addresses (e.g. Ethereum
 * wallet or tx hashes) and well-known object-id patterns with placeholders to
 * bound label cardinality, which would otherwise grow with every request
 * hitting a parameterised route.
 */
function normaliseRoute(rawPath: string): string {
  return rawPath
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
      ":uuid",
    )
    .replace(/0x[0-9a-f]{40}/gi, ":address")
    .replace(/0x[0-9a-f]{64}/gi, ":hash")
    .replace(/\d+/g, ":id");
}

const UNMATCHED_ROUTE = "unmatched";

export interface RequestTiming {
  requestId: string;
  method: string;
  path: string;
  startTime: number;
  timings: {
    middlewareStart: number;
    middlewareEnd: number;
    routeHandlerStart: number;
    routeHandlerEnd: number;
    databaseStart?: number;
    databaseEnd?: number;
    totalDuration: number;
  };
  span?: Span;
}

@Injectable()
export class RequestTimingMiddleware implements NestMiddleware {
  private activeRequests: Map<string, RequestTiming> = new Map();

  use(req: Request, res: Response, next: NextFunction) {
    const headerRequestId = req.headers["x-request-id"];
    // Correlation id for this request's timing sample. The previous fallback,
    // `Math.random().toString(36).substring(7)`, is not a CSPRNG and returned a
    // ~9 character predictable string: overlapping requests can collide on the
    // same key and end up sharing (and clobbering) each other's entry in
    // `activeRequests`. A v4 UUID matches the `x-request-id` values that
    // callers already send, so the key space is uniform.
    const requestId: string = Array.isArray(headerRequestId)
      ? headerRequestId[0]
      : headerRequestId || generateRandomId();
    const startTime = Date.now();
    const normalisedPath = normaliseRoute(req.path);
    // At middleware entry, Express has not yet matched a route, so fall back
    // to the normalised path. If it contains still-bounded parameters we
    // bucket the request as "unmatched" to protect label cardinality.
    const initialRoute =
      (req as any).route && (req as any).route.path
        ? `${req.baseUrl || ""}${(req as any).route.path}`
        : normalisedPath;
    const labels = { method: req.method, route: initialRoute };

    httpRequestsInProgress.inc(labels);

    // Guard against double-decrement when both `finish` and `close` fire for
    // the same response (Node fires `close` for abrupt terminations and may
    // fire after `finish` for aborted responses).
    let inProgressDecremented = false;
    const decrementInProgress = (routeLabel: string) => {
      if (inProgressDecremented) return;
      inProgressDecremented = true;
      httpRequestsInProgress.dec({ method: req.method, route: routeLabel });
    };

    const timing: RequestTiming = {
      requestId,
      method: req.method,
      path: req.path,
      startTime,
      timings: {
        middlewareStart: startTime,
        middlewareEnd: 0,
        routeHandlerStart: 0,
        routeHandlerEnd: 0,
        totalDuration: 0,
      },
    };

    this.activeRequests.set(requestId, timing);

    // Add timing to request object for use in other parts of the application
    (req as any).requestTiming = timing;
    (req as any).startDatabaseTimer = this.startDatabaseTimer.bind(
      this,
      requestId,
    );
    (req as any).endDatabaseTimer = this.endDatabaseTimer.bind(this, requestId);

    // Create OpenTelemetry span for this request
    createSpan(`HTTP ${req.method} ${req.path}`, async (span) => {
      timing.span = span;
      span.setAttribute("http.method", req.method);
      span.setAttribute("http.path", req.path);
      span.setAttribute("request.id", requestId);

      // Track when the request finishes
      res.on("finish", () => {
        const endTime = Date.now();
        timing.timings.routeHandlerEnd = endTime;
        timing.timings.totalDuration = endTime - startTime;
        const totalDurationSeconds = timing.timings.totalDuration / 1000;

        // Add all timings as span attributes
        span.setAttribute(
          "timings.middleware_duration",
          timing.timings.middlewareEnd - timing.timings.middlewareStart,
        );
        span.setAttribute(
          "timings.handler_duration",
          timing.timings.routeHandlerEnd - timing.timings.routeHandlerStart,
        );
        span.setAttribute(
          "timings.total_duration",
          timing.timings.totalDuration,
        );

        if (timing.timings.databaseEnd && timing.timings.databaseStart) {
          span.setAttribute(
            "timings.database_duration",
            timing.timings.databaseEnd - timing.timings.databaseStart,
          );
        }

        // Add response status code
        span.setAttribute("http.status_code", res.statusCode);
        if (res.statusCode >= 400) {
          span.setStatus({ code: SpanStatusCode.ERROR });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }

        // Update Prometheus counters/histograms with the *matched* route
        // pattern (or the normalised path as a fallback). Falling back to the
        // raw path here is safe because the Express router has populated
        // `req.route` for any handler that actually ran.
        const matchedRoute =
          (req as any).route && (req as any).route.path
            ? `${req.baseUrl || ""}${(req as any).route.path}`
            : res.statusCode === 404
              ? UNMATCHED_ROUTE
              : initialRoute;
        const responseLabels = {
          method: req.method,
          route: matchedRoute,
          status_code: String(res.statusCode),
        };

        httpRequestTotal.inc(responseLabels);
        httpRequestDuration.observe(responseLabels, totalDurationSeconds);
        decrementInProgress(matchedRoute);

        if (res.statusCode >= 400) {
          errorTotal.inc({
            type: "http",
            severity: res.statusCode >= 500 ? "high" : "low",
          });
        }

        // Log the timing data for analysis
        this.logRequestTiming(timing);

        // Cleanup
        this.activeRequests.delete(requestId);
      });

      // `close` fires for aborted/disconnected responses where `finish`
      // never reaches the listener. Release the in-progress gauge so it does
      // not leak on slow or disconnected clients. The request/error counters
      // remain owned by the `finish` handler.
      res.on("close", () => {
        if (inProgressDecremented) return;
        decrementInProgress(initialRoute);
        this.activeRequests.delete(requestId);
      });

      // Continue to the next middleware/handler
      timing.timings.middlewareEnd = Date.now();
      timing.timings.routeHandlerStart = Date.now();
      next();
    });
  }

  private startDatabaseTimer(requestId: string) {
    const timing = this.activeRequests.get(requestId);
    if (timing) {
      timing.timings.databaseStart = Date.now();
    }
  }

  private endDatabaseTimer(
    requestId: string,
    operation?: string,
    table?: string,
  ) {
    const timing = this.activeRequests.get(requestId);
    if (timing && timing.timings.databaseStart) {
      timing.timings.databaseEnd = Date.now();
      const duration =
        timing.timings.databaseEnd - timing.timings.databaseStart;

      // Add database operation details to the span if available
      if (timing.span && operation && table) {
        timing.span.addEvent(`database.${operation}`, {
          "db.operation": operation,
          "db.table": table,
          "db.duration": duration,
        });
      }
    }
  }

  private logRequestTiming(timing: RequestTiming) {
    const { requestId, method, path, timings } = timing;
    const databaseDuration =
      timings.databaseEnd && timings.databaseStart
        ? timings.databaseEnd - timings.databaseStart
        : 0;

    // Log with structured data for easy parsing
    console.log(
      JSON.stringify({
        type: "request_timing",
        timestamp: new Date().toISOString(),
        requestId,
        method,
        path,
        timings: {
          middleware: timings.middlewareEnd - timings.middlewareStart,
          handler: timings.routeHandlerEnd - timings.routeHandlerStart,
          database: databaseDuration,
          total: timings.totalDuration,
        },
        // Waterfall timings for visualization
        waterfall: {
          middleware: [
            timings.middlewareStart - timing.startTime,
            timings.middlewareEnd - timing.startTime,
          ],
          handler: [
            timings.routeHandlerStart - timing.startTime,
            timings.routeHandlerEnd - timing.startTime,
          ],
          database:
            timings.databaseStart && timings.databaseEnd
              ? [
                  timings.databaseStart - timing.startTime,
                  timings.databaseEnd - timing.startTime,
                ]
              : null,
        },
      }),
    );
  }

  // Helper to get all active requests for monitoring
  getActiveRequests(): RequestTiming[] {
    return Array.from(this.activeRequests.values());
  }
}
