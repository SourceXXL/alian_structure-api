import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { ConfigService } from "@nestjs/config";

export function setupSwagger(app: INestApplication): void {
  const configService = app.get(ConfigService);
  const port = Number(process.env.PORT || configService.get("PORT", 3001));

  const config = new DocumentBuilder()
    .setTitle("alian-structure Backend API")
    .setDescription(
      "Comprehensive API documentation for alian-structure backend services including agent management, oracle submissions, compute operations, and audit trails",
    )
    .setVersion("1.0.0")
    .setContact(
      "alian-structure Team",
      "https://alian-structure.com",
      "api@alian-structure.com",
    )
    .setLicense("Apache 2.0", "https://www.apache.org/licenses/LICENSE-2.0")
    .addServer(`http://localhost:${port}`, "Development Server")
    .addServer("https://api.alian-structure.com", "Production Server")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        name: "JWT",
        description: "Enter JWT token",
        in: "header",
      },
      "JWT-auth",
    )
    .addApiKey(
      {
        type: "apiKey",
        name: "X-API-Key",
        in: "header",
        description: "API key for service-to-service communication",
      },
      "api-key",
    )
    .addTag(
      "Health",
      "Liveness, readiness, and startup probes for Kubernetes orchestration",
    )
    .addTag("Authentication", "User authentication and authorization")
    .addTag("Users", "User management operations")
    .addTag("Oracle", "Oracle data submissions")
    .addTag("Audit", "Audit trail and logging")
    .addTag("Profile", "User profile management")
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    deepScanRoutes: true,
    operationIdFactory: (controllerKey: string, methodKey: string) => methodKey,
  });

  SwaggerModule.setup("api/docs", app, document, {
    customSiteTitle: "alian-structure API Documentation",
    customfavIcon: "/favicon.ico",
    customCss: `
      .topbar-wrapper img { content: url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTAiIGhlaWdodD0iNTAiIHZpZXdCb3g9IjAgMCA1MCA1MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjUwIiBoZWlnaHQ9IjUwIiByeD0iMTAiIGZpbGw9IiM0Mjg1RjQiLz4KPHN2ZyB3aWR0aD0iMzAiIGhlaWdodD0iMzAiIHZpZXdCb3g9IjAgMCAzMCAzMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIiB4PSIxMCIgeT0iMTAiPgo8Y2lyY2xlIGN4PSIxNSIgY3k9IjE1IiByPSI4IiBmaWxsPSJ3aGl0ZSIvPgo8L3N2Zz4KPC9zdmc+'); }
      .swagger-ui .topbar { background-color: #4285F4; }
      .swagger-ui .topbar-wrapper .link { color: white; }
    `,
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      docExpansion: "none",
      defaultModelsExpandDepth: 2,
      defaultModelExpandDepth: 2,
      tryItOutEnabled: true,
    },
  });
}
