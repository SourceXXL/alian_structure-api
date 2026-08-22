import { BadRequestException, Injectable } from "@nestjs/common";
import { Repository, SelectQueryBuilder } from "typeorm";
import { CursorOptions, PaginationResult } from "./cursor-pagination.dto";

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 512;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface EncodedCursor {
  v: typeof CURSOR_VERSION;
  createdAt: string;
  id: string;
}

export interface CursorPosition {
  createdAt: Date;
  id: string;
}

/**
 * Encodes and applies opaque, versioned keyset cursors ordered by
 * `(createdAt, id)`. The ID is the deterministic tiebreaker when timestamps
 * are equal, preventing records from being duplicated or skipped.
 */
@Injectable()
export class CursorPaginationService {
  encode(position: CursorPosition): string {
    this.assertPosition(position);
    const payload: EncodedCursor = {
      v: CURSOR_VERSION,
      createdAt: position.createdAt.toISOString(),
      id: position.id,
    };

    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  }

  decode(cursor: string): CursorPosition {
    try {
      if (
        !cursor ||
        cursor.length > MAX_CURSOR_LENGTH ||
        !/^[A-Za-z0-9_-]+$/.test(cursor)
      ) {
        throw new Error("Malformed cursor encoding");
      }

      const decoded = Buffer.from(cursor, "base64url").toString("utf8");
      if (Buffer.from(decoded, "utf8").toString("base64url") !== cursor) {
        throw new Error("Non-canonical cursor encoding");
      }

      const payload = JSON.parse(decoded) as Partial<EncodedCursor>;
      if (
        payload.v !== CURSOR_VERSION ||
        typeof payload.createdAt !== "string" ||
        typeof payload.id !== "string"
      ) {
        throw new Error("Unsupported cursor payload");
      }

      const position = {
        createdAt: new Date(payload.createdAt),
        id: payload.id,
      };
      this.assertPosition(position);
      if (position.createdAt.toISOString() !== payload.createdAt) {
        throw new Error("Non-canonical cursor timestamp");
      }
      return position;
    } catch {
      throw new BadRequestException("Invalid pagination cursor");
    }
  }

  applyDescendingKeyset<T>(
    queryBuilder: SelectQueryBuilder<T>,
    alias: string,
    cursor?: string,
  ): SelectQueryBuilder<T> {
    queryBuilder
      .orderBy(`${alias}.createdAt`, "DESC")
      .addOrderBy(`${alias}.id`, "DESC");

    if (cursor) {
      const position = this.decode(cursor);
      queryBuilder.andWhere(
        `(${alias}.createdAt < :cursorCreatedAt OR ` +
          `(${alias}.createdAt = :cursorCreatedAt AND ${alias}.id < :cursorId))`,
        {
          cursorCreatedAt: position.createdAt,
          cursorId: position.id,
        },
      );
    }

    return queryBuilder;
  }

  /** @deprecated Prefer a domain-specific composite keyset helper. */
  createCursorQuery<T>(
    queryBuilder: SelectQueryBuilder<T>,
    options: CursorOptions,
  ): SelectQueryBuilder<T> {
    const { cursor, limit, direction, orderBy, orderDirection } = options;
    queryBuilder.orderBy(`${queryBuilder.alias}.${orderBy}`, orderDirection);

    if (cursor) {
      queryBuilder.andWhere(
        `${queryBuilder.alias}.${orderBy} ${this.getCursorOperator(
          direction,
          orderDirection,
        )} :cursor`,
        { cursor: this.decodeLegacyCursor(cursor) },
      );
    }

    if (orderBy !== "id") {
      queryBuilder.addOrderBy(`${queryBuilder.alias}.id`, orderDirection);
    }
    return queryBuilder.limit(limit + 1);
  }

  /** @deprecated Retained for compatibility with the existing REST utility. */
  async paginateWithCursor<T>(
    repository: Repository<T>,
    options: CursorOptions,
    additionalConditions?: (qb: SelectQueryBuilder<T>) => SelectQueryBuilder<T>,
  ): Promise<PaginationResult<T>> {
    const alias = repository.metadata.tableName;
    let queryBuilder = repository.createQueryBuilder(alias);
    if (additionalConditions) queryBuilder = additionalConditions(queryBuilder);
    queryBuilder = this.createCursorQuery(queryBuilder, options);

    const results = await queryBuilder.getMany();
    const hasMore = results.length > options.limit;
    const hasPrevious = Boolean(options.cursor);
    if (hasMore) results.pop();
    if (options.direction === "backward") results.reverse();

    return {
      data: results,
      nextCursor: hasMore
        ? this.encodeLegacyCursor(results[results.length - 1])
        : undefined,
      prevCursor: hasPrevious ? this.encodeLegacyCursor(results[0]) : undefined,
      hasMore,
      hasPrevious,
    };
  }

  /** @deprecated Retained for callers of the original generic API. */
  createCursorFromValue(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString("base64");
  }

  /** @deprecated Retained for callers of the original generic API. */
  validateCursor(cursor: string): boolean {
    try {
      if (!cursor) return false;
      JSON.parse(Buffer.from(cursor, "base64").toString());
      return true;
    } catch {
      return false;
    }
  }

  private assertPosition(position: CursorPosition): void {
    if (
      !(position.createdAt instanceof Date) ||
      Number.isNaN(position.createdAt.getTime()) ||
      !UUID_PATTERN.test(position.id)
    ) {
      throw new BadRequestException("Invalid pagination cursor");
    }
  }

  private encodeLegacyCursor(item: unknown): string {
    if (!item) return "";
    const record = item as Record<string, unknown>;
    return Buffer.from(
      JSON.stringify({
        id: record.id,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }),
    ).toString("base64");
  }

  private decodeLegacyCursor(cursor: string): unknown {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, "base64").toString());
      return decoded.createdAt || decoded.id;
    } catch {
      throw new Error("Invalid cursor format");
    }
  }

  private getCursorOperator(
    direction: "forward" | "backward",
    orderDirection: "ASC" | "DESC",
  ): string {
    if (direction === "forward") return orderDirection === "ASC" ? ">" : "<";
    return orderDirection === "ASC" ? "<" : ">";
  }
}
