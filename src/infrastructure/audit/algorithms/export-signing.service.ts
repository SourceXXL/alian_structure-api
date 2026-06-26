import { Injectable } from "@nestjs/common";
import * as crypto from "crypto";

@Injectable()
export class ExportSigningService {
  private readonly systemKey = process.env.AUDIT_EXPORT_SIGNING_KEY || "";

  sign(payload: string): string {
    if (!this.systemKey) {
      throw new Error("AUDIT_EXPORT_SIGNING_KEY is not configured");
    }
    return crypto
      .createHmac("sha256", this.systemKey)
      .update(payload)
      .digest("hex");
  }

  verify(payload: string, signature: string): boolean {
    const expected = this.sign(payload);
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(signature, "hex"),
    );
  }
}