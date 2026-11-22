const config = {
  port: Number(process.env.DESK_PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://ofek:ofek@localhost:5432/ofek",
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
  kafkaTopic: process.env.KAFKA_TOPIC ?? "deposits.waiting",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  draftTtlSeconds: 15 * 60,
  sessionHours: 12,
};

module.exports = { config };
