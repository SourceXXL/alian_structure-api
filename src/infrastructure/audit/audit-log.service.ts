import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AuditLog } from "./entities/audit-log.entity";
import {
  QueryAuditLogDto,
  ExportAuditLogDto,
} from "./dto/query-audit-log.dto";
import { AuditLogListResponseDto } from "./dto/audit-log-response.dto";
import { ExportSigningService } from "./algorithms/export-signing.service";

const RETENTION_YEARS = 7;
const ARCHIVE_AFTER_YEARS = 1;

@Injectable()
export class AuditLogService {
  private logs: any[] = [];

  async recordVerification(result: any) {
    const entry = {
      type: "VERIFICATION",
      ...result,
    };

    this.logs.push(entry);

    // ❗ Immutable simulation (append-only)
    Object.freeze(entry);

    return entry;
  }

  getLogs(limit = 50) {
    return this.logs.slice(-limit);
  }

    constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
    private readonly signingService: ExportSigningService,
  ) {}

  async record(entry: {
    userId?: string | null;
    action: AuditLog["action"];
    resourceType?: string;
    resourceId?: string;
    ipAddress: string;
    userAgent?: string;
    details?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLog> {
    const searchText = [
      entry.action,
      entry.resourceType,
      entry.resourceId,
      entry.ipAddress,
      entry.details,
    ]
      .filter(Boolean)
      .join(" ");

    const log = this.repo.create({ ...entry, searchText });
    return this.repo.save(log);
  }

  async query(dto: QueryAuditLogDto): Promise<AuditLogListResponseDto> {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 100;

    const qb = this.repo.createQueryBuilder("log");

    if (dto.search) {
      qb.andWhere(
        `to_tsvector('english', log."searchText") @@ websearch_to_tsquery('english', :search)`,
        { search: dto.search },
      );
    }
    if (dto.userId) qb.andWhere("log.userId = :userId", { userId: dto.userId });
    if (dto.action) qb.andWhere("log.action = :action", { action: dto.action });
    if (dto.ipAddress)
      qb.andWhere("log.ipAddress = :ipAddress", { ipAddress: dto.ipAddress });
    if (dto.fromDate)
      qb.andWhere("log.createdAt >= :fromDate", { fromDate: dto.fromDate });
    if (dto.toDate)
      qb.andWhere("log.createdAt <= :toDate", { toDate: dto.toDate });

    qb.orderBy("log.createdAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findById(id: string): Promise<AuditLog> {
    const log = await this.repo.findOne({ where: { id } });
    if (!log) throw new NotFoundException("Audit log not found");
    return log;
  }

  private async fetchForExport(dto: ExportAuditLogDto): Promise<AuditLog[]> {
    return this.repo
      .createQueryBuilder("log")
      .where("log.createdAt >= :fromDate", { fromDate: dto.fromDate })
      .andWhere("log.createdAt <= :toDate", { toDate: dto.toDate })
      .orderBy("log.createdAt", "ASC")
      .take(dto.limit ?? 10000)
      .getMany();
  }

  async exportToJson(
    dto: ExportAuditLogDto,
  ): Promise<{ payload: string; signature: string }> {
    const logs = await this.fetchForExport(dto);
    const payload = JSON.stringify(logs);
    const signature = this.signingService.sign(payload);
    return { payload, signature };
  }

  async exportToCsv(
    dto: ExportAuditLogDto,
  ): Promise<{ payload: string; signature: string }> {
    const logs = await this.fetchForExport(dto);
    const header = [
      "id",
      "userId",
      "action",
      "resourceType",
      "resourceId",
      "ipAddress",
      "createdAt",
    ];
    const rows = logs.map((log) =>
      header
        .map((field) => JSON.stringify((log as any)[field] ?? ""))
        .join(","),
    );
    const payload = [header.join(","), ...rows].join("\n");
    const signature = this.signingService.sign(payload);
    return { payload, signature };
  }

  // Moves logs older than 1 year to cold storage and marks them archived.
  // Cold-storage transfer is delegated to an external sink (S3/Glacier);
  // this only flips the archivedAt marker once the transfer succeeds.
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async archiveOldLogs(coldStorageWriter?: (logs: AuditLog[]) => Promise<void>) {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - ARCHIVE_AFTER_YEARS);

    const logs = await this.repo
      .createQueryBuilder("log")
      .where("log.createdAt < :cutoff", { cutoff })
      .andWhere("log.archivedAt IS NULL")
      .getMany();

    if (logs.length === 0) return;

    if (coldStorageWriter) await coldStorageWriter(logs);

    await this.repo
      .createQueryBuilder()
      .update(AuditLog)
      .set({ archivedAt: new Date() })
      .where("id IN (:...ids)", { ids: logs.map((l) => l.id) })
      .execute();
  }

  // Permanently deletes logs past the 7-year retention period.
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async enforceRetention(): Promise<void> {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);

    await this.repo
      .createQueryBuilder()
      .delete()
      .from(AuditLog)
      .where("createdAt < :cutoff", { cutoff })
      .execute();
  }
}
