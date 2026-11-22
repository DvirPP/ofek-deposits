const express = require("express");
const { config } = require("./config");
const db = require("./integration/db");
const drafts = require("./integration/redis");
const { waitForKafka } = require("./integration/kafka");
const deskRoutes = require("./routes/deskRoutes");

async function main() {
  await db.waitUntilReady();
  await drafts.waitUntilReady();
  await waitForKafka();

  const app = express();
  app.use(express.json());
  app.use(deskRoutes);
  app.use((error, _req, res, _next) => {
    const status = error.status ?? 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: error.message || "Internal error", code: error.code ?? "internal" });
  });

  app.listen(config.port, () => {
    console.log(`desk listening on ${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
