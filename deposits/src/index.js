const express = require("express");
const { config } = require("./config");
const db = require("./integration/db");
const kafka = require("./integration/kafka");
const loadController = require("./controllers/loadController");
const depositRoutes = require("./routes/depositRoutes");

async function main() {
  await db.waitUntilReady();
  await kafka.waitForKafka();

  const app = express();
  app.use(express.json());
  app.use(depositRoutes);
  app.use((error, _req, res, _next) => {
    const status = error.status ?? 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: error.message || "Internal error", code: error.code ?? "internal" });
  });

  app.listen(config.port, () => {
    console.log(`deposits listening on ${config.port}`);
  });
  console.log("deposits loader consuming deposits.waiting");
  await kafka.consume(loadController.handle);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
