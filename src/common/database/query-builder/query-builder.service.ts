import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { DataSource } from "typeorm";
import { FindOptions } from "../repositories/base.repository";
import { BaseEntity } from "typeorm";

type SortOrder = "ASC" | "DESC";

export interface QueryBuilderOptions<T> {
  select?: (keyof T)[];
  where?: Partial<T>;
  filters?: Array<{
    field: keyof T;
    operator:
      | "="
      | "!="
      | ">"
      | "<"
      | ">="
      | "<="
      | "IN"
      | "LIKE"
      | "IS NULL"
      | "IS NOT NULL";
    value?: any;
  }>;
  orderBy?: { field: keyof T; direction: SortOrder };
  groupBy?: (keyof T)[];
  having?: { field: keyof T; operator: string; value: any };
  skip?: number;
  take?: number;
  join?: Array<{
    entity: any;
    alias: string;
    condition: string;
    type?: "INNER" | "LEFT" | "RIGHT";
  }>;
  relations?: string[];
  cache?: boolean;
  cacheId?: string;
  cacheTtl?: number;
}

@Injectable()
export class QueryBuilderService<T extends BaseEntity> {
  private readonly logger = new Logger(QueryBuilderService.name);

  constructor(private readonly dataSource: DataSource) {}

  async findAll(
    entity: any,
    options: QueryBuilderOptions<T> = {},
  ): Promise<{ data: T[]; total: number }> {
    const query = this.dataSource
      .getRepository(entity)
      .createQueryBuilder("entity");

    if (options.select?.length) {
      options.select.forEach((field) =>
        query.addSelect(`entity.${String(field)}`),
      );
    }

    if (options.where) {
      Object.entries(options.where).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query.andWhere(`entity.${key} = :${key}`, { [key]: value });
        }
      });
    }

    if (options.filters?.length) {
      options.filters.forEach((filter) => {
        const field = String(filter.field);
        const param = field.replace(/\./g, "_");
        switch (filter.operator) {
          case "=":
            query.andWhere(`entity.${field} = :${param}`, {
              [param]: filter.value,
            });
            break;
          case "LIKE":
            query.andWhere(`entity.${field} LIKE :${param}`, {
              [param]: `%${filter.value}%`,
            });
            break;
          case "IN":
            query.andWhere(`entity.${field} IN (:...${param})`, {
              [param]: filter.value,
            });
            break;
          case "IS NULL":
            query.andWhere(`entity.${field} IS NULL`);
            break;
          case "IS NOT NULL":
            query.andWhere(`entity.${field} IS NOT NULL`);
            break;
          default:
            query.andWhere(`entity.${field} ${filter.operator} :${param}`, {
              [param]: filter.value,
            });
        }
      });
    }

    if (options.join?.length) {
      options.join.forEach((j) => {
        const joinType = (j.type ?? "LEFT").toLowerCase();
        query[`${joinType}Join`](j.entity, `entity.${j.alias}`, j.condition);
      });
    }

    if (options.relations?.length) {
      options.relations.forEach((relation) => {
        query.leftJoinAndSelect(`entity.${relation}`, relation);
      });
    }

    if (options.groupBy?.length) {
      options.groupBy.forEach((field) =>
        query.addGroupBy(`entity.${String(field)}`),
      );
    }

    if (options.having) {
      const param = String(options.having.field).replace(/\./g, "_");
      query.having(
        `entity.${String(options.having.field)} ${options.having.operator} :${param}`,
        {
          [param]: options.having.value,
        },
      );
    }

    if (options.orderBy) {
      query.orderBy(
        `entity.${String(options.orderBy.field)}`,
        options.orderBy.direction,
      );
    }

    if (options.skip) query.skip(options.skip);
    if (options.take) query.take(options.take);

    const [data, total] = await query.getManyAndCount();
    return { data: data as T[], total };
  }

  async findOne(
    entity: any,
    options: QueryBuilderOptions<T> = {},
  ): Promise<T | null> {
    const query = this.dataSource
      .getRepository(entity)
      .createQueryBuilder("entity");
    if (options.where) {
      Object.entries(options.where).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query.andWhere(`entity.${key} = :${key}`, { [key]: value });
        }
      });
    }
    if (options.relations?.length) {
      options.relations.forEach((relation) => {
        query.leftJoinAndSelect(`entity.${relation}`, relation);
      });
    }
    const data = await query.getOne();
    return (data as T) ?? null;
  }

  async count(
    entity: any,
    options: QueryBuilderOptions<T> = {},
  ): Promise<number> {
    const query = this.dataSource
      .getRepository(entity)
      .createQueryBuilder("entity");
    if (options.where) {
      Object.entries(options.where).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query.andWhere(`entity.${key} = :${key}`, { [key]: value });
        }
      });
    }
    if (options.filters?.length) {
      options.filters.forEach((filter) => {
        const field = String(filter.field);
        const param = field.replace(/\./g, "_");
        if (filter.operator === "IN") {
          query.andWhere(`entity.${field} IN (:...${param})`, {
            [param]: filter.value,
          });
        } else {
          query.andWhere(`entity.${field} ${filter.operator} :${param}`, {
            [param]: filter.value,
          });
        }
      });
    }
    return query.getCount();
  }

  async rawQuery(
    entity: any,
    sql: string,
    parameters: any[] = [],
  ): Promise<any[]> {
    return this.dataSource.getRepository(entity).query(sql, parameters);
  }

  async transaction<T>(callback: (queryRunner: any) => Promise<T>): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      const result = await callback(queryRunner);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
