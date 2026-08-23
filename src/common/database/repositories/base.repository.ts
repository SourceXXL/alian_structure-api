import { DataSource, Repository } from "typeorm";

export interface IBaseRepository<T> {
  findById(id: string): Promise<T | null>;
  findAll(options?: FindOptions): Promise<T[]>;
  create(data: Partial<T>): Promise<T>;
  update(id: string, data: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
  softDelete(id: string): Promise<T | null>;
  count(filters?: Partial<T>): Promise<number>;
  exists(id: string): Promise<boolean>;
}

export interface FindOptions {
  skip?: number;
  take?: number;
  order?: Record<string, "ASC" | "DESC">;
  where?: Partial<any>;
  relations?: string[];
}

export abstract class BaseRepository<
  T extends BaseEntity,
> implements IBaseRepository<T> {
  private readonly dataSource: DataSource;
  private readonly entityClass: new () => T;

  constructor(dataSource: DataSource, entityClass: new () => T) {
    this.dataSource = dataSource;
    this.entityClass = entityClass;
  }

  protected get repository(): Repository<T> {
    return this.dataSource.getRepository(this.entityClass);
  }

  async findById(id: string): Promise<T | null> {
    return this.repository.findOne({ where: { id } as any });
  }

  async findAll(options: FindOptions = {}): Promise<T[]> {
    const { skip, take, order, where, relations } = options;
    const query = this.repository.createQueryBuilder("entity");
    if (where) {
      Object.entries(where).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          query.andWhere(`entity.${key} = :${key}`, { [key]: value });
        }
      });
    }
    if (order) {
      Object.entries(order).forEach(([field, direction]) => {
        query.orderBy(`entity.${field}`, direction);
      });
    }
    if (skip != null) query.skip(skip);
    if (take != null) query.take(take);
    if (relations?.length) {
      relations.forEach((relation) =>
        query.leftJoinAndSelect(`entity.${relation}`, relation),
      );
    }
    return query.getMany();
  }

  async create(data: Partial<T>): Promise<T> {
    const entity = this.repository.create(data as any);
    return this.repository.save(entity) as unknown as T;
  }

  async update(id: string, data: Partial<T>): Promise<T | null> {
    await this.repository.update(id, data as any);
    return this.findById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.repository.delete(id);
    return (result.affected ?? 0) > 0;
  }

  async softDelete(id: string): Promise<T | null> {
    await this.repository.softDelete(id);
    return this.findById(id);
  }

  async count(filters?: Partial<T>): Promise<number> {
    return this.repository.count({ where: filters as any });
  }

  async exists(id: string): Promise<boolean> {
    const result = await this.repository.exists({ where: { id } as any });
    return result;
  }
}

export interface BaseEntity {
  id: string;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date;
}
