const express = require("express");
const { config } = require("./config");
const db = require("./integration/db");
const agentRoutes = require("./routes/agentRoutes");

async function main() {
  process.env.OPENAI_API_KEY = config.openaiApiKey;
  await db.waitUntilReady();

  const app = express();
  app.use(express.json({ limit: "32kb" }));
  app.use(agentRoutes);
  app.use((error, _req, res, _next) => {
    const status = error.status ?? 500;
    if (status >= 500) console.error(error);
    res.status(status).json({ error: error.message || "Internal error", code: error.code ?? "internal" });
  });

  app.listen(config.port, () => {
    console.log(`agent listening on ${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
