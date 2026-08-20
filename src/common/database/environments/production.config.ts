export default {
  type: "postgres",
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT ?? "5432", 10),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  pool: {
    max: parseInt(process.env.DB_POOL_MAX ?? "50", 10),
    min: parseInt(process.env.DB_POOL_MIN ?? "10", 10),
    idleTimeoutMillis: parseInt(
      process.env.DB_POOL_IDLE_TIMEOUT ?? "60000",
      10,
    ),
    connectionTimeoutMillis: parseInt(
      process.env.DB_POOL_CONNECTION_TIMEOUT ?? "10000",
      10,
    ),
  },
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: true } : undefined,
  synchronize: false,
  logging: true,
  migrations: ["dist/migrations/**/*.js"],
  entities: ["dist/**/*.entity.js"],
};
