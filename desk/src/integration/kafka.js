const { Kafka } = require("kafkajs");
const { config } = require("../config");

const kafka = new Kafka({
  clientId: "ofek-desk",
  brokers: config.kafkaBrokers,
  retry: { retries: 8 },
});

const producer = kafka.producer();

async function waitForKafka() {
  let lastError;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const admin = kafka.admin();
      await admin.connect();
      try {
        await admin.createTopics({
          waitForLeaders: true,
          topics: [{ topic: config.kafkaTopic, numPartitions: 1, replicationFactor: 1 }],
        });
      } finally {
        await admin.disconnect();
      }
      await producer.connect();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw lastError;
}

async function publishDeposits(loadId, deposits) {
  if (deposits.length === 0) return;
  await producer.send({
    topic: config.kafkaTopic,
    messages: deposits.map((deposit) => ({
      key: deposit.depositId,
      value: JSON.stringify({ loadId, ...deposit.payload }),
    })),
  });
}

module.exports = { waitForKafka, publishDeposits };
