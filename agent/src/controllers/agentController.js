const agentService = require("../services/agentService");

async function ask(req, res) {
  const question = String(req.body?.question ?? "").trim();
  if (!question) {
    res.status(400).json({ error: "question is required", code: "question_required" });
    return;
  }
  if (question.length > 2000) {
    res.status(400).json({ error: "question is too long", code: "question_too_long" });
    return;
  }
  const answer = await agentService.ask(question);
  res.json(answer);
}

module.exports = { ask };
