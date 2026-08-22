import { HttpService } from "@nestjs/axios";
import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { Account, Keypair, Networks } from "@stellar/stellar-sdk";
import { of } from "rxjs";
import request from "supertest";
import { JwtAuthGuard } from "src/core/auth/jwt.guard";
import { RolesGuard } from "src/common/guard/roles.guard";
import { createGlobalValidationPipe } from "src/common/pipes/validation.pipe";
import { STELLAR_HORIZON_SERVER } from "./adapters/stellar/stellar.constants";
import { PaymentsModule } from "./payments.module";

/**
 * End-to-end proof that two processors run side-by-side without interference:
 * the same endpoints route to Stellar or Grantfox purely by selector, results
 * stay isolated, and disabling one leaves the other fully operational.
 *
 * Both network clients are replaced with in-memory fakes, so nothing leaves the
 * process. Auth/role guards are overridden to isolate the payments behaviour.
 */
describe("Payments (side-by-side integration)", () => {
  const signingKp = Keypair.random();
  const payerKp = Keypair.random();
  const destKp = Keypair.random();

  let app: INestApplication;

  const stellarServer = {
    loadAccount: jest
      .fn()
      .mockResolvedValue(new Account(payerKp.publicKey(), "100")),
    submitTransaction: jest
      .fn()
      .mockResolvedValue({ hash: "STELLAR_TX", successful: true }),
    transactions: jest.fn().mockReturnValue({
      transaction: () => ({
        call: () => Promise.resolve({ hash: "STELLAR_TX", successful: true }),
      }),
    }),
    payments: jest.fn().mockReturnValue({
      forTransaction: () => ({
        call: () =>
          Promise.resolve({
            records: [
              {
                type: "payment",
                amount: "10",
                from: payerKp.publicKey(),
                to: signingKp.publicKey(),
                asset_type: "native",
              },
            ],
          }),
      }),
    }),
  };

  const httpService = {
    post: jest.fn((url: string) =>
      of(
        url.endsWith("/refund")
          ? { data: { refundId: "GF_RF", status: "refunded", amount: "10" } }
          : { data: { id: "GF_PAY", status: "processing" } },
      ),
    ),
    get: jest.fn(() =>
      of({
        data: {
          id: "GF_PAY",
          status: "confirmed",
          transactionHash: "GF_TX",
          amount: "10",
        },
      }),
    ),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              PAYMENTS_DEFAULT_PROCESSOR: "stellar",
              STELLAR_NETWORK_PASSPHRASE: Networks.TESTNET,
              STELLAR_SIGNING_SECRET: signingKp.secret(),
              GRANTFOX_API_URL: "https://api.grantfox.example",
              GRANTFOX_API_KEY: "key",
            }),
          ],
        }),
        PaymentsModule,
      ],
    })
      .overrideProvider(STELLAR_HORIZON_SERVER)
      .useValue(stellarServer)
      .overrideProvider(HttpService)
      .useValue(httpService)
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    app.setGlobalPrefix("api/v1");
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const stellarBody = {
    amount: "10",
    currency: "XLM",
    destination: destKp.publicKey(),
    source: payerKp.publicKey(),
    idempotencyKey: "idem-stellar",
  };
  const grantfoxBody = {
    amount: "10",
    currency: "USD",
    destination: "acct_1",
    idempotencyKey: "idem-grantfox",
  };

  it("lists both auto-registered processors", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/payments/processors")
      .expect(200);

    expect(res.body.map((p: any) => p.name).sort()).toEqual([
      "grantfox",
      "stellar",
    ]);
  });

  it("routes to the env-default processor (stellar) when no header is sent", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/payments")
      .send(stellarBody)
      .expect(201);

    // Stellar returns an unsigned XDR + PENDING; Grantfox would not.
    expect(res.body.status).toBe("PENDING");
    expect(typeof res.body.unsignedTransaction).toBe("string");
  });

  it("routes to Grantfox when the header selects it", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/payments")
      .set("x-payment-processor", "grantfox")
      .send(grantfoxBody)
      .expect(201);

    expect(res.body.paymentId).toBe("GF_PAY");
    expect(res.body.status).toBe("PROCESSING");
  });

  it("keeps two processors isolated within the same test", async () => {
    const stellar = await request(app.getHttpServer())
      .post("/api/v1/payments")
      .set("x-payment-processor", "stellar")
      .send(stellarBody)
      .expect(201);

    const grantfox = await request(app.getHttpServer())
      .post("/api/v1/payments")
      .set("x-payment-processor", "grantfox")
      .send(grantfoxBody)
      .expect(201);

    expect(stellar.body.paymentId).not.toBe(grantfox.body.paymentId);
    expect(stellar.body.status).toBe("PENDING");
    expect(grantfox.body.status).toBe("PROCESSING");
  });

  it("runs a full stellar create → sign → submit round-trip", async () => {
    const created = await request(app.getHttpServer())
      .post("/api/v1/payments")
      .set("x-payment-processor", "stellar")
      .send(stellarBody)
      .expect(201);

    const signed = await request(app.getHttpServer())
      .post(`/api/v1/payments/${created.body.paymentId}/sign`)
      .set("x-payment-processor", "stellar")
      .send({
        status: created.body.status,
        unsignedTransaction: created.body.unsignedTransaction,
        raw: created.body.raw,
      })
      .expect(200);

    expect(signed.body.signerAddress).toBe(signingKp.publicKey());

    const submitted = await request(app.getHttpServer())
      .post(`/api/v1/payments/${created.body.paymentId}/submit`)
      .set("x-payment-processor", "stellar")
      .send({ signedPayload: signed.body.signedPayload })
      .expect(200);

    expect(submitted.body.transactionHash).toBe("STELLAR_TX");
    expect(submitted.body.status).toBe("CONFIRMED");
  });

  it("disabling one processor does not affect the other", async () => {
    // Disable grantfox via the admin endpoint.
    await request(app.getHttpServer())
      .post("/api/v1/payments/processors/grantfox/disable")
      .expect(200);

    // Grantfox now refuses (409 Conflict) …
    await request(app.getHttpServer())
      .post("/api/v1/payments")
      .set("x-payment-processor", "grantfox")
      .send(grantfoxBody)
      .expect(409);

    // … while stellar keeps working.
    await request(app.getHttpServer())
      .post("/api/v1/payments")
      .set("x-payment-processor", "stellar")
      .send(stellarBody)
      .expect(201);

    // Re-enable for isolation from other tests.
    await request(app.getHttpServer())
      .post("/api/v1/payments/processors/grantfox/enable")
      .expect(200);
  });

  it("rejects an unknown processor selector with 400", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/payments")
      .set("x-payment-processor", "paypal")
      .send(stellarBody)
      .expect(400);
  });

  it("rejects a payload that violates the DTO with 400", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/payments")
      .set("x-payment-processor", "stellar")
      .send({ amount: "not-a-number", currency: "XLM", destination: "x" })
      .expect(400);
  });
});
