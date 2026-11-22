const express = require("express");
const db = require("../integration/db");
const depositController = require("../controllers/depositController");

const router = express.Router();

router.get("/health", async (_req, res, next) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok", service: "deposits" });
  } catch (error) {
    next(error);
  }
});

router.get("/deposits", (req, res, next) => {
  depositController.list(req, res).catch(next);
});

router.get("/deposits/:depositId/history", (req, res, next) => {
  depositController.history(req, res).catch(next);
});

router.get("/deposits/:depositId", (req, res, next) => {
  depositController.read(req, res).catch(next);
});

router.post("/deposits/:depositId/approval", (req, res, next) => {
  depositController.approval(req, res).catch(next);
});

module.exports = router;
