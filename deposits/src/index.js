const db = require("./integration/db");
const kafka = require("./integration/kafka");
const loadController = require("./controllers/loadController");

async function main() {
  await db.waitUntilReady();
  await kafka.waitForKafka();
  console.log("deposits loader consuming deposits.waiting");
  await kafka.consume(loadController.handle);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
