const config = {
  port: Number(process.env.DESK_PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://desk_user:desk_user@localhost:5432/ofek",
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
  kafkaTopic: process.env.KAFKA_TOPIC ?? "deposits.waiting",
  sessionHours: 12,
};

module.exports = { config };
