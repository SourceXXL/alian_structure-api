import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";
import { getRepositoryToken } from "@nestjs/typeorm";
import {
  Alert,
  AlertType,
  AlertCondition,
} from "src/growth/alerts/entities/alert.entity";
import { AlertTriggerLog } from "src/growth/alerts/entities/alert-trigger-log.entity";
import {
  AlertPreference,
  AlertFrequency,
} from "src/growth/alerts/entities/alert-preference.entity";
import { AlertsController } from "src/growth/alerts/alerts.controller";
import { AlertsService } from "src/growth/alerts/alerts.service";
import { JwtAuthGuard } from "src/core/auth/jwt.guard";

describe("Alert Preferences (e2e)", () => {
  let app: INestApplication;
  const alerts = new Map<string, Alert>();
  const logs = new Map<string, AlertTriggerLog>();
  const preferences = new Map<string, AlertPreference>();
  let alertSequence = 0;
  let logSequence = 0;

  const matches = <T extends object>(record: T, where: Partial<T>): boolean =>
    Object.entries(where).every(
      ([key, value]) => record[key as keyof T] === value,
    );

  const alertRepository = {
    create: (value: Partial<Alert>) => value as Alert,
    save: async (value: Alert) => {
      const now = new Date();
      const saved = {
        ...value,
        id: value.id ?? `alert-${++alertSequence}`,
        createdAt: value.createdAt ?? now,
        updatedAt: now,
      } as Alert;
      alerts.set(saved.id, saved);
      return saved;
    },
    find: async ({ where }: { where: Partial<Alert> }) =>
      [...alerts.values()].filter((alert) => matches(alert, where)),
    findOne: async ({ where }: { where: Partial<Alert> }) =>
      [...alerts.values()].find((alert) => matches(alert, where)) ?? null,
  };

  const logRepository = {
    create: (value: Partial<AlertTriggerLog>) => value as AlertTriggerLog,
    save: async (value: AlertTriggerLog) => {
      const saved = {
        ...value,
        id: value.id ?? `log-${++logSequence}`,
        triggeredAt: value.triggeredAt ?? new Date(),
      } as AlertTriggerLog;
      logs.set(saved.id, saved);
      return saved;
    },
    find: async ({ where }: { where: Partial<AlertTriggerLog> }) =>
      [...logs.values()].filter((log) => matches(log, where)),
  };

  const preferenceRepository = {
    create: (value: Partial<AlertPreference>) => value as AlertPreference,
    save: async (value: AlertPreference) => {
      const now = new Date();
      const saved = {
        ...value,
        id: value.id ?? `preference-${preferences.size + 1}`,
        createdAt: value.createdAt ?? now,
        updatedAt: now,
      } as AlertPreference;
      preferences.set(saved.userId, saved);
      return saved;
    },
    findOne: async ({ where }: { where: Partial<AlertPreference> }) =>
      [...preferences.values()].find((preference) =>
        matches(preference, where),
      ) ?? null,
    remove: async (value: AlertPreference) => {
      preferences.delete(value.userId);
      return value;
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AlertsController],
      providers: [
        AlertsService,
        { provide: getRepositoryToken(Alert), useValue: alertRepository },
        {
          provide: getRepositoryToken(AlertTriggerLog),
          useValue: logRepository,
        },
        {
          provide: getRepositoryToken(AlertPreference),
          useValue: preferenceRepository,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const testUserId = "e2e-user-001";

  describe("POST /api/alerts/subscribe", () => {
    it("should create alert preferences with frequency and disabledAlertTypes", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/alerts/subscribe")
        .send({
          userId: testUserId,
          channels: ["in-app", "email", "push"],
          quietHoursStart: 22,
          quietHoursEnd: 8,
          rateLimit: 15,
          frequency: AlertFrequency.DAILY_DIGEST,
          disabledAlertTypes: ["liquidation"],
        })
        .expect(201);

      expect(res.body.userId).toBe(testUserId);
      expect(res.body.channels).toContain("push");
      expect(res.body.frequency).toBe(AlertFrequency.DAILY_DIGEST);
      expect(res.body.disabledAlertTypes).toContain("liquidation");
    });

    it("should update existing preferences", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/alerts/subscribe")
        .send({
          userId: testUserId,
          channels: ["websocket"],
          frequency: AlertFrequency.REALTIME,
        })
        .expect(201);

      expect(res.body.channels).toEqual(["websocket"]);
      expect(res.body.frequency).toBe(AlertFrequency.REALTIME);
    });
  });

  describe("GET /api/alerts/preferences/:userId", () => {
    it("should return saved preferences", async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/alerts/preferences/${testUserId}`)
        .expect(200);

      expect(res.body.userId).toBe(testUserId);
    });
  });

  describe("POST /api/alerts/price", () => {
    it("should create a price alert", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/alerts/price")
        .send({
          userId: testUserId,
          asset: "BTC",
          condition: AlertCondition.ABOVE,
          threshold: 50000,
        })
        .expect(201);

      expect(res.body.type).toBe(AlertType.PRICE);
      expect(res.body.asset).toBe("BTC");
    });
  });

  describe("POST /api/alerts/allocation-drift", () => {
    it("should create an allocation drift alert", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/alerts/allocation-drift")
        .send({
          userId: testUserId,
          asset: "ETH",
          threshold: 10,
        })
        .expect(201);

      expect(res.body.type).toBe(AlertType.ALLOCATION_DRIFT);
    });
  });

  describe("POST /api/alerts/milestone", () => {
    it("should create a milestone alert", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/alerts/milestone")
        .send({
          userId: testUserId,
          threshold: 100000,
          condition: AlertCondition.ABOVE,
        })
        .expect(201);

      expect(res.body.type).toBe(AlertType.MILESTONE);
    });
  });

  describe("POST /api/alerts/performance", () => {
    it("should create a performance alert", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/alerts/performance")
        .send({
          userId: testUserId,
          threshold: 5,
          condition: AlertCondition.BELOW,
        })
        .expect(201);

      expect(res.body.type).toBe(AlertType.PERFORMANCE);
    });
  });

  describe("GET /api/alerts", () => {
    it("should return all active alerts for user", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/alerts")
        .query({ userId: testUserId })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("GET /api/alerts/history", () => {
    it("should return alert history", async () => {
      const res = await request(app.getHttpServer())
        .get("/api/alerts/history")
        .query({ userId: testUserId })
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("PATCH /api/alerts/:alertId/toggle", () => {
    it("should disable an alert", async () => {
      // First get alerts
      const alerts = await request(app.getHttpServer())
        .get("/api/alerts")
        .query({ userId: testUserId });

      if (alerts.body.length > 0) {
        const alertId = alerts.body[0].id;
        const res = await request(app.getHttpServer())
          .patch(`/api/alerts/${alertId}/toggle`)
          .send({ active: false })
          .expect(200);

        expect(res.body.active).toBe(false);
      }
    });
  });

  describe("DELETE /api/alerts/:alertId", () => {
    it("should deactivate an alert", async () => {
      const alerts = await request(app.getHttpServer())
        .get("/api/alerts")
        .query({ userId: testUserId });

      if (alerts.body.length > 0) {
        const alertId = alerts.body[alerts.body.length - 1].id;
        await request(app.getHttpServer())
          .delete(`/api/alerts/${alertId}`)
          .expect(200);
      }
    });
  });

  describe("DELETE /api/alerts/unsubscribe/:userId", () => {
    it("should remove alert preferences", async () => {
      await request(app.getHttpServer())
        .delete(`/api/alerts/unsubscribe/${testUserId}`)
        .expect(200);

      // Verify removed
      await request(app.getHttpServer())
        .get(`/api/alerts/preferences/${testUserId}`)
        .expect(200)
        .then((res) => {
          expect(res.text).toBe("");
        });
    });
  });
});
