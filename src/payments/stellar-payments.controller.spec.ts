import { HttpService } from "@nestjs/axios";
import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import {
  Account,
  Keypair,
  Networks,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { of } from "rxjs";
import request from "supertest";
import { JwtAuthGuard } from "src/core/auth/jwt.guard";
import { RolesGuard } from "src/common/guard/roles.guard";
import { createGlobalValidationPipe } from "src/common/pipes/validation.pipe";
import { STELLAR_HORIZON_SERVER } from "./adapters/stellar/stellar.constants";
import { PaymentsModule } from "./payments.module";

/**
 * Covers the `/payments/stellar/*` convenience routes. The env default
 * processor is deliberately set to **grantfox** so every passing assertion
 * proves the routes pin to Stellar regardless of the default — and, for
 * `submit`/`status`, that the static Stellar paths win over the generic
 * dynamic `payments/:id/*` routes (the registration-order precedence).
 *
 * Both network clients are in-memory fakes: Stellar submit/status resolve to
 * hash "STELLAR_TX"; the Grantfox fake resolves to "GF_TX". So a Stellar result
 * on a Stellar route is unambiguous.
 */
describe("Stellar payments convenience routes", () => {
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
  };

  // Grantfox fake — if any Stellar route ever fell through to the generic
  // handler under the grantfox env default, these "GF_*" values would surface.
  const httpService = {
    post: jest.fn(() => of({ data: { id: "GF_PAY", status: "processing" } })),
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
              // Default is grantfox on purpose — the Stellar routes must ignore it.
              PAYMENTS_DEFAULT_PROCESSOR: "grantfox",
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

  const createBody = {
    amount: "10",
    currency: "XLM",
    destination: destKp.publicKey(),
    source: payerKp.publicKey(),
    idempotencyKey: "idem-stellar-alias",
  };

  const create = () =>
    request(app.getHttpServer())
      .post("/api/v1/payments/stellar/create")
      .send(createBody);

  it("POST /create pins Stellar even under a grantfox env default", async () => {
    const res = await create().expect(201);

    // Stellar returns an unsigned XDR + PENDING; Grantfox would be PROCESSING
    // with no unsignedTransaction.
    expect(res.body.status).toBe("PENDING");
    expect(typeof res.body.unsignedTransaction).toBe("string");
  });

  it("POST /submit signs server-side and submits an unsigned XDR", async () => {
    const created = (await create().expect(201)).body;

    const res = await request(app.getHttpServer())
      .post("/api/v1/payments/stellar/submit")
      .send({
        paymentId: created.paymentId,
        unsignedTransaction: created.unsignedTransaction,
      })
      .expect(200);

    expect(res.body.transactionHash).toBe("STELLAR_TX");
    expect(res.body.status).toBe("CONFIRMED");
  });

  it("POST /submit accepts a client-signed payload and submits it as-is", async () => {
    const created = (await create().expect(201)).body;

    const signedPayload = TransactionBuilder.fromXdr(
      created.unsignedTransaction,
      Networks.TESTNET,
    );
    signedPayload.sign(signingKp);

    const res = await request(app.getHttpServer())
      .post("/api/v1/payments/stellar/submit")
      .send({
        paymentId: created.paymentId,
        signedPayload: signedPayload.toXdr(),
      })
      .expect(200);

    expect(res.body.transactionHash).toBe("STELLAR_TX");
    expect(res.body.status).toBe("CONFIRMED");
  });

  it("POST /submit with neither payload is a 400", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/payments/stellar/submit")
      .send({ paymentId: "some-id" })
      .expect(400);
  });

  it("GET /status?id= wins over the generic :id/status route (precedence)", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/payments/stellar/status")
      .query({ id: "STELLAR_TX" })
      .expect(200);

    // If this had fallen through to `payments/:id/status` (id="stellar"), the
    // grantfox env default would have produced "GF_TX".
    expect(res.body.transactionHash).toBe("STELLAR_TX");
    expect(res.body.status).toBe("CONFIRMED");
  });

  it("GET /status without an id is a 400", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/payments/stellar/status")
      .expect(400);
  });

  it("still routes the generic :id/status for non-'stellar' ids", async () => {
    // "STELLAR_TX" ≠ "stellar", so this matches the dynamic route; forcing the
    // stellar processor keeps the assertion about routing, not selection.
    const res = await request(app.getHttpServer())
      .get("/api/v1/payments/STELLAR_TX/status")
      .set("x-payment-processor", "stellar")
      .expect(200);

    expect(res.body.transactionHash).toBe("STELLAR_TX");
  });

  it("rejects a payload that violates the DTO with 400", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/payments/stellar/create")
      .send({ amount: "not-a-number", currency: "XLM", destination: "x" })
      .expect(400);
  });
});
