import "dotenv/config";
import { join } from "path";
import { DataSource, DataSourceOptions } from "typeorm";

const databaseUrl = process.env.DATABASE_URL;
const isProduction = process.env.NODE_ENV === "production";
const sourceRoot = join(__dirname, "..");

const options: DataSourceOptions = {
  type: "postgres",
  ...(databaseUrl
    ? { url: databaseUrl }
    : {
        host: process.env.DB_HOST ?? "localhost",
        port: Number(process.env.DB_PORT ?? 5432),
        username: process.env.DB_USERNAME ?? "postgres",
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME ?? "swaptrade",
      }),
  entities: [join(sourceRoot, "**", "*.entity.{ts,js}")],
  migrations: [
    join(sourceRoot, "migrations", "*.{ts,js}"),
    join(sourceRoot, "**", "migration", "*.{ts,js}"),
  ],
  synchronize: false,
  logging: process.env.TYPEORM_LOGGING === "true",
  ssl: isProduction ? { rejectUnauthorized: false } : false,
};

export default new DataSource(options);
