const config = {
  port: Number(process.env.DEPOSITS_PORT ?? 3002),
  databaseUrl: process.env.DATABASE_URL ?? "postgres://deposits_user:deposits_user@localhost:5432/ofek",
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? "localhost:9092").split(","),
  waitingTopic: process.env.KAFKA_WAITING_TOPIC ?? "deposits.waiting",
  decisionTopic: process.env.KAFKA_DECISION_TOPIC ?? "deposits.decisions",
  dlqTopic: process.env.KAFKA_DLQ_TOPIC ?? "deposits.dlq",
  maxAttempts: 3,
};

module.exports = { config };
