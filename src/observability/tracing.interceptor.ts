import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable, throwError } from "rxjs";
import { tap, catchError } from "rxjs/operators";
import { Request, Response } from "express";
import { SpanStatusCode, trace, context } from "@opentelemetry/api";
import { getTracer, extractContext } from "../config/tracing";

/**
 * Intercepts every HTTP request and wraps the handler execution in an
 * OpenTelemetry span.  Trace context is extracted from incoming headers so
 * that distributed traces (coming from a gateway or upstream service) are
 * properly continued rather than started fresh.
 */
@Injectable()
export class TracingInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const httpCtx = ctx.switchToHttp();
    const req = httpCtx.getRequest<Request>();
    const res = httpCtx.getResponse<Response>();

    // Propagate upstream trace context if present
    const parentCtx = extractContext(req.headers as Record<string, string>);
    const tracer = getTracer();
    const spanName = `${req.method} ${ctx.getClass().name}.${ctx.getHandler().name}`;

    return new Observable((subscriber) => {
      tracer.startActiveSpan(spanName, {}, parentCtx, (span) => {
        span.setAttribute("http.method", req.method);
        span.setAttribute("http.url", req.url);
        span.setAttribute("http.route", req.route?.path ?? req.url);
        span.setAttribute("handler.class", ctx.getClass().name);
        span.setAttribute("handler.method", ctx.getHandler().name);

        const requestId = req.headers["x-request-id"];
        if (requestId) {
          span.setAttribute(
            "request.id",
            Array.isArray(requestId) ? requestId[0] : requestId,
          );
        }

        context.with(trace.setSpan(context.active(), span), () => {
          next
            .handle()
            .pipe(
              tap(() => {
                span.setAttribute("http.status_code", res.statusCode);
                span.setStatus({ code: SpanStatusCode.OK });
                span.end();
              }),
              catchError((err: Error) => {
                span.recordException(err);
                span.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: err.message,
                });
                span.setAttribute(
                  "http.status_code",
                  res.statusCode >= 400 ? res.statusCode : 500,
                );
                span.end();
                return throwError(() => err);
              }),
            )
            .subscribe({
              next: (v) => subscriber.next(v),
              error: (e) => subscriber.error(e),
              complete: () => subscriber.complete(),
            });
        });
      });
    });
  }
}
