const { config } = require("../config");
const kafka = require("../integration/kafka");
const depositService = require("../services/depositService");

async function handle(message) {
  const parsed = depositService.parse(message.value ?? Buffer.from(""));
  if (!parsed.ok) {
    await kafka.publish(config.dlqTopic, null, {
      reason: parsed.reason,
      payload: parsed.payload,
      kafkaAttempts: 1,
    });
    return;
  }

  try {
    const outcome = await depositService.apply(parsed.deposit);
    await kafka.publish(config.decisionTopic, parsed.deposit.depositId, outcome);
  } catch (error) {
    const kafkaAttempts = Number(parsed.deposit.kafkaAttempts ?? 0) + 1;
    const failure = {
      ...parsed.deposit,
      kafkaAttempts,
      reason: error.message,
    };
    const topic = kafkaAttempts >= config.maxAttempts ? config.dlqTopic : config.waitingTopic;
    await kafka.publish(topic, parsed.deposit.depositId, failure);
  }
}

module.exports = { handle };
