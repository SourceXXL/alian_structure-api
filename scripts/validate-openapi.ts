/**
 * OpenAPI Specification Validation Script
 *
 * Validates the generated OpenAPI specification for completeness and consistency.
 *
 * Usage:
 *   npm run openapi:validate
 */

import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule, OpenAPIObject } from "@nestjs/swagger";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { AppModule } from "../src/app.module";

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    endpoints: number;
    schemas: number;
    tags: number;
    securitySchemes: number;
  };
}

async function validateOpenAPI(): Promise<ValidationResult> {
  const result: ValidationResult = {
    valid: true,
    errors: [],
    warnings: [],
    stats: {
      endpoints: 0,
      schemas: 0,
      tags: 0,
      securitySchemes: 0,
    },
  };

  try {
    const specPath = join(__dirname, "..", "docs", "openapi.json");

    if (!existsSync(specPath)) {
      console.log("📝 Generating OpenAPI spec first...");
      await generateOpenAPISpec();
    }

    const specContent = readFileSync(specPath, "utf-8");
    const spec: OpenAPIObject = JSON.parse(specContent);

    console.log("\n🔍 Validating OpenAPI Specification\n");

    if (!spec.openapi) {
      result.errors.push("Missing openapi version");
    }
    if (!spec.info) {
      result.errors.push("Missing info object");
    }
    if (!spec.paths) {
      result.errors.push("Missing paths object");
    }

    result.stats.endpoints = Object.keys(spec.paths || {}).length;
    result.stats.schemas = Object.keys(spec.components?.schemas || {}).length;
    result.stats.tags = spec.tags?.length || 0;
    result.stats.securitySchemes = Object.keys(
      spec.components?.securitySchemes || {},
    ).length;

    const requiredTags = ["Health", "Authentication", "Users", "Oracle"];
    const existingTags = (spec.tags || []).map((t: any) => t.name);

    for (const tag of requiredTags) {
      if (!existingTags.includes(tag)) {
        result.warnings.push(`Missing recommended tag: ${tag}`);
      }
    }

    const securitySchemes = spec.components?.securitySchemes || {};
    if (!securitySchemes["JWT-auth"]) {
      result.warnings.push("Missing JWT security scheme (JWT-auth)");
    }
    if (!securitySchemes["api-key"]) {
      result.warnings.push("Missing API key security scheme");
    }

    if (!spec.servers || spec.servers.length === 0) {
      result.warnings.push("No servers defined in spec");
    }

    let undocumentedEndpoints = 0;

    for (const [path, pathItem] of Object.entries(spec.paths || {})) {
      for (const [method, operation] of Object.entries(pathItem as any)) {
        if (
          ["get", "post", "put", "delete", "patch", "options"].includes(method)
        ) {
          if (!operation.summary) {
            undocumentedEndpoints++;
          }

          if (!operation.responses) {
            result.warnings.push(
              `Missing responses for ${method.toUpperCase()} ${path}`,
            );
          }
        }
      }
    }

    if (undocumentedEndpoints > 0) {
      result.warnings.push(
        `${undocumentedEndpoints} endpoints missing summary documentation`,
      );
    }

    console.log("📊 Specification Statistics:");
    console.log(`   Endpoints:        ${result.stats.endpoints}`);
    console.log(`   Schemas:          ${result.stats.schemas}`);
    console.log(`   Tags:             ${result.stats.tags}`);
    console.log(`   Security Schemes: ${result.stats.securitySchemes}`);

    if (result.errors.length > 0) {
      console.log("\n❌ Validation Errors:");
      result.errors.forEach((err) => console.log(`   - ${err}`));
      result.valid = false;
    }

    if (result.warnings.length > 0) {
      console.log("\n⚠️  Validation Warnings:");
      result.warnings.forEach((warn) => console.log(`   - ${warn}`));
    }

    if (result.valid && result.errors.length === 0) {
      console.log("\n✅ OpenAPI specification is valid and complete!");
    }

    return result;
  } catch (error) {
    result.errors.push(`Validation error: ${(error as Error).message}`);
    result.valid = false;
    return result;
  }
}

async function generateOpenAPISpec(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });

  const config = new DocumentBuilder()
    .setTitle("alian-structure Backend API")
    .setDescription(
      "Comprehensive API documentation for alian-structure backend services",
    )
    .setVersion("1.0.0")
    .setContact("alian-structure Team", "https://alian-structure.com")
    .setLicense("Apache 2.0")
    .addServer("http://localhost:3001", "Development Server")
    .addServer("https://api.alian-structure.com", "Production Server")
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
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
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    deepScanRoutes: true,
  });

  const { writeFileSync, mkdirSync } = await import("fs");
  const { join } = await import("path");

  const outDir = join(__dirname, "..", "docs");
  mkdirSync(outDir, { recursive: true });

  writeFileSync(
    join(outDir, "openapi.json"),
    JSON.stringify(document, null, 2),
    "utf-8",
  );

  await app.close();
}

async function main(): Promise<void> {
  try {
    const result = await validateOpenAPI();

    if (!result.valid) {
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error("Validation script error:", error);
    process.exit(1);
  }
}

main();

export { validateOpenAPI, ValidationResult };
