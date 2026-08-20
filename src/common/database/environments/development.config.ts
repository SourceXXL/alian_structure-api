export default {
  type: "postgres",
  host: process.env.DB_HOST ?? "localhost",
  port: parseInt(process.env.DB_PORT ?? "5432", 10),
  username: process.env.DB_USERNAME ?? "postgres",
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE ?? "alianStructure",
  pool: {
    max: parseInt(process.env.DB_POOL_MAX ?? "20", 10),
    min: parseInt(process.env.DB_POOL_MIN ?? "5", 10),
    idleTimeoutMillis: parseInt(
      process.env.DB_POOL_IDLE_TIMEOUT ?? "30000",
      10,
    ),
    connectionTimeoutMillis: parseInt(
      process.env.DB_POOL_CONNECTION_TIMEOUT ?? "10000",
      10,
    ),
  },
  synchronize: process.env.DB_SYNCHRONIZE === "true",
  logging: process.env.DB_LOGGING === "true",
  migrations: ["src/migrations/**/*.ts"],
  entities: ["src/**/*.entity.ts"],
  ssl:
    process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
};
