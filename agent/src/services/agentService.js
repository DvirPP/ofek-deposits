const { generateText, tool, stepCountIs } = require("ai");
const { openai } = require("@ai-sdk/openai");
const { z } = require("zod");
const { config } = require("../config");
const db = require("../integration/db");
const { systemPrompt } = require("../prompt");

async function ask(question) {
  if (!config.openaiApiKey) {
    const error = new Error("OPENAI_API_KEY is not configured");
    error.status = 503;
    error.code = "missing_api_key";
    throw error;
  }

  const result = await generateText({
    model: openai(config.openaiModel),
    system: systemPrompt,
    prompt: question,
    tools: {
      queryDatabase: tool({
        description: "Run one read-only SELECT against the Bank Ofek schema.",
        inputSchema: z.object({
          sql: z.string().describe("A single SELECT statement using only the provided schema."),
        }),
        execute: async ({ sql }) => db.query(sql),
      }),
    },
    stopWhen: stepCountIs(6),
    maxRetries: 1,
  });

  const usedTool = result.steps.some((step) => (step.toolResults ?? []).length > 0);
  if (!usedTool) {
    return {
      html: "<p>I can answer only from the deposit database, and this question did not use it.</p>",
      react: null,
    };
  }

  return parseAnswer(result.text);
}

function parseAnswer(text) {
  const cleaned = String(text ?? "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/u, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) {
    const error = new Error("The agent did not return HTML");
    error.status = 502;
    error.code = "bad_agent_response";
    throw error;
  }
  const body = JSON.parse(cleaned.slice(start, end + 1));
  if (typeof body.html !== "string" || !body.html.trim()) {
    const error = new Error("The agent did not return HTML");
    error.status = 502;
    error.code = "bad_agent_response";
    throw error;
  }
  return {
    html: body.html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ""),
    react: typeof body.react === "string" && body.react.trim() ? body.react : null,
  };
}

module.exports = { ask };
