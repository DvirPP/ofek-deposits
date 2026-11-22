const { Kafka } = require("kafkajs");
const { config } = require("../config");

const kafka = new Kafka({
  clientId: "ofek-deposits",
  brokers: config.kafkaBrokers,
  retry: { retries: 8 },
});

const producer = kafka.producer();
const consumer = kafka.consumer({ groupId: "deposits-loader" });

async function waitForKafka() {
  let lastError;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const admin = kafka.admin();
      await admin.connect();
      try {
        await admin.createTopics({
          waitForLeaders: true,
          topics: [config.waitingTopic, config.decisionTopic, config.dlqTopic].map((topic) => ({
            topic,
            numPartitions: 1,
            replicationFactor: 1,
          })),
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

async function publish(topic, key, value) {
  await producer.send({
    topic,
    messages: [{ key: key ?? null, value: JSON.stringify(value) }],
  });
}

async function consume(onMessage) {
  await consumer.connect();
  await consumer.subscribe({ topic: config.waitingTopic, fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ message }) => {
      await onMessage(message);
    },
  });
}

module.exports = { waitForKafka, publish, consume };
