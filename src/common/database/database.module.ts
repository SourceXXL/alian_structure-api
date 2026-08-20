import { DynamicModule, Module, Provider } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule, TypeOrmModuleOptions } from "@nestjs/typeorm";
import { DataSource, DataSourceOptions } from "typeorm";
import { SnakeNamingStrategy } from "./strategies/snake-naming.strategy";

export const DATABASE_CONFIG = "DATABASE_CONFIG";
export const DATABASE_DATA_SOURCE = "DATABASE_DATA_SOURCE";

export interface DatabaseModuleOptions {
  configName?: string;
}

@Module({})
export class DatabaseModule {
  static forRootAsync(options: {
    imports?: any[];
    inject?: any[];
    useFactory: (
      ...args: any[]
    ) => Promise<TypeOrmModuleOptions> | TypeOrmModuleOptions;
  }): DynamicModule {
    const dataSourceProvider: Provider = {
      provide: DATABASE_DATA_SOURCE,
      useFactory: async (configService: ConfigService) => {
        const config: TypeOrmModuleOptions =
          await options.useFactory(configService);
        const dataSource = new DataSource(config as any);
        try {
          await dataSource.initialize();
        } catch (error) {
          throw new Error(`Failed to initialize database: ${error.message}`);
        }
        return dataSource;
      },
      inject: options.inject || [],
    };

    return {
      module: DatabaseModule,
      imports: [
        ConfigModule,
        TypeOrmModule.forRootAsync({
          imports: options.imports || [],
          inject: options.inject || [],
          useFactory: options.useFactory,
        }),
      ],
      providers: [dataSourceProvider],
      exports: [DATABASE_DATA_SOURCE, TypeOrmModule],
    };
  }

  static forFeature(options: {
    entities?: any[];
    imports?: any[];
  }): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [
        ...(options.imports || []),
        TypeOrmModule.forFeature(options.entities || []),
      ],
      exports: [TypeOrmModule],
    };
  }
}
