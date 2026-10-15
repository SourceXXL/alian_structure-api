import { BadRequestException } from "@nestjs/common";
import {
  DnsLookupFn,
  WebhookUrlValidatorService,
} from "./webhook-url-validator.service";

describe("WebhookUrlValidatorService", () => {
  const originalEnv = { ...process.env };
  let publicDnsResolver: jest.MockedFunction<DnsLookupFn>;
  let validator: WebhookUrlValidatorService;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.WEBHOOK_ALLOW_INSECURE_HTTP;
    delete process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS;
    delete process.env.WEBHOOK_ALLOWED_PORTS;
    process.env.NODE_ENV = "test";

    publicDnsResolver = jest
      .fn<ReturnType<DnsLookupFn>, Parameters<DnsLookupFn>>()
      .mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

    validator = new WebhookUrlValidatorService();
    validator.setLookupFn(publicDnsResolver);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("valid public endpoints", () => {
    it("accepts a valid https URL resolving to a public IPv4 address", async () => {
      const result = await validator.validateWebhookUrl(
        "https://hooks.example.com/webhooks/receive",
      );

      expect(result.url.toString()).toBe(
        "https://hooks.example.com/webhooks/receive",
      );
      expect(result.hostname).toBe("hooks.example.com");
      expect(result.port).toBe(443);
      expect(result.resolvedAddresses).toEqual([
        { address: "93.184.216.34", family: 4 },
      ]);
      expect(publicDnsResolver).toHaveBeenCalledWith("hooks.example.com");
    });

    it("accepts a public IPv4 literal in the 172.32.0.0/16 range", async () => {
      const result = await validator.validateWebhookUrl(
        "https://172.32.0.10/webhook",
      );

      expect(result.resolvedAddresses).toEqual([
        { address: "172.32.0.10", family: 4 },
      ]);
      expect(publicDnsResolver).not.toHaveBeenCalled();
    });

    it("accepts a public IPv6 literal", async () => {
      const result = await validator.validateWebhookUrl(
        "https://[2606:2800:220:1:248:1893:25c8:1946]/hook",
      );

      expect(result.resolvedAddresses).toEqual([
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      ]);
    });
  });

  describe("scheme and syntax restrictions", () => {
    it.each([
      "",
      "not-a-url",
      "file:///etc/passwd",
      "gopher://127.0.0.1:6379/_INFO",
      "ftp://hooks.example.com/resource",
      "data:text/plain;base64,SGVsbG8=",
    ])("rejects disallowed or malformed URL: %s", async (input) => {
      await expect(validator.validateWebhookUrl(input)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("rejects http:// URLs by default outside development", async () => {
      await expect(
        validator.validateWebhookUrl("http://hooks.example.com/webhook"),
      ).rejects.toThrow(BadRequestException);
    });

    it("allows http:// URLs when WEBHOOK_ALLOW_INSECURE_HTTP=true outside production", async () => {
      process.env.WEBHOOK_ALLOW_INSECURE_HTTP = "true";

      const result = await validator.validateWebhookUrl(
        "http://hooks.example.com/webhook",
      );

      expect(result.url.toString()).toBe("http://hooks.example.com/webhook");
      expect(result.port).toBe(80);
    });

    it("rejects URLs with embedded credentials", async () => {
      await expect(
        validator.validateWebhookUrl(
          "https://admin:secret@hooks.example.com/webhook",
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("port allowlist", () => {
    it.each([
      "https://hooks.example.com:6379/hook",
      "https://hooks.example.com:5432/hook",
      "https://hooks.example.com:8080/hook",
      "https://hooks.example.com:22/hook",
    ])("rejects non-allowlisted port in %s", async (url) => {
      await expect(validator.validateWebhookUrl(url)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("allows custom ports when WEBHOOK_ALLOWED_PORTS is configured", async () => {
      process.env.WEBHOOK_ALLOWED_PORTS = "8443,9443";

      const result = await validator.validateWebhookUrl(
        "https://hooks.example.com:8443/hook",
      );

      expect(result.url.toString()).toBe("https://hooks.example.com:8443/hook");
      expect(result.port).toBe(8443);
    });
  });

  describe("SSRF private, loopback, link-local, and metadata protection", () => {
    it.each([
      ["loopback 127.0.0.1", "https://127.0.0.1/hook"],
      ["loopback 127.255.255.254", "https://127.255.255.254/hook"],
      ["localhost hostname", "https://localhost/hook"],
      ["subdomain of localhost", "https://api.localhost/hook"],
      ["internal TLD", "https://redis.internal/hook"],
      ["local mDNS TLD", "https://printer.local/hook"],
      [
        "GCP metadata hostname",
        "https://metadata.google.internal/computeMetadata/v1/",
      ],
      [
        "AWS/GCP/Azure metadata IP",
        "https://169.254.169.254/latest/meta-data/",
      ],
      ["RFC 1918 10.0.0.0/8", "https://10.0.0.1/hook"],
      ["RFC 1918 172.16.0.0/12 start", "https://172.16.0.1/hook"],
      ["RFC 1918 172.16.0.0/12 end", "https://172.31.255.254/hook"],
      ["RFC 1918 192.168.0.0/16", "https://192.168.1.1/hook"],
      ["CGNAT 100.64.0.0/10", "https://100.64.0.1/hook"],
      ["unspecified 0.0.0.0", "https://0.0.0.0/hook"],
      ["IPv6 loopback ::1", "https://[::1]/hook"],
      ["IPv6 unspecified ::", "https://[::]/hook"],
      ["IPv4-mapped IPv6 loopback", "https://[::ffff:127.0.0.1]/hook"],
      ["IPv4-mapped IPv6 metadata", "https://[::ffff:169.254.169.254]/hook"],
      ["IPv6 unique-local fc00::/7", "https://[fd00::1]/hook"],
      ["IPv6 link-local fe80::/10", "https://[fe80::1]/hook"],
      ["short-form IPv4 127.1", "https://127.1/hook"],
      ["decimal integer IPv4 2130706433", "https://2130706433/hook"],
      ["hex IPv4 0x7f000001", "https://0x7f000001/hook"],
      ["octal IPv4 0177.0.0.1", "https://0177.0.0.1/hook"],
    ])("rejects %s (%s)", async (_label, url) => {
      await expect(validator.validateWebhookUrl(url)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("rejects a public hostname whose DNS resolves to a private IPv4 address", async () => {
      publicDnsResolver.mockResolvedValueOnce([
        { address: "169.254.169.254", family: 4 },
      ]);

      await expect(
        validator.validateWebhookUrl("https://evil.example.com/hook"),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a hostname when any resolved DNS record is private (mixed records)", async () => {
      publicDnsResolver.mockResolvedValueOnce([
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.42", family: 4 },
      ]);

      await expect(
        validator.validateWebhookUrl("https://dual.example.com/hook"),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects a hostname when DNS lookup fails or returns no records", async () => {
      publicDnsResolver.mockRejectedValueOnce(new Error("ENOTFOUND"));

      await expect(
        validator.validateWebhookUrl("https://nonexistent.example.com/hook"),
      ).rejects.toThrow(BadRequestException);
    });

    it("allows private targets only when WEBHOOK_ALLOW_PRIVATE_NETWORKS=true outside production", async () => {
      process.env.WEBHOOK_ALLOW_INSECURE_HTTP = "true";
      process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS = "true";
      process.env.WEBHOOK_ALLOWED_PORTS = "8080";

      const result = await validator.validateWebhookUrl(
        "http://127.0.0.1:8080/local-hook",
      );

      expect(result.hostname).toBe("127.0.0.1");
      expect(result.port).toBe(8080);
    });

    it("never allows private networks or insecure http in NODE_ENV=production", async () => {
      process.env.NODE_ENV = "production";
      process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS = "true";
      process.env.WEBHOOK_ALLOW_INSECURE_HTTP = "true";

      await expect(
        validator.validateWebhookUrl("https://127.0.0.1/hook"),
      ).rejects.toThrow(BadRequestException);

      await expect(
        validator.validateWebhookUrl("http://hooks.example.com/hook"),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
