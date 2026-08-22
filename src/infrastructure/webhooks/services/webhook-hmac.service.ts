import { Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";

@Injectable()
export class WebhookHmacService {
  /**
   * Compute HMAC-SHA256 signature for a webhook payload.
   * Returns the hex-encoded signature prefixed with "sha256=".
   */
  sign(payload: string, secret: string): string {
    const signature = createHmac("sha256", secret)
      .update(payload, "utf8")
      .digest("hex");
    return `sha256=${signature}`;
  }

  /**
   * Build the standard webhook request headers including the HMAC signature.
   */
  buildSignedHeaders(
    signingKey: string,
    payload: string,
    eventId: string,
    eventType: string,
    extraHeaders?: Record<string, string>,
  ): Record<string, string> {
    const signature = this.sign(payload, signingKey);
    return {
      "Content-Type": "application/json",
      "X-Webhook-Event-Id": eventId,
      "X-Webhook-Event-Type": eventType,
      "X-Webhook-Signature": signature,
      "X-Webhook-Timestamp": Date.now().toString(),
      "User-Agent": "AlianStructure-Webhook/1.0",
      ...extraHeaders,
    };
  }

  /**
   * Verify an incoming HMAC signature (useful for echo/test endpoints).
   */
  verify(payload: string, secret: string, receivedSignature: string): boolean {
    const expected = this.sign(payload, secret);
    try {
      return timingSafeEqual(
        Buffer.from(expected, "utf8"),
        Buffer.from(receivedSignature, "utf8"),
      );
    } catch {
      return false;
    }
  }
}
