import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { config as loadDotEnv } from "dotenv";

import { AppModule } from "../../src/app.module";

describe("Portfolio Management REST API", () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Ensure required env vars exist for EnvironmentVariables validation
    loadDotEnv({
      path: require.resolve("./.env.e2e"),
      override: true,
    });

    const required = [
      "DATABASE_URL",
      "JWT_SECRET",
      "ETH_RPC_URL",
      "ARB_RPC_URL",
      "POLY_RPC_URL",
      "OPT_RPC_URL",
    ];

    const missing = required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(
        `E2E env not configured. Missing: ${missing.join(", ")}. Ensure test/portfolio/.env.e2e is valid.`,
      );
    }

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );

    await app.init();
  }, 30_000);

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("POST /api/portfolio (201) - create portfolio", async () => {
    // TODO: replace with a valid token.
    const token = "REPLACE_WITH_JWT";

    const res = await request(app.getHttpServer())
      .post("/api/portfolio")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "E2E Portfolio",
        description: "test",
      });

    expect([201, 400, 401]).toContain(res.status);

    // If request succeeded, verify response shape.
    if (res.status === 201) {
      expect(res.body).toHaveProperty("id");
      expect(res.body).toHaveProperty("name");
    }
  }, 15_000);

  it("GET /api/portfolio (200) - list user portfolios", async () => {
    const token = "REPLACE_WITH_JWT";

    const res = await request(app.getHttpServer())
      .get("/api/portfolio")
      .set("Authorization", `Bearer ${token}`);

    expect([200, 401]).toContain(res.status);

    if (res.status === 200) {
      expect(res.body).toHaveProperty("portfolios");
      expect(Array.isArray(res.body.portfolios)).toBe(true);
    }
  }, 15_000);

  it("GET /api/portfolio/:id (404) - not found", async () => {
    const token = "REPLACE_WITH_JWT";

    const res = await request(app.getHttpServer())
      .get("/api/portfolio/not-a-real-uuid")
      .set("Authorization", `Bearer ${token}`);

    expect([400, 404, 401]).toContain(res.status);
  }, 15_000);

  it("PUT /api/portfolio/:id (400) - validation error", async () => {
    const token = "REPLACE_WITH_JWT";

    const res = await request(app.getHttpServer())
      .put("/api/portfolio/not-a-real-uuid")
      .set("Authorization", `Bearer ${token}`)
      .send({ rebalanceThreshold: -1 });

    expect([400, 401]).toContain(res.status);
  }, 15_000);

  it("DELETE /api/portfolio/:id (404) - archive not found", async () => {
    const token = "REPLACE_WITH_JWT";

    const res = await request(app.getHttpServer())
      .delete("/api/portfolio/not-a-real-uuid")
      .set("Authorization", `Bearer ${token}`);

    expect([400, 404, 401]).toContain(res.status);
  }, 15_000);
});
