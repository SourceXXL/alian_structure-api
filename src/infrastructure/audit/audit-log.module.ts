import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ScheduleModule } from "@nestjs/schedule";
import { AuditLog } from "./entities/audit-log.entity";
import { AuditLogService } from "./audit-log.service";
import { AuditLogController } from "./audit-log.controller";
import { ExportSigningService } from "./algorithms/export-signing.service";

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), ScheduleModule.forRoot()],
  controllers: [AuditLogController],
  providers: [AuditLogService, ExportSigningService],
  exports: [AuditLogService],
})
export class AuditLogModule {}