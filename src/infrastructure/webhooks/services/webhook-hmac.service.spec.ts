import { WebhookHmacService } from "./webhook-hmac.service";

describe("WebhookHmacService", () => {
  let service: WebhookHmacService;

  beforeEach(() => {
    service = new WebhookHmacService();
  });

  describe("sign", () => {
    it("produces a deterministic sha256= prefixed hex digest", () => {
      const payload = JSON.stringify({ id: "evt_1", eventType: "agent.created" });
      const secret = "whsec_test_secret_key_123456";

      const sig1 = service.sign(payload, secret);
      const sig2 = service.sign(payload, secret);

      expect(sig1).toBe(sig2);
      expect(sig1).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it("produces different signatures for different secrets or payloads", () => {
      const payload = '{"event":"order.paid"}';
      const sigA = service.sign(payload, "secret-a");
      const sigB = service.sign(payload, "secret-b");
      const sigDifferentPayload = service.sign('{"event":"order.failed"}', "secret-a");

      expect(sigA).not.toBe(sigB);
      expect(sigA).not.toBe(sigDifferentPayload);
    });
  });

  describe("buildSignedHeaders", () => {
    it("includes standard webhook metadata headers and HMAC signature", () => {
      const payload = '{"id":"evt_42"}';
      const secret = "whsec_signing_key";
      const headers = service.buildSignedHeaders(
        secret,
        payload,
        "evt_42",
        "agent.updated",
      );

      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["X-Webhook-Event-Id"]).toBe("evt_42");
      expect(headers["X-Webhook-Event-Type"]).toBe("agent.updated");
      expect(headers["X-Webhook-Signature"]).toBe(service.sign(payload, secret));
      expect(headers["User-Agent"]).toBe("AlianStructure-Webhook/1.0");
      expect(Number(headers["X-Webhook-Timestamp"])).not.toBeNaN();
    });

    it("merges custom extra headers", () => {
      const headers = service.buildSignedHeaders(
        "whsec_key",
        "{}",
        "evt_1",
        "test.event",
        { "X-Custom-Header": "custom-value" },
      );

      expect(headers["X-Custom-Header"]).toBe("custom-value");
      expect(headers["X-Webhook-Event-Id"]).toBe("evt_1");
    });
  });

  describe("verify", () => {
    const payload = '{"id":"evt_99","data":{"amount":100}}';
    const secret = "whsec_verify_secret";

    it("returns true for a valid signature produced by sign()", () => {
      const signature = service.sign(payload, secret);
      expect(service.verify(payload, secret, signature)).toBe(true);
    });

    it("returns false when verified with the wrong secret", () => {
      const signature = service.sign(payload, secret);
      expect(service.verify(payload, "wrong_secret", signature)).toBe(false);
    });

    it("returns false when the payload has been tampered with", () => {
      const signature = service.sign(payload, secret);
      const tampered = '{"id":"evt_99","data":{"amount":999999}}';
      expect(service.verify(tampered, secret, signature)).toBe(false);
    });

    it("returns false cleanly without throwing on wrong-length or malformed signatures", () => {
      expect(service.verify(payload, secret, "")).toBe(false);
      expect(service.verify(payload, secret, "sha256=deadbeef")).toBe(false);
      expect(service.verify(payload, secret, "not-a-valid-signature")).toBe(
        false,
      );
    });
  });
});
