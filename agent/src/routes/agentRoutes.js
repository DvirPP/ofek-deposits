const express = require("express");
const db = require("../integration/db");
const agentController = require("../controllers/agentController");

const router = express.Router();

router.get("/health", async (_req, res, next) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok", service: "agent" });
  } catch (error) {
    next(error);
  }
});

router.post("/ask", (req, res, next) => {
  agentController.ask(req, res).catch(next);
});

module.exports = router;
