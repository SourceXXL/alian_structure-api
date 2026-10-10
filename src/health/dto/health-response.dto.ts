import { ApiProperty } from "@nestjs/swagger";

export enum ComponentStatus {
  UP = "up",
  DOWN = "down",
  DEGRADED = "degraded",
  UNKNOWN = "unknown",
}

export enum HealthStatus {
  OK = "ok",
  DEGRADED = "degraded",
  ERROR = "error",
}

export class ComponentStatusDto {
  @ApiProperty({
    enum: ComponentStatus,
    enumName: "ComponentStatus",
    example: ComponentStatus.UP,
    description: "Component availability status: up, down, degraded, or unknown",
  })
  status: ComponentStatus | "up" | "down" | "degraded" | "unknown";

  @ApiProperty({
    required: false,
    example: 5,
    description: "Response time in milliseconds",
  })
  responseTime?: number;

  @ApiProperty({ required: false, example: "Connection refused" })
  message?: string;
}

export class HealthResponseDto {
  @ApiProperty({
    enum: HealthStatus,
    enumName: "HealthStatus",
    example: HealthStatus.OK,
    description:
      "ok = all components up; degraded = some up; error = all critical components down",
  })
  status: HealthStatus | "ok" | "degraded" | "error";

  @ApiProperty({ example: "2024-01-01T00:00:00.000Z", description: "ISO 8601 evaluation timestamp" })
  timestamp: string;

  @ApiProperty({ example: 123.456, description: "Process uptime in seconds" })
  uptime: number;

  @ApiProperty({
    type: "object",
    additionalProperties: { $ref: "#/components/schemas/ComponentStatusDto" },
    example: {
      database: { status: "up", responseTime: 5 },
      redis: { status: "up", responseTime: 2 },
    },
    description: "Map of component health details keyed by subsystem identifier",
  })
  components: Record<string, ComponentStatusDto>;
}