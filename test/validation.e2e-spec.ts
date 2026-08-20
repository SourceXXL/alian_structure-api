import { Test, TestingModule } from "@nestjs/testing";
import {
  INestApplication,
  Controller,
  Post,
  Body,
  HttpCode,
} from "@nestjs/common";
import request from "supertest";
import {
  IsString,
  IsInt,
  Min,
  IsOptional,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { SanitizePipe } from "../src/common/pipes/sanitize.pipe";
import { createGlobalValidationPipe } from "../src/common/pipes/validation.pipe";
import { IsRfcEmail } from "../src/common/decorators/is-rfc-email.decorator";

class TestAddressDto {
  @IsString()
  street!: string;

  @IsString()
  city!: string;
}

class TestUserDto {
  @IsString()
  username!: string;

  @IsRfcEmail()
  email!: string;

  @IsInt()
  @Min(18)
  age!: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => TestAddressDto)
  address?: TestAddressDto;
}

@Controller("test-validation")
class TestValidationController {
  @Post()
  @HttpCode(200)
  createUser(@Body() dto: TestUserDto) {
    return { success: true, data: dto };
  }
}

describe("Validation & Sanitization Pipeline (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TestValidationController],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new SanitizePipe(), createGlobalValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("should accept valid payload and trim/sanitize string fields", async () => {
    const response = await request(app.getHttpServer())
      .post("/test-validation")
      .send({
        username: "  alice_smith  ",
        email: "alice@example.com",
        age: 25,
        address: {
          street: "  123 Main St  ",
          city: "Metropolis",
        },
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.username).toBe("alice_smith");
    expect(response.body.data.email).toBe("alice@example.com");
    expect(response.body.data.address.street).toBe("123 Main St");
  });

  it("should sanitize XSS script tags in string fields before controller execution", async () => {
    const response = await request(app.getHttpServer())
      .post("/test-validation")
      .send({
        username: "<script>alert('xss')</script>   bob   ",
        email: "bob@example.com",
        age: 30,
      })
      .expect(200);

    expect(response.body.data.username).not.toContain("<script>");
    expect(response.body.data.username).toBe("bob");
  });

  it("should return 400 Bad Request with structured errors for malformed RFC email", async () => {
    const response = await request(app.getHttpServer())
      .post("/test-validation")
      .send({
        username: "charlie",
        email: "invalid-email-syntax",
        age: 22,
      })
      .expect(400);

    expect(response.body.statusCode).toBe(400);
    expect(response.body.error).toBe("Bad Request");
    expect(response.body.errors).toBeDefined();
    const emailErr = response.body.errors.find((e: any) => e.field === "email");
    expect(emailErr).toBeDefined();
  });

  it("should return 400 Bad Request when non-whitelisted property is included", async () => {
    const response = await request(app.getHttpServer())
      .post("/test-validation")
      .send({
        username: "david",
        email: "david@example.com",
        age: 28,
        maliciousExtraProperty: "injectedValue",
      })
      .expect(400);

    expect(response.body.statusCode).toBe(400);
  });

  it("should return 400 Bad Request for failed nested object validation (@ValidateNested)", async () => {
    const response = await request(app.getHttpServer())
      .post("/test-validation")
      .send({
        username: "eve",
        email: "eve@example.com",
        age: 24,
        address: {
          street: 99999, // Should be string
          city: "Gotham",
        },
      })
      .expect(400);

    expect(response.body.statusCode).toBe(400);
    const addressErr = response.body.errors.find(
      (e: any) => e.field === "address",
    );
    expect(addressErr).toBeDefined();
    expect(addressErr.children).toBeDefined();
  });
});
