const config = {
  port: Number(process.env.AGENT_PORT ?? 3001),
  databaseUrl: process.env.AGENT_DATABASE_URL ?? "postgres://agent_reader:agent_reader@postgres:5432/ofek",
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
};

module.exports = { config };
