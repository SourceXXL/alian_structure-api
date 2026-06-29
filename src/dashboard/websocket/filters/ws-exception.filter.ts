import { ExceptionFilter, Catch, ArgumentsHost, Logger } from "@nestjs/common";
import { WsException } from "@nestjs/websockets";
import { Socket } from "socket.io";
import {
  WsErrorResponse,
  DashboardEvent,
} from "../interfaces/websocket.interfaces";

@Catch()
export class WsExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(WsExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const client: Socket = host.switchToWs().getClient();

    let errorResponse: WsErrorResponse;

    if (exception instanceof WsException) {
      const error = (exception as WsException).getError();

      if (typeof error === "string") {
        errorResponse = {
          code: "WS_ERROR",
          message: error,
        };
      } else if (typeof error === "object" && error !== null) {
        errorResponse = {
          code: (error as any).code || "WS_ERROR",
          message: (error as any).message || "An error occurred",
          details: (error as any).details,
        };
      } else {
        errorResponse = {
          code: "WS_ERROR",
          message: "Unknown error",
        };
      }
    } else if (exception instanceof Error) {
      errorResponse = {
        code: "INTERNAL_ERROR",
        message: exception.message,
      };

      this.logger.error(
        `WebSocket error: ${exception.message}`,
        exception.stack,
      );
    } else {
      errorResponse = {
        code: "UNKNOWN_ERROR",
        message: "An unknown error occurred",
      };
    }

    // Send error to client
    client.emit(DashboardEvent.ERROR, errorResponse);
  }
}
